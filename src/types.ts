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
}

export interface WorkspaceDocument {
  payload: WorkspacePayload;
  schemaVersion: number;
  type: "workspace";
}
