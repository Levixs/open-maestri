import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import type { CanvasNode, WorkspaceDocument } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let model: WorkspaceDocument | null = null;
let workspacePath = "";
let selectedNodeId: string | null = null;
let zoom = 1;
let origin = { x: 0, y: 0 };
let sidebarWidth = 220;
let workspaceSearch = "";

const symbols: Record<string, string> = {
  cursor: "<svg viewBox='0 0 24 24'><path d='m5 3 14 8-7 2-2 7z'/><path d='m12 13 4 5'/></svg>", terminal: "<svg viewBox='0 0 24 24'><path d='m5 7 4 4-4 4'/><path d='M12 15h7'/></svg>", note: "<svg viewBox='0 0 24 24'><path d='M6 3h9l3 3v15H6z'/><path d='M15 3v4h4M9 12h6M9 16h5'/></svg>", folder: "<svg viewBox='0 0 24 24'><path d='M3 7h7l2 2h9v10H3z'/></svg>", globe: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='8'/><path d='M4 12h16M12 4c2 2 3 5 3 8s-1 6-3 8c-2-2-3-5-3-8s1-6 3-8'/></svg>", pencil: "<svg viewBox='0 0 24 24'><path d='m4 20 4-1 10-10-3-3L5 16z'/><path d='m13 5 3 3'/></svg>", link: "<svg viewBox='0 0 24 24'><path d='M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1'/><path d='M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'/></svg>", plus: "<svg viewBox='0 0 24 24'><path d='M12 5v14M5 12h14'/></svg>", chevron: "<svg viewBox='0 0 24 24'><path d='m9 18 6-6-6-6'/></svg>", back: "<svg viewBox='0 0 24 24'><path d='m14 7-5 5 5 5'/></svg>", forward: "<svg viewBox='0 0 24 24'><path d='m10 7 5 5-5 5'/></svg>", refresh: "<svg viewBox='0 0 24 24'><path d='M19 12a7 7 0 1 1-2-5'/><path d='M19 5v5h-5'/></svg>", search: "<svg viewBox='0 0 24 24'><circle cx='11' cy='11' r='6'/><path d='m16 16 4 4'/></svg>", sparkles: "<svg viewBox='0 0 24 24'><path d='m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2zM19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6z'/></svg>"
};
const icon = (name: string) => symbols[name] ?? "";
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const content = (node: CanvasNode): [string, Record<string, unknown>] => { const [kind, wrapped] = Object.entries(node.content)[0] ?? ["unknown", { _0: {} }]; return [kind, wrapped._0]; };
const selectedNode = () => model?.payload.nodes.find((node) => node.id === selectedNodeId) ?? null;

function title(node: CanvasNode): string { const [kind, data] = content(node); if (kind === "terminal") return String(data.name ?? "Terminal"); if (kind === "stickyNote") return String(data.fileName ?? "Note").replace(/\.md$/, ""); if (kind === "portal") return String(data.name ?? "Portal"); if (kind === "fileTree") return String(data.name ?? "Files"); return kind === "text" ? String(data.text ?? "Text") : kind; }
function tool(name: string, label: string, active = false) { return `<button class='tool-button${active ? " active" : ""}' title='${label}' aria-label='${label}'>${icon(name)}</button>`; }

function terminalMarkup(data: Record<string, unknown>): string {
  const manager = data.isManager === true ? `<span class='terminal-manager' title='Maestro'>${icon("sparkles")}</span>` : "";
  const attention = data.status === "idle" ? "" : "<i class='attention-dot'></i>";
  const role = data.assignedRoleId ? "<span class='role-badge'>Role</span>" : "";
  const command = escapeHtml(String(data.command ?? "")); const directory = escapeHtml(String(data.workingDirectory ?? ""));
  return `<div class='terminal-header-accessory'>${role}${manager}${attention}</div><section class='terminal-content'><span class='terminal-prompt'>›</span> ${command || "Terminal session"}</section><footer class='terminal-footer'>${icon("folder")}<span>${directory}</span></footer>`;
}
function noteMarkup(data: Record<string, unknown>): string { const formatted = data.isPreviewing === true; return `<section class='note-content'><div class='note-mode'>${formatted ? "Formatted" : "Raw"}</div><p>${formatted ? "Markdown preview" : "Write Markdown…"}</p></section>`; }
function portalMarkup(data: Record<string, unknown>): string { const url = escapeHtml(String(data.currentURL ?? "")); return `<section class='portal-content'><nav class='portal-nav'><span class='portal-navigation'><button disabled>${icon("back")}</button><button disabled>${icon("forward")}</button><button>${icon("refresh")}</button></span><label class='portal-address'>${icon("search")}<input value='${url}' placeholder='Search or enter website name' aria-label='Portal URL'></label></nav><div class='portal-empty'>${icon("globe")}<span>Enter a URL to begin</span></div></section>`; }

function renderNode(node: CanvasNode): string {
  const [kind, data] = content(node); const [[x, y], [width, height]] = node.frame; const selected = selectedNodeId === node.id ? " selected" : ""; const isNote = kind === "stickyNote"; const typeIcon = isNote ? "note" : kind === "portal" ? "globe" : kind === "terminal" ? "terminal" : kind === "fileTree" ? "folder" : "pencil"; const color = typeof data.color === "string" ? data.color : kind === "portal" ? "#007aff" : "#1f1f1f";
  const typeBody = kind === "terminal" ? terminalMarkup(data) : isNote ? noteMarkup(data) : kind === "portal" ? portalMarkup(data) : `<section class='generic-node-content'>${escapeHtml(kind === "text" ? String(data.text ?? "") : String(data.rootPath ?? kind))}</section>`;
  return `<article class='node ${kind}-node${selected}' data-node-id='${node.id}' style='left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${node.zIndex};--node-color:${color};--note-tint:${isNote ? color : "transparent"}'><div class='node-inner'><header class='node-header'>${icon(typeIcon)}<span>${escapeHtml(title(node))}</span>${kind === "terminal" ? "" : "<span class='node-spacer'></span>"}</header>${typeBody}</div><i class='resize-handle'></i></article>`;
}

function contextualToolbar(): string {
  const node = selectedNode(); if (!node) return ""; const [kind, data] = content(node);
  const controls = kind === "stickyNote" ? `<button>Raw / Formatted</button><button>Size ${data.fontSize ?? 14}</button><button>Background</button><i></i><button>Connect</button><button class='danger'>Delete</button>` : kind === "terminal" ? `<button>Edit Terminal</button><button>Assign Role</button><button>${data.isManager ? "Disable Maestro" : "Enable Maestro"}</button><i></i><button>Connect</button><button class='danger'>Delete</button>` : kind === "portal" ? `<button>Rename</button><button>Duplicate</button><i></i><button>Connect</button><button class='danger'>Delete</button>` : `<button>Duplicate</button><i></i><button class='danger'>Delete</button>`;
  return `<nav class='context-toolbar' aria-label='Selected node actions'>${controls}</nav>`;
}

function render(): void {
  const payload = model?.payload; const nodes = payload?.nodes ?? []; const workspaceName = payload?.name ?? "Open workspace"; const visible = workspaceName.toLocaleLowerCase().includes(workspaceSearch.toLocaleLowerCase());
  app.innerHTML = `<main class='app-shell'><aside class='sidebar' style='width:${sidebarWidth}px'><header class='sidebar-title'><span>Workspaces</span><button title='New workspace'>${icon("plus")}</button></header><label class='sidebar-search'>${icon("search")}<input id='workspace-search' value='${escapeHtml(workspaceSearch)}' placeholder='Search workspaces'></label><section class='workspace-list'>${visible ? `<div class='workspace-group'><button class='group-label'>${icon("chevron")}<span>Workspaces</span></button><button class='workspace-row selected'>${icon("folder")}<span class='workspace-meta'><span class='workspace-name'>${escapeHtml(workspaceName)}</span><span class='workspace-path'>${escapeHtml(workspacePath || "No workspace loaded")}</span></span>${nodes.length ? `<span class='workspace-badge'>${nodes.length}</span>` : ""}</button></div>` : "<p class='no-results'>No workspaces found</p>"}</section><footer class='sidebar-footer'><button>⚙ Settings</button><button>?</button></footer><i id='sidebar-resizer' class='sidebar-resizer'></i></aside><section class='workspace-surface'><div class='canvas-actions'><button id='open-workspace'>Open workspace…</button><button id='save-workspace' ${model ? "" : "disabled"}>Save</button></div><div class='toolbar-stack'><nav class='floating-toolbar'>${tool("cursor", "Select", true)}${tool("terminal", "Terminal")}${tool("note", "Note")}<i class='toolbar-divider'></i>${tool("folder", "File Tree")}${tool("globe", "Portal")}<i class='toolbar-divider'></i>${tool("pencil", "Drawing")}${tool("link", "Connection")}</nav>${contextualToolbar()}</div><section class='canvas' id='canvas'><div class='world' style='transform:translate(${origin.x}px,${origin.y}px) scale(${zoom})'>${nodes.map(renderNode).join("")}</div><div class='empty-state' ${nodes.length ? "hidden" : ""}>Open a macOS workspace.json to render its canvas.</div><div class='minimap'>${nodes.map((node) => { const [[x, y], [w, h]] = node.frame; return `<i style='left:${x / 80}px;top:${y / 80}px;width:${Math.max(w / 80,3)}px;height:${Math.max(h / 80,3)}px'></i>`; }).join("")}</div><div class='canvas-controls'><button id='zoom-out'>−</button><span>${Math.round(zoom * 100)}%</span><button id='zoom-in'>+</button></div></section></section></main>`;
  bind();
}

function bind(): void {
  document.querySelector<HTMLInputElement>("#workspace-search")?.addEventListener("input", (event) => { workspaceSearch = (event.target as HTMLInputElement).value; render(); });
  document.querySelector<HTMLButtonElement>("#open-workspace")?.addEventListener("click", async () => { const requested = window.prompt("Absolute path to workspace.json", workspacePath); if (!requested) return; try { model = await invoke<WorkspaceDocument>("load_workspace", { path: requested }); workspacePath = requested; zoom = model.payload.canvasZoom || 1; origin = model.payload.canvasOrigin || { x: 0, y: 0 }; selectedNodeId = null; render(); } catch (error) { window.alert(`Could not load workspace: ${String(error)}`); } });
  document.querySelector<HTMLButtonElement>("#save-workspace")?.addEventListener("click", async () => { if (!model || !workspacePath) return; model.payload.canvasZoom = zoom; model.payload.canvasOrigin = origin; try { await invoke("save_workspace", { path: workspacePath, document: model }); } catch (error) { window.alert(`Could not save workspace: ${String(error)}`); } });
  document.querySelector("#zoom-in")?.addEventListener("click", () => { zoom = Math.min(3, zoom + .25); render(); }); document.querySelector("#zoom-out")?.addEventListener("click", () => { zoom = Math.max(.1, zoom - .25); render(); }); document.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => element.addEventListener("pointerdown", (event) => { event.stopPropagation(); selectedNodeId = element.dataset.nodeId ?? null; render(); })); document.querySelector("#canvas")?.addEventListener("pointerdown", () => { selectedNodeId = null; render(); });
  document.querySelector<HTMLElement>("#sidebar-resizer")?.addEventListener("pointerdown", (event) => { event.preventDefault(); const start = event.clientX; const initial = sidebarWidth; const move = (pointer: PointerEvent) => { sidebarWidth = Math.max(200, Math.min(280, initial + pointer.clientX - start)); document.querySelector<HTMLElement>(".sidebar")!.style.width = `${sidebarWidth}px`; }; const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); });
}
render();
