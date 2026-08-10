import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export interface TerminalOptions {
  id: string;
  command?: string;
  workingDirectory?: string;
  /** Set false when mounting a session that the host has kept alive. */
  spawn?: boolean;
}

export type TerminalMountOptions = Omit<TerminalOptions, "id">;

export class TerminalView {
  private readonly terminal = new Terminal({ cursorBlink: true, fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 12, lineHeight: 1.2, scrollback: 10_000, theme: { background: "#1E1E1E", foreground: "#D4D4D4", cursor: "#D4D4D4", selectionBackground: "#264F78", black: "#1E1E1E", brightBlack: "#666666", green: "#608B4E", brightGreen: "#B5CEA8" } });
  private readonly fit = new FitAddon(); private unlisten?: UnlistenFn; private resizeObserver?: ResizeObserver; private disposed = false; private connected = false;
  constructor(private readonly host: HTMLElement, private readonly options: TerminalOptions) {
    this.terminal.loadAddon(this.fit); this.terminal.open(host); this.fitAndResize();
    this.terminal.onData((data) => { if (this.connected) void invoke("terminal_write", { id: options.id, data }); });
    this.resizeObserver = new ResizeObserver(() => this.fitAndResize()); this.resizeObserver.observe(host); void this.connect();
  }
  private async connect(): Promise<void> {
    this.unlisten = await listen<string>(`terminal:data:${this.options.id}`, (event) => this.terminal.write(event.payload));
    if (this.disposed) { this.unlisten(); return; }
    try {
      if (this.options.spawn !== false) {
        await invoke("terminal_spawn", { id: this.options.id, command: this.options.command ?? "", workingDirectory: this.options.workingDirectory ?? "", columns: this.terminal.cols, rows: this.terminal.rows });
      } else {
        const scrollback = await invoke<string>("terminal_scrollback", { id: this.options.id });
        this.terminal.write(scrollback);
      }
      this.connected = true;
      this.fitAndResize();
    }
    catch (error) { this.terminal.write(`\r\n\x1b[31mCould not start terminal: ${String(error)}\x1b[0m\r\n`); }
  }
  private fitAndResize(): void {
    if (this.disposed || !this.host.isConnected || this.host.clientWidth < 8 || this.host.clientHeight < 8) return;
    this.fit.fit(); if (this.connected) void invoke("terminal_resize", { id: this.options.id, columns: this.terminal.cols, rows: this.terminal.rows });
  }
  dispose(): void { this.disposed = true; this.resizeObserver?.disconnect(); this.unlisten?.(); this.terminal.dispose(); void invoke("terminal_close", { id: this.options.id }); }
}

/** Mounts a complete terminal into a node body and returns its lifecycle handle. */
export function mountTerminal(container: HTMLElement, terminalId: string, options: TerminalMountOptions = {}): TerminalView {
  return new TerminalView(container, { id: terminalId, ...options });
}
