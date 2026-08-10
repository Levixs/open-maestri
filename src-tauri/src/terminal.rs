use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::{collections::{HashMap, VecDeque}, io::{Read, Write}, sync::{Arc, Mutex}, thread};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const SCROLLBACK_LIMIT: usize = 2 * 1024 * 1024;

pub struct TerminalManager {
    sessions: Mutex<HashMap<Uuid, TerminalSession>>,
}

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    scrollback: Arc<Mutex<Scrollback>>,
}

struct Scrollback {
    bytes: VecDeque<u8>,
}

impl Scrollback {
    fn push(&mut self, data: &[u8]) {
        self.bytes.extend(data);
        let excess = self.bytes.len().saturating_sub(SCROLLBACK_LIMIT);
        self.bytes.drain(..excess);
    }

    fn text(&self) -> String {
        let bytes: Vec<u8> = self.bytes.iter().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

impl TerminalManager {
    pub fn new() -> Self { Self { sessions: Mutex::new(HashMap::new()) } }

    pub fn spawn(&self, app: AppHandle, id: Uuid, command: String, working_directory: Option<String>, server_port: u16, columns: u16, rows: u16) -> Result<(), String> {
        self.close(id);
        let pty_system = NativePtySystem::default();
        let pair = pty_system.openpty(PtySize { rows: rows.max(1), cols: columns.max(1), pixel_width: 0, pixel_height: 0 }).map_err(|error| error.to_string())?;
        let mut process = command_builder(&command);
        if let Some(directory) = working_directory.filter(|path| !path.is_empty()) { process.cwd(directory); }
        process.env("MAESTRI_SERVER_PORT", server_port.to_string());
        process.env("MAESTRI_TERMINAL_ID", id.to_string());
        process.env("TERM", "xterm-256color");
        let child = pair.slave.spawn_command(process).map_err(|error| format!("spawn terminal: {error}"))?;
        drop(pair.slave);
        let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
        let scrollback = Arc::new(Mutex::new(Scrollback { bytes: VecDeque::new() }));
        let output = scrollback.clone();
        let event_name = format!("terminal:data:{id}");
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                let count = match reader.read(&mut buffer) { Ok(0) | Err(_) => break, Ok(count) => count };
                let chunk = String::from_utf8_lossy(&buffer[..count]).into_owned();
                if let Ok(mut history) = output.lock() { history.push(&buffer[..count]); }
                let _ = app.emit(&event_name, chunk);
            }
        });
        self.sessions.lock().map_err(|_| "terminal session lock poisoned")?.insert(id, TerminalSession { writer, master: pair.master, child, scrollback });
        Ok(())
    }

    pub fn write(&self, id: Uuid, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "terminal session lock poisoned")?;
        let session = sessions.get_mut(&id).ok_or("terminal session not found")?;
        session.writer.write_all(data.as_bytes()).and_then(|_| session.writer.flush()).map_err(|error| error.to_string())
    }

    pub fn resize(&self, id: Uuid, columns: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "terminal session lock poisoned")?;
        let session = sessions.get(&id).ok_or("terminal session not found")?;
        session.master.resize(PtySize { rows: rows.max(1), cols: columns.max(1), pixel_width: 0, pixel_height: 0 }).map_err(|error| error.to_string())
    }

    pub fn scrollback(&self, id: Uuid) -> Result<String, String> {
        let sessions = self.sessions.lock().map_err(|_| "terminal session lock poisoned")?;
        let session = sessions.get(&id).ok_or("terminal session not found")?;
        session.scrollback.lock().map_err(|_| "terminal scrollback lock poisoned").map(|history| history.text())
    }

    pub fn close(&self, id: Uuid) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(mut session) = sessions.remove(&id) { let _ = session.child.kill(); }
        }
    }
}

fn command_builder(command: &str) -> CommandBuilder {
    if command.trim().is_empty() {
        #[cfg(windows)] { return CommandBuilder::new("cmd.exe"); }
        #[cfg(not(windows))] { return CommandBuilder::new("sh"); }
    }
    #[cfg(windows)] {
        let mut process = CommandBuilder::new("cmd.exe");
        process.arg("/C");
        process.arg(command);
        process
    }
    #[cfg(not(windows))] {
        let mut process = CommandBuilder::new("sh");
        process.arg("-lc");
        process.arg(command);
        process
    }
}
