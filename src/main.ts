import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import type { CanvasNode, WorkspaceConnection, WorkspaceDocument } from "./types";
import { mountTerminal, type TerminalView } from "./terminal";

const app = document.querySelector<HTMLDivElement>("#app")!;
let model: WorkspaceDocument | null = null;
let workspacePath = "";
let selectedNodeId: string | null = null;
let zoom = 1;
let origin = { x: 0, y: 0 };
let sidebarWidth = 220;
let workspaceSearch = "";
let showMiniMap = false;
const terminalViews = new Map<string, TerminalView>();
const spawnedTerminalIds = new Set<string>();

const symbols: Record<string, string> = {
  cursor: "<svg viewBox='0 0 24 24'><path d='m5 3 14 8-7 2-2 7z'/><path d='m12 13 4 5'/></svg>",
  terminal: "<svg viewBox='0 0 24 24'><path d='m5 7 4 4-4 4'/><path d='M12 15h7'/></svg>",
  note: "<svg viewBox='0 0 24 24'><path d='M6 3h9l3 3v15H6z'/><path d='M15 3v4h4M9 12h6M9 16h5'/></svg>",
  paperclip: "<svg viewBox='0 0 24 24'><path d='m8 12 7-7a4 4 0 0 1 6 6l-9 9a6 6 0 0 1-8-8l8-8'/></svg>",
  folder: "<svg viewBox='0 0 24 24'><path d='M3 7h7l2 2h9v10H3z'/></svg>",
  globe: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='8'/><path d='M4 12h16M12 4c2 2 3 5 3 8s-1 6-3 8c-2-2-3-5-3-8s1-6 3-8'/></svg>",
  text: "<span class='text-symbol'>Aa</span>",
  pencil: "<svg viewBox='0 0 24 24'><path d='m4 20 4-1 10-10-3-3L5 16z'/><path d='m13 5 3 3'/></svg>",
  link: "<svg viewBox='0 0 24 24'><path d='M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1'/><path d='M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'/></svg>",
  plus: "<svg viewBox='0 0 24 24'><path d='M12 5v14M5 12h14'/></svg>",
  chevron: "<svg viewBox='0 0 24 24'><path d='m9 18 6-6-6-6'/></svg>",
  back: "<svg viewBox='0 0 24 24'><path d='m14 7-5 5 5 5'/></svg>",
  forward: "<svg viewBox='0 0 24 24'><path d='m10 7 5 5-5 5'/></svg>",
  refresh: "<svg viewBox='0 0 24 24'><path d='M19 12a7 7 0 1 1-2-5'/><path d='M19 5v5h-5'/></svg>",
  search: "<svg viewBox='0 0 24 24'><circle cx='11' cy='11' r='6'/><path d='m16 16 4 4'/></svg>",
  sparkles: "<svg viewBox='0 0 24 24'><path d='m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2zM19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6z'/></svg>",
  trash: "<svg viewBox='0 0 24 24'><path d='M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5'/></svg>",
  layers: "<svg viewBox='0 0 24 24'><path d='m12 4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4'/></svg>",
  map: "<svg viewBox='0 0 24 24'><path d='m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14m6-12v14'/></svg>"
};
const icon = (name: string) => symbols[name] ?? "";
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const content = (node: CanvasNode): [string, Record<string, unknown>] => { const [kind, wrapped] = Object.entries(node.content)[0] ?? ["unknown", { _0: {} }]; return [kind, wrapped._0]; };
const selectedNode = () => model?.payload.nodes.find((node) => node.id === selectedNodeId) ?? null;
const tool = (name: string, label: string, active = false) => `<button class='tool-button${active ? " active" : ""}' title='${label}' aria-label='${label}'>${icon(name)}</button>`;

function title(node: CanvasNode): string { const [kind, data] = content(node); if (kind === "terminal") return String(data.name ?? "Terminal"); if (kind === "stickyNote") return String(data.fileName ?? "Note").replace(/\.md$/, ""); if (kind === "portal") return String(data.name ?? "Portal"); if (kind === "fileTree") return String(data.name ?? "Files"); return kind === "text" ? String(data.text ?? "Text") : kind; }
function terminalMarkup(nodeId: string, data: Record<string, unknown>): string {
  const manager = data.isManager === true ? `<span class='terminal-manager' title='Maestro'>${icon("sparkles")}</span>` : "";
  const role = data.assignedRoleId ? "<span class='role-badge'>Role</span>" : "";
  const directory = escapeHtml(String(data.workingDirectory ?? "~"));
  return `<div class='terminal-header-accessory'>${role}${manager}</div><section class='terminal-content'><div class='terminal-mount' data-terminal-id='${nodeId}'></div></section><footer class='terminal-footer'>${icon("folder")}<span>${directory}</span></footer>`;
}
function noteMarkup(data: Record<string, unknown>): string { const formatted = data.isPreviewing === true; return `<section class='note-content'><div class='note-mode'>${formatted ? "Formatted" : "Raw"}</div><p>${formatted ? "Markdown preview" : "Start typing your note…"}</p></section>`; }
function portalMarkup(data: Record<string, unknown>): string { const url = escapeHtml(String(data.currentURL ?? "")); return `<section class='portal-content'><nav class='portal-nav'><span class='portal-navigation'><button disabled>${icon("back")}</button><button disabled>${icon("forward")}</button><button>${icon("refresh")}</button></span><label class='portal-address'>${icon("search")}<input value='${url}' placeholder='Search or enter website name' aria-label='Portal URL'></label></nav><div class='portal-empty'>${icon("globe")}<span>Enter a URL to begin</span></div></section>`; }
function fileTreeMarkup(data: Record<string, unknown>): string {
  const root = escapeHtml(String(data.name ?? data.rootPath ?? "open-maestri").split(/[\\/]/).filter(Boolean).pop() ?? "open-maestri");
  const row = (indent: number, marker: string, name: string, folder = true) => `<div class='file-row' style='--indent:${indent}px'><span class='file-chevron'>${marker}</span><span class='file-icon ${folder ? "folder-icon" : "file-icon-doc"}'>${folder ? icon("folder") : "◆"}</span><span>${name}</span></div>`;
  return `<section class='filetree-content'><nav class='filetree-nav'><span class='filetree-history'><button disabled>${icon("back")}</button><button disabled>${icon("forward")}</button></span><strong>${root}</strong></nav><div class='filetree-list'>${row(0, "›", "build")}${row(0, "›", "docs")}${row(0, "›", "scripts")}${row(0, "⌄", "Sources")}${row(24, "›", "App")}${row(24, "›", "Assets.xcassets")}${row(24, "›", "Canvas")}${row(24, "⌄", "CLI")}${row(48, "›", "Commands")}${row(48, "", "Help.swift", false)}${row(48, "", "main.swift", false)}</div><footer class='filetree-search'>${icon("search")}<span>Search</span></footer></section>`;
}
function renderNode(node: CanvasNode): string {
  const [kind, data] = content(node); const [[x, y], [width, height]] = node.frame; const selected = selectedNodeId === node.id ? " selected" : ""; const isNote = kind === "stickyNote"; const typeIcon = isNote ? "note" : kind === "portal" ? "globe" : kind === "terminal" ? "terminal" : kind === "fileTree" ? "folder" : "pencil"; const color = typeof data.color === "string" ? data.color : kind === "portal" ? "#007aff" : "#1f1f1f";
  const typeBody = kind === "terminal" ? terminalMarkup(node.id, data) : isNote ? noteMarkup(data) : kind === "portal" ? portalMarkup(data) : kind === "fileTree" ? fileTreeMarkup(data) : `<section class='generic-node-content'>${escapeHtml(kind === "text" ? String(data.text ?? "") : String(data.rootPath ?? kind))}</section>`;
  return `<article class='node ${kind}-node${selected}' data-node-id='${node.id}' style='left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${node.zIndex};--node-color:${color};--note-tint:${isNote ? color : "transparent"}'><div class='node-inner'><header class='node-header'>${icon(typeIcon)}<span>${escapeHtml(title(node))}</span>${kind === "terminal" ? "" : "<span class='node-spacer'></span>"}</header>${typeBody}</div><i class='resize-handle'></i></article>`;
}

function allConnections(): WorkspaceConnection[] { const payload = model?.payload; return payload ? [payload.connections, payload.noteConnections, payload.portalConnections, payload.portalToPortalConnections, payload.noteToNoteConnections].flatMap((items) => items ?? []) : []; }
function connectionNodeIds(connection: WorkspaceConnection): [string, string] | null { const pairs: Array<[string | undefined, string | undefined]> = [[connection.terminalIdA, connection.terminalIdB], [connection.terminalId, connection.noteNodeId], [connection.terminalId, connection.portalNodeId], [connection.portalIdA, connection.portalIdB], [connection.noteNodeIdA, connection.noteNodeIdB]]; const pair = pairs.find(([first, second]) => first && second); return pair ? [pair[0]!, pair[1]!] : null; }
function nodeCenter(node: CanvasNode): [number, number] { const [[x, y], [width, height]] = node.frame; return [x + width / 2, y + height / 2]; }
function ropePath(points: number[][]): string { if (points.length < 2) return ""; let path = `M ${points[0][0]} ${points[0][1]}`; for (let index = 1; index < points.length; index += 1) { const previous = points[Math.max(0, index - 2)], start = points[index - 1], end = points[index], next = points[Math.min(points.length - 1, index + 1)]; path += ` C ${start[0] + (end[0] - previous[0]) / 6} ${start[1] + (end[1] - previous[1]) / 6}, ${end[0] - (next[0] - start[0]) / 6} ${end[1] - (next[1] - start[1]) / 6}, ${end[0]} ${end[1]}`; } return path; }
function connectionOverlay(): string { const nodes = model?.payload.nodes ?? []; const paths = allConnections().flatMap((connection) => { const ids = connectionNodeIds(connection); if (!ids) return []; const from = nodes.find((node) => node.id === ids[0]), to = nodes.find((node) => node.id === ids[1]); if (!from || !to) return []; const points = connection.ropePoints && connection.ropePoints.length >= 2 ? connection.ropePoints : [nodeCenter(from), nodeCenter(to)]; return [`<path class='rope rope-${connection.status ?? "idle"}' data-connection-id='${connection.id}' d='${ropePath(points)}'/>`]; }); return `<svg class='connection-overlay' viewBox='0 0 20000 16000' aria-hidden='true'>${paths.join("")}</svg>`; }
function nodeConnections(nodeId: string): WorkspaceConnection[] { return allConnections().filter((connection) => connectionNodeIds(connection)?.includes(nodeId)); }
function updatePayload(node: CanvasNode, mutate: (payload: Record<string, unknown>) => void): void { const [kind, payload] = content(node); mutate(payload); node.content = { [kind]: { _0: payload } }; }
function contextIconButton(symbol: string, label: string, cssClass = ""): string { return `<button class='context-icon ${cssClass}' title='${label}' aria-label='${label}'>${icon(symbol)}</button>`; }
function contextualToolbar(): string {
  const node = selectedNode(); if (!node) return ""; const [kind, data] = content(node); const count = nodeConnections(node.id).length; const connections = count ? `<button class='connection-badge' title='${count} connections'>${count}</button>` : "";
  const noteControls = `<span class='note-color-options'><button data-note-color='yellow' style='--color:#fdf7b8'></button><button data-note-color='pink' style='--color:#f5c0cc'></button><button data-note-color='blue' style='--color:#bad6f5'></button><button data-note-color='green' style='--color:#baedcc'></button></span>${contextIconButton("pencil", "Font size")}<i></i><button class='format-button'>B</button><button class='format-button italic'>I</button><button class='format-button strike'>S</button><button class='format-button'>&lt;/&gt;</button><i></i><button class='format-button'>H</button><button class='format-button'>☑</button><button class='format-button'>•</button><i></i>${contextIconButton("link", "Connect")}${connections}${contextIconButton("note", data.isPreviewing === true ? "Plain text" : "Formatted", data.isPreviewing === true ? "active" : "")}${contextIconButton("pencil", "Save as")}${contextIconButton("trash", "Delete", "danger")}`;
  const textControls = `${contextIconButton("pencil", "Font size")}<button class='format-button' data-text-weight='regular'>R</button><button class='format-button' data-text-weight='medium'>M</button><button class='format-button' data-text-weight='bold'>B</button><i></i><button class='format-button' data-text-family='sans'>Aa</button><button class='format-button' data-text-family='serif'>Ag</button><button class='format-button' data-text-family='mono'>⌘</button><i></i>${contextIconButton("pencil", "Text color")}${contextIconButton("trash", "Delete", "danger")}`;
  const terminalControls = `${contextIconButton("folder", "Reveal folder")}${contextIconButton("folder", "Open working directory")}${contextIconButton("trash", "Delete", "danger")}`;
  const nodeControls = `${contextIconButton("pencil", "Edit")}${contextIconButton("link", "Connect")}${connections}${contextIconButton("refresh", "Refresh")}${contextIconButton("trash", "Delete", "danger")}`;
  const controls = kind === "stickyNote" ? noteControls : kind === "text" ? textControls : kind === "terminal" ? terminalControls : nodeControls;
  return `<nav class='context-toolbar' aria-label='Selected node actions'>${controls}</nav>`;
}
function render(): void {
  const payload = model?.payload; const nodes = payload?.nodes ?? []; const workspaceName = payload?.name ?? "Open workspace"; const visible = workspaceName.toLocaleLowerCase().includes(workspaceSearch.toLocaleLowerCase());
  app.innerHTML = `<main class='app-shell'><aside class='sidebar' style='width:${sidebarWidth}px'><label class='sidebar-search'>${icon("search")}<input id='workspace-search' value='${escapeHtml(workspaceSearch)}' placeholder='Search Workspaces'></label><section class='workspace-list'>${visible ? `<button class='workspace-row selected'>${icon("folder")}<span class='workspace-meta'><span class='workspace-name'>${escapeHtml(workspaceName)}</span><span class='workspace-path'>${escapeHtml(workspacePath || "~/workspace")}</span></span>${nodes.length ? `<span class='workspace-badge'>${icon("terminal")}${nodes.length}</span>` : ""}</button>` : "<p class='no-results'>No workspaces found</p>"}</section><i id='sidebar-resizer' class='sidebar-resizer'></i></aside><section class='workspace-surface'><div class='canvas-actions'><button id='open-workspace'>Open workspace…</button><button id='save-workspace' ${model ? "" : "disabled"}>Save</button></div><div class='toolbar-stack'><nav class='floating-toolbar'>${tool("cursor", "Select", true)}${tool("terminal", "Terminal")}${tool("note", "Note")}${tool("paperclip", "Attachment")}${tool("folder", "File Tree")}${tool("globe", "Portal")}${tool("text", "Text")}${tool("pencil", "Drawing")}</nav>${contextualToolbar()}</div><section class='canvas' id='canvas'><div class='world' style='transform:translate(${origin.x}px,${origin.y}px) scale(${zoom})'>${connectionOverlay()}${nodes.map(renderNode).join("")}</div><div class='empty-state' ${nodes.length ? "hidden" : ""}>Open a macOS workspace.json to render its canvas.</div>${showMiniMap ? `<div class='minimap'>${nodes.map((node) => { const [[x, y], [w, h]] = node.frame; return `<i style='left:${x / 80}px;top:${y / 80}px;width:${Math.max(w / 80, 3)}px;height:${Math.max(h / 80, 3)}px'></i>`; }).join("")}</div>` : ""}<div class='canvas-corner-controls'><button class='corner-icon' title='Layers'>${icon("layers")}</button><button id='toggle-minimap' class='corner-icon${showMiniMap ? " active" : ""}' title='Minimap'>${icon("map")}</button><div class='canvas-controls'><button id='zoom-out'>−</button><span>${Math.round(zoom * 100)}%</span><button id='zoom-in'>+</button></div></div></section></section></main>`;
  bind();
  syncTerminals();
}
function syncTerminals(): void {
  const nodes = model?.payload.nodes ?? [];
  const terminalNodes = new Map(nodes.filter((node) => content(node)[0] === "terminal").map((node) => [node.id, node] as const));
  for (const [id, view] of terminalViews) { if (!terminalNodes.has(id)) { view.dispose(); terminalViews.delete(id); } }
  for (const [id, node] of terminalNodes) {
    const mount = document.querySelector<HTMLElement>(`.terminal-mount[data-terminal-id='${id}']`);
    if (!mount) continue;
    terminalViews.get(id)?.dispose();
    const [, data] = content(node);
    const view = mountTerminal(mount, id, { command: String(data.command ?? ""), workingDirectory: String(data.workingDirectory ?? ""), spawn: !spawnedTerminalIds.has(id) });
    spawnedTerminalIds.add(id);
    terminalViews.set(id, view);
  }
}
function bind(): void {
  document.querySelector<HTMLInputElement>("#workspace-search")?.addEventListener("input", (event) => { workspaceSearch = (event.target as HTMLInputElement).value; render(); });
  document.querySelector<HTMLButtonElement>("#open-workspace")?.addEventListener("click", async () => { const requested = window.prompt("Absolute path to workspace.json", workspacePath); if (!requested) return; try { model = await invoke<WorkspaceDocument>("load_workspace", { path: requested }); workspacePath = requested; zoom = model.payload.canvasZoom || 1; origin = model.payload.canvasOrigin || { x: 0, y: 0 }; selectedNodeId = null; render(); } catch (error) { window.alert(`Could not load workspace: ${String(error)}`); } });
  document.querySelector<HTMLButtonElement>("#save-workspace")?.addEventListener("click", async () => { if (!model || !workspacePath) return; model.payload.canvasZoom = zoom; model.payload.canvasOrigin = origin; try { await invoke("save_workspace", { path: workspacePath, document: model }); } catch (error) { window.alert(`Could not save workspace: ${String(error)}`); } });
  document.querySelectorAll<HTMLButtonElement>("[data-note-color]").forEach((button) => button.addEventListener("click", () => { const node = selectedNode(); if (!node) return; updatePayload(node, (payload) => { payload.color = button.dataset.noteColor!; }); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-text-weight]").forEach((button) => button.addEventListener("click", () => { const node = selectedNode(); if (!node) return; updatePayload(node, (payload) => { payload.fontWeight = button.dataset.textWeight!; }); render(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-text-family]").forEach((button) => button.addEventListener("click", () => { const node = selectedNode(); if (!node) return; updatePayload(node, (payload) => { payload.fontFamily = button.dataset.textFamily!; }); render(); }));
  document.querySelector<HTMLButtonElement>(".context-icon[title='Formatted'], .context-icon[title='Plain text']")?.addEventListener("click", () => { const node = selectedNode(); if (!node) return; updatePayload(node, (payload) => { payload.isPreviewing = payload.isPreviewing !== true; }); render(); });
  document.querySelector("#zoom-in")?.addEventListener("click", () => { zoom = Math.min(3, zoom + .25); render(); }); document.querySelector("#zoom-out")?.addEventListener("click", () => { zoom = Math.max(.1, zoom - .25); render(); }); document.querySelector("#toggle-minimap")?.addEventListener("click", () => { showMiniMap = !showMiniMap; render(); });
  document.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => element.addEventListener("pointerdown", (event) => { event.stopPropagation(); selectedNodeId = element.dataset.nodeId ?? null; render(); })); document.querySelector("#canvas")?.addEventListener("pointerdown", () => { selectedNodeId = null; render(); });
  document.querySelector<HTMLElement>("#sidebar-resizer")?.addEventListener("pointerdown", (event) => { event.preventDefault(); const start = event.clientX; const initial = sidebarWidth; const move = (pointer: PointerEvent) => { sidebarWidth = Math.max(200, Math.min(280, initial + pointer.clientX - start)); document.querySelector<HTMLElement>(".sidebar")!.style.width = `${sidebarWidth}px`; }; const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); });
}
render();
