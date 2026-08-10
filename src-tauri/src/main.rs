use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::post, Json, Router};
use serde::{de::Error as DeError, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use std::{collections::BTreeMap, fs, net::SocketAddr, path::Path, sync::Arc};
use tauri::Manager;
use tokio::sync::RwLock;
use uuid::Uuid;

/// The top-level document matches Sources/Workspace/Models/WorkspaceDocument.swift.
/// `flatten` fields make the first scaffold lossless for fields not yet rendered by web UI.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDocument {
    payload: WorkspacePayload,
    schema_version: u32,
    #[serde(rename = "type")]
    document_type: String,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePayload {
    id: Uuid,
    name: String,
    canvas_origin: Point,
    canvas_zoom: f64,
    nodes: Vec<CanvasNode>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Point { x: f64, y: f64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasNode {
    id: Uuid,
    /// Maestri's non-standard CGRect encoding: [[x, y], [width, height]].
    frame: [[f64; 2]; 2],
    content: NodeContent,
    z_index: i64,
    is_locked: bool,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

/// Preserves the required tagged-union shape `{ "terminal": { "_0": {...} } }`.
/// The payload stays JSON until each platform feature has a faithful Rust implementation.
#[derive(Clone, Debug)]
struct NodeContent { kind: String, payload: Value }

impl<'de> Deserialize<'de> for NodeContent {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut outer = Map::<String, Value>::deserialize(deserializer)?;
        if outer.len() != 1 { return Err(D::Error::custom("NodeContent must contain one type key")); }
        let (kind, value) = outer.into_iter().next().expect("checked length");
        let mut wrapper = value.as_object().cloned().ok_or_else(|| D::Error::custom("NodeContent type must wrap an object"))?;
        let payload = wrapper.remove("_0").ok_or_else(|| D::Error::custom("NodeContent wrapper must contain _0"))?;
        if !wrapper.is_empty() { return Err(D::Error::custom("NodeContent wrapper contains unsupported keys")); }
        Ok(Self { kind, payload })
    }
}

impl Serialize for NodeContent {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut wrapper = Map::new();
        wrapper.insert("_0".to_owned(), self.payload.clone());
        let mut outer = Map::new();
        outer.insert(self.kind.clone(), Value::Object(wrapper));
        Value::Object(outer).serialize(serializer)
    }
}

#[derive(Default)]
struct AppState { workspace: RwLock<Option<WorkspaceDocument>> }
type SharedState = Arc<AppState>;

#[tauri::command]
async fn load_workspace(path: String, state: tauri::State<'_, SharedState>) -> Result<WorkspaceDocument, String> {
    let document = read_workspace(Path::new(&path))?;
    if document.schema_version != 2 { return Err(format!("unsupported workspace schemaVersion {}", document.schema_version)); }
    *state.workspace.write().await = Some(document.clone());
    Ok(document)
}

#[tauri::command]
async fn save_workspace(path: String, document: WorkspaceDocument, state: tauri::State<'_, SharedState>) -> Result<(), String> {
    if document.schema_version != 2 { return Err("workspace schemaVersion must remain 2".into()); }
    write_workspace(Path::new(&path), &document)?;
    *state.workspace.write().await = Some(document);
    Ok(())
}

fn read_workspace(path: &Path) -> Result<WorkspaceDocument, String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("decode {}: {error}", path.display()))
}

/// Temp-file then rename mirrors PersistenceManager's atomic write strategy.
fn write_workspace(path: &Path, document: &WorkspaceDocument) -> Result<(), String> {
    let parent = path.parent().ok_or("workspace path has no parent directory")?;
    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(document).map_err(|error| error.to_string())?;
    fs::write(&temp, bytes).map_err(|error| format!("write {}: {error}", temp.display()))?;
    fs::rename(&temp, path).map_err(|error| format!("replace {}: {error}", path.display()))
}

#[derive(Deserialize)]
struct CliRequest { args: Vec<String> }

async fn cli_handler(State(state): State<SharedState>, headers: HeaderMap, Json(request): Json<CliRequest>) -> (StatusCode, String) {
    let terminal_id = headers.get("x-terminal-id").and_then(|value| value.to_str().ok()).and_then(|value| Uuid::parse_str(value).ok());
    if request.args.is_empty() { return (StatusCode::OK, "error: missing args".into()); }
    let response = match request.args[0].as_str() {
        "debug" => format!("open-maestri inter-agent server debug:\n  Server: loopback HTTP\n  Terminal ID: {}\n  Commands: list debug", terminal_id.map(|id| id.to_string()).unwrap_or_else(|| "(none)".into())),
        "list" => {
            let workspace = state.workspace.read().await;
            let terminals = workspace.as_ref().map(|document| document.payload.nodes.iter().filter(|node| node.content.kind == "terminal").count()).unwrap_or(0);
            format!("{} terminal(s) in the loaded workspace", terminals)
        }
        command => format!("error: unknown command '{command}'. Try 'omaestri list' for available commands."),
    };
    (StatusCode::OK, response)
}

fn start_loopback_ipc(state: SharedState) {
    tauri::async_runtime::spawn(async move {
        let app = Router::new().route("/cli", post(cli_handler)).with_state(state);
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await { Ok(listener) => listener, Err(error) => { eprintln!("omaestri IPC bind failed: {error}"); return; } };
        let address: SocketAddr = listener.local_addr().expect("loopback listener address");
        eprintln!("omaestri IPC listening on {address}");
        if let Err(error) = axum::serve(listener, app).await { eprintln!("omaestri IPC stopped: {error}"); }
    });
}

fn main() {
    let state = Arc::new(AppState::default());
    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |_app| { start_loopback_ipc(state.clone()); Ok(()) })
        .invoke_handler(tauri::generate_handler![load_workspace, save_workspace])
        .run(tauri::generate_context!())
        .expect("error while running open-maestri");
}
