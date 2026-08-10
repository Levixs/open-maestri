export type Frame = [[number, number], [number, number]];

export interface CanvasNode {
  id: string;
  frame: Frame;
  content: Record<string, { _0: Record<string, unknown> }>;
  zIndex: number;
  isLocked: boolean;
}

export interface WorkspacePayload {
  id: string;
  name: string;
  canvasOrigin: { x: number; y: number };
  canvasZoom: number;
  nodes: CanvasNode[];
  connections?: WorkspaceConnection[];
  noteConnections?: WorkspaceConnection[];
  portalConnections?: WorkspaceConnection[];
  portalToPortalConnections?: WorkspaceConnection[];
  noteToNoteConnections?: WorkspaceConnection[];
}

export interface WorkspaceConnection {
  id: string;
  terminalIdA?: string;
  terminalIdB?: string;
  terminalId?: string;
  noteNodeId?: string;
  portalNodeId?: string;
  portalIdA?: string;
  portalIdB?: string;
  noteNodeIdA?: string;
  noteNodeIdB?: string;
  ropePoints?: number[][];
  status?: "idle" | "communicating" | "disconnected" | "error";
}

export interface WorkspaceDocument {
  payload: WorkspacePayload;
  schemaVersion: number;
  type: "workspace";
}
