import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import type { CanvasNode, WorkspaceDocument } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let model: WorkspaceDocument | null = null;
let workspacePath = "";
let selectedNodeId: string | null = null;
let zoom = 1;
let origin = { x: 0, y: 0 };

const icon = (name: string) => ({
  cursor: "<svg viewBox='0 0 24 24'><path d='m5 3 14 8-7 2-2 7z'/><path d='m12 13 4 5'/></svg>",
  terminal: "<svg viewBox='0 0 24 24'><path d='m5 7 4 4-4 4'/><path d='M12 15h7'/></svg>",
  note: "<svg viewBox='0 0 24 24'><path d='M6 3h9l3 3v15H6z'/><path d='M15 3v4h4M9 12h6M9 16h5'/></svg>",
  folder: "<svg viewBox='0 0 24 24'><path d='M3 7h7l2 2h9v10H3z'/></svg>",
  globe: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='8'/><path d='M4 12h16M12 4c2 2 3 5 3 8s-1 6-3 8c-2-2-3-5-3-8s1-6 3-8'/></svg>",
  pencil: "<svg viewBox='0 0 24 24'><path d='m4 20 4-1 10-10-3-3L5 16z'/><path d='m13 5 3 3'/></svg>",
  link: "<svg viewBox='0 0 24 24'><path d='M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1'/><path d='M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'/></svg>",
  plus: "<svg viewBox='0 0 24 24'><path d='M12 5v14M5 12h14'/></svg>"
}[name] ?? "");

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!); }
function content(node: CanvasNode): [string, Record<string, unknown>] { const [kind, wrapped] = Object.entries(node.content)[0] ?? ["unknown", { _0: {} }]; return [kind, wrapped._0]; }
function title(node: CanvasNode): string { const [kind, data] = content(node); if (kind === "terminal") return String(data.name ?? "Terminal"); if (kind === "stickyNote") return String(data.fileName ?? "Untitled note").replace(/\.md$/, ""); if (kind === "portal") return String(data.name ?? data.currentURL ?? "Portal"); if (kind === "fileTree") return String(data.name ?? "Files"); return kind === "text" ? String(data.text ?? "Text") : kind; }
function body(node: CanvasNode): string { const [kind, data] = content(node); if (kind === "terminal") return `<span class='terminal-prompt'>›</span> ${escapeHtml(String(data.command ?? "Terminal session"))}`; if (kind === "portal") return `<span class='portal-address'>${escapeHtml(String(data.currentURL ?? "Enter a URL"))}</span>`; if (kind === "stickyNote") return "Markdown note"; return escapeHtml(kind === "text" ? String(data.text ?? "") : String(data.rootPath ?? kind)); }

function renderNode(node: CanvasNode): string {
  const [kind, data] = content(node); const [[x, y], [width, height]] = node.frame; const selected = selectedNodeId === node.id ? " selected" : ""; const nodeIcon = kind === "stickyNote" ? "note" : kind === "fileTree" ? "folder" : kind === "portal" ? "globe" : kind === "terminal" ? "terminal" : "pencil"; const color = typeof data.color === "string" ? data.color : "#007aff";
  const footer = kind === "terminal" ? `<footer class='node-footer'>${icon("folder")} ${escapeHtml(String(data.workingDirectory ?? ""))}</footer>` : "";
  return `<article class='node ${kind}-node${selected}' data-node-id='${node.id}' style='left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${node.zIndex};--node-color:${color}'><div class='node-inner'><header class='node-header'>${icon(nodeIcon)}<span>${escapeHtml(title(node))}</span><span class='node-shortcut'>⌘</span></header><section class='node-body'>${body(node)}</section>${footer}</div><i class='resize-handle'></i></article>`;
}

function tool(name: string, label: string, active = false): string { return `<button class='tool-button${active ? " active" : ""}' title='${label}' aria-label='${label}'>${icon(name)}</button>`; }
function render(): void {
  const payload = model?.payload; const nodes = payload?.nodes ?? [];
  app.innerHTML = `<main class='app-shell'><aside class='sidebar'><div class='sidebar-title'><span>Workspaces</span><button title='New workspace'>${icon("plus")}</button></div><p class='section-label'>WORKSPACES</p><button class='workspace-row selected'>${icon("folder")}<span class='workspace-meta'><span class='workspace-name'>${escapeHtml(payload?.name ?? "Open workspace")}</span><span class='workspace-path'>${escapeHtml(workspacePath || "No workspace loaded")}</span></span>${nodes.length ? `<span class='workspace-badge'>${nodes.length}</span>` : ""}</button><div class='sidebar-footer'><button>⚙ Settings</button><button>?</button></div></aside><section class='workspace-surface'><div class='canvas-actions'><button id='open-workspace'>Open workspace…</button><button id='save-workspace' ${model ? "" : "disabled"}>Save</button></div><nav class='floating-toolbar'>${tool("cursor", "Select", true)}${tool("terminal", "Terminal")}${tool("note", "Note")}<i class='toolbar-divider'></i>${tool("folder", "File Tree")}${tool("globe", "Portal")}<i class='toolbar-divider'></i>${tool("pencil", "Drawing")}${tool("link", "Connection")}</nav><section class='canvas' id='canvas'><div class='world' style='transform:translate(${origin.x}px,${origin.y}px) scale(${zoom})'>${nodes.map(renderNode).join("")}</div><div class='empty-state' ${nodes.length ? "hidden" : ""}>Open a macOS workspace.json to render its canvas.</div><div class='minimap'>${nodes.map((node) => { const [[x,y],[w,h]] = node.frame; return `<i style='left:${x / 80}px;top:${y / 80}px;width:${Math.max(w / 80, 3)}px;height:${Math.max(h / 80, 3)}px'></i>`; }).join("")}</div><div class='canvas-controls'><button id='zoom-out'>−</button><span>${Math.round(zoom * 100)}%</span><button id='zoom-in'>+</button></div></section></section></main>`;
  bind();
}

function bind(): void {
  document.querySelector<HTMLButtonElement>("#open-workspace")?.addEventListener("click", async () => { const requested = window.prompt("Absolute path to workspace.json", workspacePath); if (!requested) return; try { model = await invoke<WorkspaceDocument>("load_workspace", { path: requested }); workspacePath = requested; zoom = model.payload.canvasZoom || 1; origin = model.payload.canvasOrigin || { x: 0, y: 0 }; selectedNodeId = null; render(); } catch (error) { window.alert(`Could not load workspace: ${String(error)}`); } });
  document.querySelector<HTMLButtonElement>("#save-workspace")?.addEventListener("click", async () => { if (!model || !workspacePath) return; model.payload.canvasZoom = zoom; model.payload.canvasOrigin = origin; try { await invoke("save_workspace", { path: workspacePath, document: model }); } catch (error) { window.alert(`Could not save workspace: ${String(error)}`); } });
  document.querySelector("#zoom-in")?.addEventListener("click", () => { zoom = Math.min(3, zoom + .25); render(); }); document.querySelector("#zoom-out")?.addEventListener("click", () => { zoom = Math.max(.1, zoom - .25); render(); }); document.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => element.addEventListener("pointerdown", (event) => { event.stopPropagation(); selectedNodeId = element.dataset.nodeId ?? null; render(); })); document.querySelector("#canvas")?.addEventListener("pointerdown", () => { selectedNodeId = null; render(); });
}
render();
