import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import type { CanvasNode, WorkspaceDocument } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let documentModel: WorkspaceDocument | null = null;
let workspacePath = "";
let selectedNodeId: string | null = null;
let zoom = 1;
let origin = { x: 0, y: 0 };

function contentEntry(node: CanvasNode): [string, Record<string, unknown>] {
  const [type, wrapper] = Object.entries(node.content)[0] ?? ["unknown", { _0: {} }];
  return [type, wrapper._0];
}

function nodeTitle(node: CanvasNode): string {
  const [type, value] = contentEntry(node);
  if (type === "terminal") return String(value.name ?? "Terminal");
  if (type === "stickyNote") return String(value.fileName ?? "Untitled note").replace(/\.md$/, "");
  if (type === "portal") return String(value.name ?? value.currentURL ?? "Portal");
  if (type === "fileTree") return String(value.name ?? "Files");
  return type === "text" ? String(value.text ?? "Text") : type;
}

function nodeBody(node: CanvasNode): string {
  const [type, value] = contentEntry(node);
  if (type === "terminal") return "Terminal session is restored by the Rust PTY adapter.";
  if (type === "stickyNote") return "Raw / Formatted\n\nMarkdown note stored on disk.";
  if (type === "portal") return String(value.currentURL ?? "Enter a URL");
  if (type === "fileTree") return String(value.rootPath ?? "Workspace files");
  if (type === "text") return String(value.text ?? "");
  return type;
}

function renderNode(node: CanvasNode): string {
  const [type, value] = contentEntry(node);
  const [[x, y], [width, height]] = node.frame;
  const isSelected = selectedNodeId === node.id ? " selected" : "";
  const terminalClass = type === "terminal" ? " terminal-node" : "";
  const noteClass = type === "stickyNote" ? " note-node" : "";
  const portalClass = type === "portal" ? " portal-node" : "";
  const color = typeof value.color === "string" ? value.color : "#5d9cff";
  return `<article class="node ${type}${terminalClass}${noteClass}${portalClass}${isSelected}"
      data-node-id="${node.id}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${node.zIndex};--node-color:${color}">
    <header class="node-header"><span class="node-icon">${type === "terminal" ? "◉" : type === "portal" ? "◎" : "◆"}</span><span>${escapeHtml(nodeTitle(node))}</span><span class="shortcut">⌘</span></header>
    <section class="node-body">${escapeHtml(nodeBody(node)).replace(/\n/g, "<br>")}</section>
    <i class="resize-handle" aria-hidden="true"></i>
  </article>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function render(): void {
  const payload = documentModel?.payload;
  const nodes = payload?.nodes ?? [];
  app.innerHTML = `<main class="shell">
    <aside class="sidebar"><div class="brand">maestri</div><button class="workspace-add" title="New workspace">+</button><p class="section-label">WORKSPACES</p><button class="workspace active"><span>⌘</span>${escapeHtml(payload?.name ?? "Open workspace")}</button><div class="sidebar-footer"><button>⚙ Settings</button><button>?</button></div></aside>
    <section class="surface">
      <nav class="toolbar"><div class="tool-group"><button class="tool active">↖<small>Select</small></button><button class="tool">▣<small>Terminal</small></button><button class="tool">◇<small>Note</small></button><button class="tool">T<small>Text</small></button><button class="tool">✎<small>Drawing</small></button><button class="tool">▤<small>File</small></button><button class="tool">⌁<small>Connection</small></button><button class="tool">◎<small>Portal</small></button></div><div class="toolbar-actions"><button id="open-workspace">Open workspace…</button><button id="save-workspace" ${documentModel ? "" : "disabled"}>Save</button></div></nav>
      <section class="canvas" id="canvas"><div class="world" style="transform:translate(${origin.x}px, ${origin.y}px) scale(${zoom})">${nodes.map(renderNode).join("")}</div><div class="empty-state" ${nodes.length ? "hidden" : ""}>Open a macOS workspace.json to render its canvas.</div>
        <div class="canvas-controls"><button id="zoom-out">−</button><span>${Math.round(zoom * 100)}%</span><button id="zoom-in">+</button></div>
        <div class="minimap" aria-label="Canvas mini map">${nodes.map((node) => { const [[x, y], [w, h]] = node.frame; return `<i style="left:${x / 80}px;top:${y / 80}px;width:${Math.max(w / 80, 3)}px;height:${Math.max(h / 80, 3)}px"></i>`; }).join("")}</div>
      </section>
    </section>
  </main>`;
  bindEvents();
}

function bindEvents(): void {
  document.querySelector<HTMLButtonElement>("#open-workspace")?.addEventListener("click", async () => {
    const requested = window.prompt("Absolute path to workspace.json", workspacePath);
    if (!requested) return;
    try {
      documentModel = await invoke<WorkspaceDocument>("load_workspace", { path: requested });
      workspacePath = requested;
      zoom = documentModel.payload.canvasZoom || 1;
      origin = documentModel.payload.canvasOrigin || { x: 0, y: 0 };
      selectedNodeId = null;
      render();
    } catch (error) { window.alert(`Could not load workspace: ${String(error)}`); }
  });
  document.querySelector<HTMLButtonElement>("#save-workspace")?.addEventListener("click", async () => {
    if (!documentModel || !workspacePath) return;
    documentModel.payload.canvasZoom = zoom;
    documentModel.payload.canvasOrigin = origin;
    try { await invoke("save_workspace", { path: workspacePath, document: documentModel }); }
    catch (error) { window.alert(`Could not save workspace: ${String(error)}`); }
  });
  document.querySelector("#zoom-in")?.addEventListener("click", () => { zoom = Math.min(2, zoom + 0.1); render(); });
  document.querySelector("#zoom-out")?.addEventListener("click", () => { zoom = Math.max(0.25, zoom - 0.1); render(); });
  document.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => element.addEventListener("pointerdown", (event) => {
    event.stopPropagation(); selectedNodeId = element.dataset.nodeId ?? null; render();
  }));
  document.querySelector("#canvas")?.addEventListener("pointerdown", () => { selectedNodeId = null; render(); });
}

render();
