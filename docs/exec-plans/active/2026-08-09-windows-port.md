# Windows port: analysis and phased plan

## Executive recommendation

Build a **new Windows application in C#/.NET 8+ with WinUI 3 and WebView2**, while
preserving the existing macOS app. Treat the Maestri workspace JSON format and the
`omaestri` CLI/HTTP contract as platform-neutral product contracts. Do **not** try to
port the existing SwiftUI/AppKit target, and do not make a Swift-on-Windows UI the
foundation of the product.

This is a Windows-first port, not a replacement of the macOS implementation. It gives
Windows native input, accessibility, packaging, WebView2, and ConPTY integration,
without asking an experimental Swift UI ecosystem to replace AppKit. A later unified
desktop UI is a separate product decision: evaluate Avalonia only if maintaining macOS,
Windows, and Linux from one new UI codebase becomes a funded goal. Avalonia is a viable
cross-platform option, but it would still require a complete canvas rewrite and
platform-specific terminal/browser adapters.

The compatibility boundary must be explicit:

```text
workspace.json schema v2 + note/scrollback files + CLI request/response semantics
                              ^
                              | fixture and contract tests
 macOS Swift/AppKit       Windows .NET/WinUI 3
```

The source code itself is not broadly portable: the reusable asset is the behavior,
file format, algorithms, and tests, rather than Swift classes copied into a Windows
target.

## Problem statement

`open-maestri` is currently a macOS 14+/Swift 5.9 application. Its Package manifest
declares only `.macOS(.v14)` and the main executable depends on SwiftTerm and Sparkle.
The high-frequency canvas is an AppKit `NSView`; SwiftUI hosts its node UI through
`NSViewRepresentable`. Terminals depend on SwiftTerm/AppKit PTY views, portals depend
on WebKit, and the local IPC server combines Apple's Network framework with a Unix
domain socket.

Windows cannot execute those UI and platform integrations. A useful Windows version
therefore needs native substitutions while opening the same `workspace.json` files
without changing their schema or semantic meaning.

## Evidence from the current repository

| Area | Current implementation | Portability assessment |
| --- | --- | --- |
| Workspace data | `CanvasNode`, `NodeContent`, `WorkspaceDocument`, `WorkspacePayload`, migration v1→v2 | Contract is reusable; rewrite serialization in .NET and prove byte/semantic compatibility with fixtures. |
| Persistence | `PersistenceManager` uses JSON encoders, `~/.open-maestri`, temp-file plus replacement writes | Behavior reusable; replace filesystem paths and atomic-replace implementation. |
| Workspace state | `WorkspaceManager` and `AppState` use `@Observable`, `@MainActor`, `NotificationCenter`, timers | Business rules reusable; source needs a .NET state/store rewrite. |
| Canvas | `CanvasViewportView` is a 912-line `NSView`, with AppKit event and drawing APIs, plus SwiftUI/AppKit hosted nodes | Rewrite. Preserve coordinate transforms and performance invariants, not view code. |
| Canvas algorithms | rope math, tile snapping, viewport culling, z-order and hit-test caches | Port algorithmically; keep independent, deterministic unit tests. |
| IPC | `InterAgentServer` uses `NWListener`, loopback HTTP `POST /cli`, Unix socket, `CLIRouter` and handlers | HTTP route semantics reusable; Network/Unix-socket code needs replacement. |
| CLI | separate `omaestri` executable reads `MAESTRI_SOCKET` and `MAESTRI_TERMINAL_ID` | Commands and response text are reusable contracts; client transport and installation are rewritten. |
| Terminal | SwiftTerm `LocalProcessTerminalView`, AppKit fonts, Metal resource handling, zsh-oriented PATH setup | Rewrite around ConPTY and a Windows terminal renderer. |
| App lifecycle | `NSApplicationDelegate`, Sparkle, AppKit window management | Rewrite using Windows App SDK lifecycle/packaging and an updater strategy. |

The existing tests are a material advantage: they cover schema version 2, the
`[[x,y],[w,h]]` frame encoding, `{ "type": { "_0": ... } }` node-content unions,
legacy decoding, v1→v2 migration, router behavior, and canvas math. They should become
cross-platform fixtures before UI work begins.

## Compatibility contract: preserve exactly

The Windows app must read and write compatible documents without silently normalizing
away fields it does not yet render.

- Keep `workspace.json` at `schemaVersion: 2`; do not rename fields or change types.
- Encode every `CanvasNode.frame` as `[[x, y], [width, height]]`, never a JSON object.
- Encode `NodeContent` variants as `{ "terminal": { "_0": { ... } } }` (and the
  equivalent wrapper for each type).
- Preserve UUIDs, z-index, lock state, ISO-8601 date representation, connection lists,
  portal storage scope, and unknown-on-Windows persisted fields where feasible.
- Keep the top-level workspace layout and relative content paths. On Windows, locate
  the root under `%USERPROFILE%\\.open-maestri` initially, rather than changing the
  folder name or document layout. Store Windows-native metadata separately if required.
- Preserve `omaestri` command names, arguments, plain-text errors, terminal identity,
  and authorization semantics. Make a versioned transport capability explicit rather
  than overloading `MAESTRI_SOCKET` with a Windows path.

Add a corpus of checked-in, anonymized macOS-generated fixtures and test both
directions: macOS fixture → Windows read/write → semantic equality, and Windows output
→ macOS decoder. Include all eight current node types, all connection variants,
missing legacy fields, malformed frames, Unicode note text, and Windows paths.

## Architecture decision

### Recommended: .NET + WinUI 3 (Windows-first)

Use a solution with these boundaries:

```text
OpenMaestri.Contracts     JSON DTOs, validation, migrations, fixture tests
OpenMaestri.Domain        workspace mutations, connection rules, canvas math
OpenMaestri.Platform.Win  atomic storage, ConPTY, named pipe, shell/CLI install
OpenMaestri.App.WinUI     canvas renderer, nodes, WebView2, windows and commands
omaestri-win              thin CLI client to the local IPC endpoint
```

WinUI 3 is the preferred Windows shell because it supplies a current Windows-native UI
and has first-party WebView2 integration. WebView2 embeds Chromium content and exposes
navigation, JavaScript execution, and host-page messaging needed for the portal
automation contract. The canvas itself must be a custom renderer/control; it must not
be assembled from thousands of XAML controls.

Use a single loopback HTTP server as the first IPC transport. It already exists in
concept in the macOS server and can retain `POST /cli` plus `X-Terminal-ID`. Optionally
add a current-user Windows named-pipe adapter after the HTTP client is stable. Named
pipes are local IPC, not a transparent substitute for a Unix socket path, so the CLI
must select transport from explicit environment variables, for example
`MAESTRI_SERVER_PORT` first and `MAESTRI_PIPE_NAME` second. Do not expose either server
beyond loopback/current user.

ConPTY is the required terminal-process primitive: it creates a pseudoconsole using
pipes for I/O and supports resize/lifecycle control. Select a terminal renderer only
after a short spike proves VT/Unicode/IME/selection/resize behavior; the renderer and
ConPTY host should sit behind `ITerminalSession` so neither leaks into canvas code.
The default Windows shell should be `pwsh.exe` or `cmd.exe` by user preference, not the
persisted macOS `/bin/zsh` default.

### Rejected for the first port: Swift on Windows

SwiftPM can build non-UI Swift code in some Windows environments, but this repository's
main target relies on AppKit, SwiftUI, WebKit, Network, Sparkle, SwiftTerm, `NSView`,
and macOS application lifecycle APIs. Replacing all of these still leaves an immature
Windows UI direction and two toolchain/packaging paths. It adds risk without preserving
the current UI source. Swift can remain a reference implementation and fixture producer;
it should not block a production Windows MVP.

### Deferred alternative: Avalonia

Choose Avalonia only after an explicit decision to replace **both** platform UIs with a
shared .NET UI. It has supported Windows and macOS desktop backends and a Skia-based
rendering path, making it attractive for a future Linux target. That does not eliminate
the canvas rewrite, native terminal adapter, browser-hosting validation, macOS visual
parity work, or migration risk. Starting with it solely to ship Windows delays the
smallest viable port.

## Canvas port design

The following are mandatory behavioral/performance invariants taken from
`CanvasViewportView` and its collaborators:

- retain the canvas-space/screen-space transform (`origin + zoom`) and normalized node
  geometry;
- cull to viewport plus a 200px margin;
- maintain ascending render and descending hit-test z-index caches;
- reuse hit tests within the existing 2px movement threshold;
- mutate drag/resize state in place and avoid a full sort per pointer event;
- throttle reactive/root updates during pan and zoom to at most 60 Hz;
- layer background, drawing, nodes, connection overlay, selection, and snap guides;
- preserve marquee selection, connection creation, resize handles, keyboard shortcuts,
  minimap, tile snapping, and rope-connection behavior according to
  `docs/reference/maestri-reference-index.md`.

Implement a custom `CanvasControl` with a retained node scene and a separate overlay
renderer. Keep model mutations on the UI dispatcher and have background tasks operate
only on immutable snapshots, matching the current main-actor snapshot rule. Embed
native-heavy controls (terminal/WebView2) only for visible nodes; their input routing,
zoom, clipping, and disposal are an early technical risk that requires a spike before
committing the renderer architecture.

## Module effort and risks

Estimates are sequential engineering ranges for one experienced engineer, excluding
unplanned design changes and full QA; parallel work can shorten calendar time only after
the contract is stable.

| Module | Effort | Main risk / mitigation |
| --- | ---: | --- |
| Contract fixtures, serializer, migrations | 2–3 weeks | JSON details drift; golden fixtures and bidirectional tests gate all later phases. |
| Workspace state and atomic persistence | 1–2 weeks | Windows replacement semantics and crash recovery; temp file + atomic replace tests. |
| IPC server and Windows CLI | 2–3 weeks | Security and transport mismatch; ship loopback HTTP first, current-user pipe second. |
| Canvas MVP (pan, zoom, nodes, select, drag, resize) | 5–7 weeks | high input/render load; benchmark at realistic node counts from the first slice. |
| Connections, drawing, snapping, minimap, physics | 3–5 weeks | visual and coordinate parity; port math tests before polish. |
| ConPTY plus terminal renderer | 4–6 weeks | VT, IME, resize, scrollback and embedded-control focus; spike and acceptance matrix. |
| Portal/WebView2 and agent automation | 3–4 weeks | isolated/shared storage and automation parity; test through CLI contract. |
| App shell, settings, updater, packaging, accessibility | 3–5 weeks | packaging/signing/update policy; defer non-core settings until after vertical slice. |
| System QA and compatibility release gate | 3–4 weeks | interoperability regressions; test matrix on Windows 10/11, shells, DPI, and workspaces. |

Expected MVP: roughly **20–30 person-weeks** through terminal, portal, and core canvas
parity; full feature and release confidence requires the final QA/packaging phase.
Features currently marked partial on macOS (Floors, Routines, remote SSH) must remain
out of the Windows MVP unless separately specified.

## Phased execution plan

### Phase 0 — Freeze the interoperability contract (2–3 weeks)

1. Create the standalone .NET solution and `Contracts` project; do not modify the macOS
   serialization schema.
2. Export checked-in golden JSON fixtures from the Swift tests and representative
   workspaces.
3. Implement strict .NET DTO converters for frames and tagged unions; retain fields
   unsupported by a phase rather than dropping them.
4. Port migration and validation tests. Define the path translation policy and exact
   date/float serialization rules.

Exit gate: fixtures round-trip semantically with schema version still equal to 2.

### Phase 1 — Headless workspace and IPC vertical slice (3–5 weeks)

1. Implement persistence, workspace mutations, dirty-state snapshots, crash marker,
   and backups in .NET.
2. Implement loopback-only `POST /cli`, `X-Terminal-ID`, router/handlers, and a thin
   Windows `omaestri` executable.
3. Add a controlled ConPTY proof of concept only far enough to launch PowerShell and
   inject the CLI environment.

Exit gate: a Windows shell can use `omaestri list`, `ask`, `check`, and note operations
against a headless app process; no Unix socket is required.

### Phase 2 — Canvas compatibility MVP (5–7 weeks)

1. Build the custom canvas control, coordinate conversions, background, selection,
   pan/zoom, culling, z-order cache, and hit-test cache.
2. Render static note, text, shape, stroke, freehand, file-tree placeholders, and
   terminal placeholders from real workspace JSON.
3. Implement drag, resize, lock, marquee, node create/delete, save/reopen, and the
   initial performance telemetry/benchmarks.

Exit gate: a schema-v2 workspace can be opened, edited, saved, and reopened by both
platforms without geometry or content corruption.

### Phase 3 — Connected runtime nodes (7–10 weeks)

1. Complete terminal renderer selection and production ConPTY adapter, including
   scrollback, resize, focus, output activity, and cancellation.
2. Embed WebView2 portals, implement isolated/shared profiles, and port the portal CLI
   automation surface (navigate, DOM, snapshot, click, fill).
3. Port connection overlays, rope simulation, status rendering, and agent authorization
   checks.

Exit gate: terminal-to-terminal, terminal-to-note, terminal-to-portal, and
portal-to-portal workflows work through the same CLI semantics as macOS.

### Phase 4 — Product parity, hardening, release (6–9 weeks)

1. Add remaining node UI, file-tree/Git interactions, preferences, onboarding,
   notifications, accessibility, high-DPI and multi-monitor handling.
2. Decide updater/distribution model (MSIX versus signed installer) and implement a
   rollback-friendly update flow.
3. Run compatibility, performance, security, crash-recovery, and manual UI matrices;
   document known parity gaps.

Exit gate: signed Windows release candidate passes the compatibility suite and manual
acceptance on the supported Windows versions.

## Verification path

Each implementation phase should add platform-independent and Windows-specific checks:

1. Run the existing macOS `swift test` suite to protect the reference encoder/decoder.
2. Run .NET unit tests for golden fixture round trips, migration, atomic-save recovery,
   router text, and canvas algorithms.
3. Run an integration test that launches the Windows host, allocates a dynamic loopback
   port, launches a ConPTY shell, and executes the Windows `omaestri` CLI.
4. Manually test pointer input, native embedded terminal/browser focus, DPI scaling,
   keyboard shortcuts, portal profile isolation, recovery after forced termination, and
   opening/saving the same workspace on macOS and Windows.
5. Benchmark pan/zoom and drag at low, typical, and stress node counts; enforce the
   culling/cache invariants before broadening UI scope.

## Open risks and decisions needed before implementation

- **Supported Windows baseline:** confirm Windows 10 22H2 x64/Windows 11 x64 as the
  first target, plus whether ARM64 is in scope. This affects packaging and terminal
  renderer validation.
- **Terminal renderer:** validate licensing, maintained status, IME, accessibility,
  search/selection, and ConPTY resize behavior in a time-boxed spike. Do not commit to
  a third-party control on API shape alone.
- **Portal fidelity:** WebView2 uses Chromium rather than macOS WebKit. Define whether
  browser-engine differences are acceptable for portal automation and profile sharing.
- **Path semantics:** Windows paths may appear in persisted `workingDirectory`, custom
  note paths, and file-tree roots. Preserve strings but avoid interpreting a path from a
  different OS as a valid local path.
- **Unknown fields:** `System.Text.Json` needs extension-data handling or an explicit
  compatibility policy so Windows does not discard future macOS fields.
- **Security:** loopback HTTP needs the existing terminal-ID authorization checks; a
  named pipe must be restricted to the current user. Do not bind IPC to non-loopback
  interfaces.
- **Updater:** Sparkle is macOS-only. Choose MSIX/Store, App Installer, or a signed
  installer/update framework before beta distribution.

## External implementation references

- [Windows pseudoconsole (ConPTY)](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)
- [Named pipes in .NET](https://learn.microsoft.com/en-us/dotnet/standard/io/how-to-use-named-pipes-for-network-interprocess-communication)
- [WebView2 in WinUI 3](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winui)
- [Avalonia supported desktop platforms](https://docs.avaloniaui.net/docs/supported-platforms)
