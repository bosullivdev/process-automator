# CLAUDE.md

## What this is

A free, browser-only web tool for business process mapping. The user fills in a table of process steps (name, owner, type, next steps, technology, contributors, notes) and the app builds a swim-lane process map from it in real time. Several processes live in one workspace and share a registry of parties (the people, teams or systems that own steps), each with a persistent colour.

Nothing leaves the browser. No backend, no accounts, no analytics. The app is deployed as a static site.

Build the whole thing in one pass, in the order given under "Build order". Do not stop to ask for confirmation between stages unless something in this file is contradictory or impossible.

## Principles (apply everywhere)

1. The table is the source of truth. The map is a pure function of workspace data plus view settings. Never store derived layout in the data.
2. Always render. Invalid or incomplete data produces a map with flags, never a blank panel or an error page.
3. Never silently rewire. Deleting or changing something that other rows reference produces visible broken links, not automatic repairs.
4. Deterministic layout. The same data in the same orientation always produces the same picture.
5. Every edit is undoable.
6. Keyboard-first table entry. A user should be able to build a full process without touching the mouse.

## Stack

- Vite + React 18 + TypeScript, `strict: true`, no `any`.
- State: Zustand, with an undo/redo history middleware covering all workspace edits (not view settings).
- Layout: elkjs (web worker build). Use `layered` algorithm with partitioning for lanes.
- Rendering: plain SVG in React. No canvas libraries, no react-flow.
- Styling: Tailwind. Light and dark mode via `prefers-color-scheme` with a manual override stored in view settings.
- Fonts: Inter for UI, JetBrains Mono (tabular) for step IDs. Self-host both.
- Persistence: IndexedDB via `idb`. Manual export/import as JSON.
- Export: SVG serialised from the live map; PNG via canvas rasterisation at 2x; PDF via `svg2pdf.js` + jsPDF.
- Tests: Vitest for pure logic (validation, graph utilities, palette, migrations, layout determinism). Playwright for one end-to-end flow.
- Lint/format: ESLint + Prettier, run in CI.
- Package manager: pnpm.

## Data model

Use these types verbatim in `src/model/types.ts`. IDs are nanoid strings, generated once, never reused, never shown to users as raw strings (show a short display number per process instead).

```ts
export type StepType = "start" | "task" | "decision" | "end";
export type StartKind = "none" | "message" | "timer";
export type EndKind = "normal" | "terminate";

export interface Workspace {
  schemaVersion: 1;
  meta: { name: string; createdAt: string; updatedAt: string };
  parties: Party[];
  processes: Process[];
  view: ViewSettings;
}

export interface Party {
  id: string;
  name: string;
  colourIndex: number;        // index into palette, see "Party colours"
  colourOverride?: string;    // hex, workspace-wide manual override
}

export interface Process {
  id: string;
  name: string;
  owner?: string;
  version?: string;
  date?: string;
  laneOrder: string[];        // party IDs, per process
  steps: Step[];              // array order is table row order
}

export interface Step {
  id: string;
  displayNo: number;          // 1-based, per process, stable once assigned
  name: string;
  type: StepType;
  ownerId: string | null;     // null = Unassigned lane
  next: NextLink[];           // empty allowed only on "end"
  technology: string;
  contributorIds: string[];   // party IDs
  notes: string;
  isSubProcess?: boolean;     // visual marker only
  startKind?: StartKind;      // start only
  endKind?: EndKind;          // end only
}

export interface NextLink {
  targetId: string;           // step ID in the same process
  label?: string;             // required on decision, ignored otherwise
  isDefault?: boolean;        // decision only, at most one true per step
}

export interface ViewSettings {
  orientation: "horizontal" | "vertical";
  shapeMode: "simple" | "bpmn";
  theme: "system" | "light" | "dark";
  splitRatio: number;         // 0.2 to 0.8
  activeProcessId: string | null;
}
```

Include a `migrate(json: unknown): Workspace` function from day one that validates with zod and upgrades older `schemaVersion` values. Version 1 is the only version now; the function must still exist and be tested.

## Flow rules

- Row order in the table has no meaning for flow. Flow is defined entirely by `next`.
- `start`: must have at least one `next`. Nothing may point at a start.
- `task`: one `next` is a plain arrow; two or more is a parallel fork.
- `decision`: two or more `next`, each with a non-empty `label`. Labels on one decision must be unique (case-insensitive, trimmed). At most one link may have `isDefault: true`.
- `end`: `next` must be empty; the field is disabled in the UI.
- A step may not point at itself. Block this in the picker and in validation.
- Cycles are allowed. Two or more steps pointing at the same target is an implicit join; there is no join node.
- Links only target steps in the same process. Cross-process references are free text in `notes`.
- A decision outcome that finishes the process must point at an `end` step. An empty `next` on a non-end step always means "incomplete".

## Validation rules

Implement as pure functions in `src/model/validate.ts` returning `Flag[]` with `{ severity: "error" | "warning", code, stepId?, partyId?, message }`. The map renders regardless of flags. Codes:

Errors:
- `broken-link`: a `next.targetId` that does not exist in the process.
- `self-link`: step points at itself.
- `start-has-incoming`: a start step is a target.
- `end-has-next`: an end step has links.
- `decision-missing-label`: a decision link without a label.
- `decision-duplicate-label`.
- `decision-multiple-default`.
- `unknown-party`: an `ownerId` or `contributorId` not in the registry.

Warnings:
- `incomplete`: non-end step with no `next`.
- `decision-too-few`: decision with fewer than two links.
- `decision-many`: decision with more than five links.
- `no-start`, `no-end` (process level).
- `unreachable`: step not reachable from any start.
- `dead-end`: step that cannot reach any end (covers dead cycles).
- `orphan`: non-start step with no incoming links.
- `unassigned-owner`: `ownerId` is null.

The validation panel lists all flags for the active process; clicking one selects the step in both table and map and scrolls/pans to it.

## Layout rules

- Build an ELK graph per process: one partition per lane in `laneOrder`, with an extra "Unassigned" partition at the end if any step has `ownerId: null`. Lanes with zero steps are omitted from the map but kept in `laneOrder`.
- Orientation `horizontal`: lanes stacked top to bottom, flow left to right. `vertical`: lanes side by side, flow top to bottom. Only the ELK direction and partition axis change.
- Pin all `start` steps to the first layer. Do not pin `end` steps.
- Back-edges (cycles) route around the outside of the lane band, not through nodes.
- Run layout in a web worker, debounced at 150 ms after the last edit. Show a subtle "updating" state, never a spinner that hides the map.
- Determinism: sort nodes and edges by step `displayNo` before handing to ELK, and fix all ELK options that introduce randomness.
- Pan and zoom only. No manual node dragging.

## Party registry

Parties are workspace-level. Lanes and contributors reference parties by ID.

- The owner cell is a combobox over the registry. Exact match (case-insensitive, trimmed) links the existing party. A near match (Levenshtein distance 2 or less, or one is a prefix of the other) offers "Use X?" before creating a new party. Otherwise a new party is created and takes the next colour.
- "Unassigned" is a fixed grey pseudo-lane, not a party, and never consumes a palette slot.
- Rename is workspace-wide and keeps the colour.
- Merge: pick a survivor; every `ownerId` and `contributorId` across every process is updated; the dropped party's `colourIndex` is released.
- Delete is blocked while the party is referenced anywhere; show which processes use it and offer merge instead. Unreferenced parties are kept and shown in an "unused" group.
- Contributors use the same registry and combobox, multi-select.

### Party colours

- A palette of 12 base hues in `src/design/palette.ts`, each with a light-mode and dark-mode variant, chosen for hue separation and for deuteranopia/protanopia/tritanopia distinguishability. Dark text must pass WCAG AA on every light-mode variant.
- `colourIndex` 0 to 11 maps directly. 12 to 23 uses the same hues at a lighter tint plus a diagonal hairline stripe pattern on lane headers and node borders. 24+ continues the pattern with a darker shade and a dotted pattern. Never block creating a party because the palette is "full".
- New parties take the lowest free `colourIndex`.
- `colourOverride` replaces the computed colour in both modes.

## Processes

- Header has a process switcher. Actions per process: add, rename, duplicate, delete (with confirm). Duplicate copies steps, links and lane order.
- Deleting the last process creates a fresh empty one.
- `laneOrder` is per process; drag lane headers in the map to reorder. Colour is not per process.
- `displayNo` is assigned on creation as max+1 and never reassigned, so "step 7" stays step 7 after deletions.

## Table

Columns in order: No (read-only), Name, Owner, Type, Next, Technology, Contributors, Notes. Type defaults to `task`.

- Next is a searchable multi-select picker showing "No: Name" for steps in the same process, with a "Create new step" entry at the bottom that adds a blank row owned by the same party, links it, and focuses its Name cell. Self is excluded from the list. For a decision, each selected target gets an inline label input and a "default" toggle.
- Keyboard: Enter adds a row below and focuses Name; Tab moves across cells; Escape closes pickers; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z for undo/redo; Cmd/Ctrl+D duplicates the row (copies everything except `next`); Delete key on a selected row deletes with an undo toast.
- Deleting a step leaves `broken-link` errors on referring rows, each with a one-click "remove link" action.
- Row flags show as a coloured dot in the No column with a tooltip.
- Selecting a row highlights its node; selecting a node highlights and scrolls to its row.

## UI layout

- Desktop: resizable split pane, table left, map right, `splitRatio` persisted. Validation panel is a collapsible drawer under the table. Party registry opens as a side sheet from the header.
- Below 900 px viewport width: table and map become two tabs. Never show a two-pane layout on narrow screens.
- Header: app name placeholder, process switcher, orientation toggle, shape mode toggle, theme toggle, undo/redo, parties, import, export menu, saved indicator.

## Rendering

### Simple mode
- start: circle; end: circle with thick border; task: rounded rectangle (8 px radius); decision: diamond.
- Node fill is the surface colour (white in light mode, dark grey in dark mode) with a 2 px border in the owner's party colour. Unassigned uses grey.
- Lane background is the party colour at 8 to 10 percent opacity; lane header is a solid band in the party colour with the party name in dark text (light mode) or light text (dark mode, with a darker band).
- Arrows: neutral grey, 1.5 px, with arrowhead. Selected step's arrows switch to the accent colour and 2.5 px.
- Decision labels in a small pill on the arrow near the diamond; spread labels when several arrows leave in the same direction. A default outcome shows a small "default" tag beside the label.
- Contributors: 8 px dots along the bottom edge inside the node, one per contributor in that party's colour, with tooltip.
- Flags: 10 px dot on the top-right corner of the node, amber for warning, red for error, with tooltip listing messages.
- `isSubProcess`: small "+" box icon at the bottom centre of a task node.
- Technology, if set, as a small muted line under the step name. Notes only in tooltip.

### BPMN mode
Same data, different shapes. Nothing is stored per mode.
- start: thin circle, with message envelope or clock icon inside for `startKind`.
- end: thick circle; `terminate` adds a filled centre.
- task: rounded rectangle.
- decision: exclusive gateway (diamond with X). Default outcome gets the slash mark on the arrow.
- A task with two or more `next` renders an inserted parallel gateway (diamond with +) after the task. Two or more links converging on one step render an inserted parallel gateway before it. These inserted gateways are layout-only and have no ID.
- Where a `terminate` end is reached while another parallel branch is still running, draw that branch's remaining arrows dashed.

## Design system

- Neutral chrome: near-white background in light mode, deep charcoal in dark mode. One accent colour (muted indigo, not in the party palette) for buttons, selection, focus rings.
- Semantic colours: amber for warnings, red for errors and broken links, green for the saved indicator. Nothing else is coloured.
- 8 px radii throughout. No gradients. One faint shadow on the floating divider handle only.
- Generous whitespace; aim for the feel of Linear or Excalidraw, not an enterprise diagramming suite.
- All interactive elements keyboard-reachable with visible focus rings. Respect `prefers-reduced-motion`.

## Persistence and export

- Autosave: debounced 500 ms write of the whole workspace to IndexedDB, one record per browser profile. Header shows "Saved" / "Saving" / "Unsaved changes". Show a one-time dismissible notice that browser storage can be cleared and export is the real save.
- Import: file picker for JSON. Run `migrate`. If the current workspace has unsaved differences from its autosave, or is non-empty, ask: replace, or cancel. Never merge silently.
- Export JSON: pretty-printed workspace, filename `<workspace-name>-<date>.json`.
- Export map: SVG, PNG (2x), PDF for the active process, in the current orientation and shape mode. Include a title block (process name, owner, version, date) and a lane legend. Fonts must be embedded or converted to paths in SVG and PDF so exports render identically elsewhere.
- Before unload with unsaved changes, warn.

## Testing

Required before the build is considered done:
- Unit tests for every validation code, including cycles and dead cycles.
- Graph utilities: reachability from starts, reachability to ends, cycle detection.
- Party matching (exact, near, new), merge, colour index allocation and release.
- `migrate` accepts a valid v1 file, rejects malformed input with a readable error, and round-trips export → import unchanged.
- Layout determinism: lay out a fixture process ten times in each orientation and assert identical output.
- Playwright: create two parties, add a start, task, decision with three labelled outcomes, two ends, assert the map shows the expected lanes, nodes and labels, flip orientation, switch to BPMN, export SVG and assert it contains the step names.

## Build order

1. Scaffold, lint, Tailwind, fonts, theme toggle, empty shell with split pane and narrow-screen tabs.
2. Types, zod schema, `migrate`, palette, party utilities, with tests.
3. Zustand store with undo/redo and IndexedDB autosave.
4. Table with all columns, combobox owner/contributor, Next picker, keyboard handling, row flags.
5. Validation functions and the validation panel, with tests.
6. ELK graph builder, worker, simple-mode SVG renderer, pan/zoom, selection sync both ways, lane drag-reorder, orientation toggle.
7. BPMN renderer, including inserted gateways.
8. Party registry sheet: rename, merge, delete rules, override colour.
9. Process switcher and process actions.
10. Import/export JSON, SVG/PNG/PDF export.
11. Playwright flow, README, deploy config for a static host.

## Out of scope for this build

Cross-process links, nested sub-processes, manual node positioning, collaboration, accounts, swim-lane pools, timers/events beyond the start kinds listed, BPMN XML export, Visio or draw.io export.

## Working conventions for Claude Code

- Keep logic in `src/model` and `src/graph` free of React so it is testable.
- No feature flags, no TODO comments left in; either implement or list under out of scope.
- Commit after each build-order step with a one-line message.
- If a library listed here cannot be installed or does not do what this file assumes, choose the closest replacement, note it in the README, and carry on.
