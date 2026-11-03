# Process Mapper

A free, browser-only tool for business process mapping. Fill in a table of
process steps and the app draws a swim-lane process map from it as you type.
Several processes live in one workspace and share a registry of parties (the
people, teams or systems that own steps), each with a persistent colour.

Nothing leaves the browser: no backend, no accounts, no analytics. The app is
a static site.

## Using it

- **Table (left)**: one row per step. Columns: No, Name, Owner, Type, Next,
  Technology, Contributors, Notes. Row order has no meaning; flow is defined by
  the Next column.
- **Keyboard**: Enter adds a row below; Tab moves across cells; Escape closes
  pickers; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo; Cmd/Ctrl+D
  duplicates the row (everything except Next); Delete on the No cell deletes
  the row with an undo toast.
- **Owner / Contributors**: comboboxes over the party registry. An exact
  match links the existing party; a near match offers "Use X?"; otherwise a
  new party is created with the next free colour.
- **Next**: a searchable multi-select of steps in the same process with a
  "Create new step" entry. Decisions get a label and a default toggle per
  outcome.
- **Map (right)**: pan by dragging, zoom with Ctrl/Cmd + wheel or the buttons.
  Click a node to select its row and vice versa. Drag a lane header (or focus
  it and use the arrow keys) to reorder lanes. Orientation, shape mode
  (simple / BPMN) and detail level are toggles in the header. At full detail a
  task shows its technology as a pill and its contributors as initial badges
  in party colours; "Minimal" hides both for a cleaner picture.
- **Validation**: a drawer under the table lists errors and warnings for the
  active process; click one to jump to the step. Broken links offer a
  one-click "Remove link".
- **Parties**: the header's Parties button opens the registry: rename
  (workspace-wide), merge, delete (blocked while referenced), colour override.
- **Processes**: the header switcher adds, renames, duplicates and deletes
  processes.
- **Saving**: the workspace autosaves to IndexedDB in this browser. Browser
  storage can be cleared, so use Export → Workspace JSON for a real copy and
  Import to load it again.
- **Export**: the active process map as SVG, PNG (2x) or PDF, with a title
  block and a legend of every party on the map, owners and contributors alike. Fonts are embedded so exports render the same
  everywhere.

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
between rows; back-edges (cycles) run around the outside of the lane band.

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
