# Process Mapper

A free, browser-only tool for business process mapping. Fill in a table of
process steps and the app draws a swim-lane process map from it as you type.
Several processes live in one workspace and share a registry of parties (the
people, teams or systems that own steps), each with a persistent colour.

Nothing leaves the browser: no backend, no accounts, no analytics. The app is
a static site.

## Using it

- **Table (left)**: one row per step. The small arrow at the top of the divider
  (or Ctrl/Cmd+\) hides the table so the map fills the window, and brings it
  back; the choice is remembered. "Pin lanes" in the header keeps each lane's
  title at the edge of the map while you pan (left edge for left-to-right
  flow, top edge for top-to-bottom), which helps when walking people through
  a wide process; exports are unaffected. Columns: No, Name, Owner, Type, Next,
  Technology, Control, Contributors, Notes. Row order has no meaning; flow is
  defined by the Next column. Tick Control on a step that involves a control
  and type its reference from your controls document; the map shows a
  "Control · REF" marker under the step (at minimal detail too), and the CSV
  and Visio exports carry the tick and the reference. The Type dropdown lists each type with its variants
  (message or timer start, sub-process task, terminate end) so a row needs a
  single choice. "Sort by flow" reorders the rows to follow the process from
  its start, one branch at a time, which is handy before reading or exporting
  the table; it changes nothing on the map and can be undone.
- **Columns**: drag the handle on a header's right edge to resize it, or focus the
  handle and use the arrow keys; double-click (or Enter) resets it. Widths are
  remembered in this browser, not in the workspace file. Notes stretches to
  fill whatever width is left.
- **Keyboard**: Enter adds a row below; Tab moves across cells; Escape closes
  pickers; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo; Cmd/Ctrl+D
  duplicates the row (everything except Next); Delete on the No cell deletes
  the row with an undo toast.
- **Owner / Contributors**: comboboxes over the party registry. An exact
  match links the existing party; a near match offers "Use X?"; otherwise a
  new party is created with the next free colour.
- **Shared steps**: a task that two parties both do stays one row in the
  table but is drawn once in each party's lane on the map. Type several
  parties in the Owner cell separated by commas ("Sales, Legal"), or type a
  party's name into a step that already has an owner and pick "Also Legal".
  The first party owns the row; the rest are co-owners and the cell shows
  them all. Every copy on the map carries the same links, so the step before
  fans out into each lane and the steps after join them again; in BPMN mode
  that is drawn with parallel gateways. Parties in the group are removed from
  the step's contributors. Picking a single party again clears the co-owners.
  One undo reverts the whole thing.
- **Teams**: when several teams run their own variant of the same process,
  build one team's process in full, then open the Team menu, "Manage teams…",
  add the first team and add the next one with "Start from" set to it. The new
  team begins with an identical route inside the same master process, so shared
  steps are drawn once. Switch the Team menu to the new team and "Only this
  team": the table and map now show that team's route alone and every edit
  changes only that route. Add a step and it belongs to the team; change a Next
  link and only the team's arrows move; press × on a shared row (or "Not for
  this team" in the row's ⋯ menu) and the team skips the step with its arrows
  reconnected around it; "Make a copy" gives the team its own version of a
  shared step when it does the step differently. Changing the Owner cell in
  this view changes who does the step for this team only: the step stays one
  shared row, and each party on it remembers which teams it does the step
  for, so the map draws that party's lane copy only for those teams and the
  all-teams view shows the scope after the name, as "Deputy Head (Central)".
  Editing any other cell of a shared step in this view (name, type,
  technology, contributors, notes) makes that copy for you first, so the
  change applies to this team only; Team A keeps the original. A copy made
  this way can be folded back later: the row's ⋯ menu offers "Merge step N
  into this one" for another team's copy with the same name and type, and
  the result is one row that keeps both teams' owners and links. With all teams showing, arrows every team
  uses stay grey and arrows only some teams use are drawn in one coloured line
  per team, side by side; steps used by a subset carry a dashed pill naming
  them. "Highlight" fades everything a team does not use and draws its route
  in its colour. Validation and exports follow the chosen team; the export
  legend lists team colours. Teams are not lanes: a "Management accountant"
  lane holds steps from every team's variant. A step or link with no team
  tags applies to every team.
- **Next**: a searchable multi-select of steps in the same process with a
  "Create new step" entry. Decisions get a label and a default toggle per
  outcome, and every link gets a team scope once teams exist.
- **Map (right)**: pan by dragging, zoom with Ctrl/Cmd + wheel or the buttons.
  Click a node to select its row and vice versa. To reorder lanes, hover a
  lane header and use the move buttons at its end, drag the header, or focus
  it and use the arrow keys. Orientation, shape mode
  (simple / BPMN) and detail level are toggles in the header. At full detail a
  task shows its technology as a pill and its contributors as initial badges
  in party colours; "Minimal" hides both for a cleaner picture. The lane
  header wraps a long party name along the lane in up to three lines and
  thickens to fit them; a name that still would not fit widens its lane, so
  no name runs into the lanes beside it.
- **Validation**: a drawer under the table lists errors and warnings for the
  active process; click one to jump to the step. Broken links offer a
  one-click "Remove link".
- **Parties**: the header's Parties button opens the registry: rename
  (workspace-wide), merge, delete (blocked while referenced), colour override.
- **Processes**: the header switcher adds, renames, duplicates and deletes
  processes.
- **Saving**: the workspace autosaves to IndexedDB in this browser. Browser
  storage can be cleared, so use Export → Workspace JSON for a real copy and
  Import to load it again. Importing into a workspace that already has
  content asks whether to **add** the file's processes beside the current
  ones (parties and teams with the same name are shared; the rest are
  created) or **replace** the workspace with the file. Adding is undoable.
- **Export**: the active process map as SVG, PNG (2x) or PDF, with a title
  block and a legend of every party on the map, owners and contributors alike.
  With a team highlighted or isolated, the export shows exactly what the map
  shows, names the team in the title block and in the filename. "Map as Visio"
  writes a .vsdx drawing: steps are editable shapes with the step's owner,
  teams, technology and notes as Shape Data, arrows are dynamic connectors
  glued to their steps so they follow when a shape is moved, lanes are
  labelled bands, and the title block and legend come along. The lanes are
  plain shapes rather than Visio's reflowing cross-functional lanes, and the
  shapes are not stencil masters, since the app ships no Microsoft stencils;
  or the active process table as CSV, with party and step names rather than
  ids, for sharing and review (CSV is export-only; import takes JSON). Fonts are embedded so exports render the same
  everywhere.

"Map as Excel (.xlsx)" writes a one-sheet workbook for people who want the map
in Excel: each lane is a band of cells with its title in the party's colour
(rows for left-to-right flow, columns for top-to-bottom) and the titles are
frozen so they stay in view; steps, decisions, arrows and outcome labels are
ordinary Excel shapes at the map's positions. Arrows follow the map's routes
exactly and are not glued to the steps, because Excel's glued connectors pick
their own route.

## Development

```sh
pnpm install
pnpm dev          # start the dev server
pnpm test         # unit tests (Vitest)
pnpm e2e          # Playwright end-to-end tests (builds and previews first)
pnpm lint
pnpm typecheck
pnpm build        # static output in dist/
```

Playwright needs a browser once: `pnpm exec playwright install chromium`.

## Stack

Vite, React 18, TypeScript (strict), Zustand with zundo for undo/redo, elkjs in
a web worker, plain SVG rendering, Tailwind, idb for IndexedDB, zod for the
file schema, jsPDF + svg2pdf.js for PDF, Vitest and Playwright.

## Layout notes

ELK's `layered` algorithm does the layer assignment and crossing minimisation.
ELK's partitioning option constrains ordering _along_ the flow, not across it,
so it cannot produce swim lanes on its own. Lanes are therefore applied in a
deterministic post-pass in `src/graph/layout.ts`: nodes keep their ELK layer
and in-layer order, and are stacked into lane bands in `laneOrder`. Edges are
routed orthogonally through node-free channels between layers and gutters
between rows. Feedback is found by a depth-first walk from the starts in step
order, so the arrow that closes a cycle is the one back to the earlier step
(a decision never lands before the step it checks), and every lane copy of a
shared step treats the same link as its feedback. A back-edge (a feedback loop such as a "No" outcome returning
to an earlier step) leaves the bottom or top of its source, runs along the
nearest node-free gutter and enters the bottom or top of its target, so it
reads as repeating that step; when no such loop is clear of every step and
name, the edge runs around the outside of the lane band instead.

## Fonts

The UI uses the variable woff2 builds of Inter and JetBrains Mono from
fontsource. Exports embed TTF builds from `public/fonts` (Inter Regular and
SemiBold, JetBrains Mono Regular) because jsPDF needs TrueType data.

## Deploying

The build output in `dist/` is a plain static site. `netlify.toml` and
`vercel.json` are included; a GitHub Actions workflow builds and deploys to
GitHub Pages on pushes to `main` (enable Pages → Source: GitHub Actions in the
repository settings). Set `VITE_BASE` if the site is served from a sub-path.

## Out of scope

Cross-process links, nested sub-processes, manual node positioning,
collaboration, accounts, swim-lane pools, timers/events beyond the start kinds
listed, BPMN XML export, Visio or draw.io export.
