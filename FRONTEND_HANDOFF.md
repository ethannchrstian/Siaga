# SIAGA frontend handoff

For whoever is taking over the frontend. This explains what the app does, how to
run it, how the frontend is put together, and where to change things.

You only need to touch `frontend/`. The backend is done and stable; treat it as
an API that is already running.

## Run it (5 minutes)

Two terminals.

**Backend** (leave it running, you will not edit it):
```bash
cd backend
python -m venv venv                 # first time only
venv/Scripts/pip install -r requirements.txt   # first time only (Windows)
venv/Scripts/uvicorn app.main:app --port 8000
```

**Frontend** (this is your workspace):
```bash
cd frontend
npm install                         # first time only
npm run dev                         # http://localhost:5173
```

Open http://localhost:5173. If the map is blank, the backend is not running.

Before you commit, make sure it still builds:
```bash
npm run build
```

## What the app is

A control-room dashboard for Indonesia's disaster agency. It shows the north
coast of Java where flood and drought hit at the same time, and it recommends
where to pre-position a limited fleet of water trucks and flood pumps. The
operator can approve or reject each recommendation and the plan re-optimizes.

## Feature list (what already works)

- **Dual-hazard map.** Every kecamatan (district) is colored by risk. Three view
  modes via the toggle at top:
  - **Gabungan** (default): both hazards at once. Blue = flood, orange = drought,
    purple = both high, grey = low.
  - **Banjir**: flood risk only (blue scale).
  - **Cekaman air**: water-stress risk only (orange scale).
- **Two distinct thresholds.** Both refer to modelled hazard probability, not
  resource stock:
  - **Monitoring Threshold (50%)** controls map emphasis and the monitoring
    list only. It does not trigger allocation.
  - **Critical Allocation Threshold (5%)** is the optimizer eligibility floor.
    Eligible districts are not guaranteed resources; the optimizer still weighs
    exposure, travel, shared crews, and fleet capacity.
- **Date control + presets.** Pick any date from 2015 to 2024 (this is a
  hindcast: "what would SIAGA have said on this day"). Three preset buttons jump
  to good demo dates.
- **Depot markers.** Dark dots are BPBD depots that hold the fleet.
- **Assignment arrows.** Lines from a depot to a district show where the plan
  sends trucks (orange) and pumps (blue).
- **Recommendation cards** (right panel), ranked by people exposed. Each card
  says what to send, from which depot, the hazard probability, travel time, and
  population exposed, in Indonesian.
  - **Kunci** (lock): force this recommendation to stay, then re-optimize the
    rest around it.
  - **Tolak** (reject): forbid this one, re-optimize. Rejected items show as
    chips at the top of the panel; click a chip to undo.
- **District detail drawer.** Click a district name in a card (or click the
  district on the map) to open a panel with both risk bars, population, and its
  current assignments.
- **Causal-loop panel** (bottom right). The one-paragraph explanation of why
  flood and drought are one problem. Collapsible.
- **Fleet summary** (top of the panel): how many pumps and trucks are dispatched
  out of the total, how many districts served, percent of fleet used.

## How to use it (demo walkthrough)

1. It opens on **Dua bahaya Feb 2015**. The map is mostly purple: both hazards
   high across the corridor.
2. Look at the cards. **Cilincing appears twice**, once for trucks and once for
   pumps. That is the whole point: the same district needs both on the same day.
3. Switch the toggle to **Banjir**, then **Cekaman air**, to show the two hazards
   separately, then back to **Gabungan**.
4. Click **Kemarau Sep 2023**: the map turns orange (drought season, almost all
   trucks). Click **Musim hujan Jan 2024**: it shifts toward flood.
5. Press **Tolak** on the top card. Watch the plan re-solve and a different
   district move up. This is the human-in-the-loop story.
6. Click a district name to open the drawer with its detail.

## Frontend architecture

Stack: React + TypeScript + Vite + MapLibre GL. No component library, plain CSS.

```
frontend/src/
  main.tsx              entry point (do not need to touch)
  App.tsx               top-level: holds ALL state, fetches data, wires children
  App.css               all layout + component styles
  index.css             color variables (:root) and reset
  hazard.ts             risk-to-color logic + legend definitions
  api/
    client.ts           typed functions for every backend call + all TS types
  components/
    MapView.tsx         the MapLibre map (choropleth, depots, arrows, popups)
    Controls.tsx        hazard toggle + date picker + presets (overlay on map)
    Legend.tsx          the legend box (overlay on map)
    Sidebar.tsx         recommendation cards + fleet summary + reject chips
    CausalLoop.tsx      the causal-loop explainer panel
    DistrictDrawer.tsx  the per-district detail panel
```

### Data flow (important)

`App.tsx` is the brain. It:
1. On load, fetches `/scenario` (depots, date range) and `/districts` (names).
2. When the **date** changes, fetches `/risk?date=` and stores per-district
   probabilities in a `Map`.
3. When the **date, locks, or rejects** change, POSTs `/allocate` and stores the
   returned plan.
4. Passes everything down to the children as props. Children are mostly
   presentational; they call back up (`onLock`, `onReject`, `onDate`, etc.).

So if you add a feature, the pattern is: add state in `App.tsx`, pass it down,
render it in a component. You rarely need to fetch data inside a component.

### The map is a bit special

`MapView.tsx` talks to MapLibre imperatively (MapLibre is not React). It keeps
the map in a `ref` and repaints when props change via small `useEffect`s. If you
change how districts are colored, edit `hazard.ts` (the `colorFor` function) and
the `Legend`, not the map internals.

## Where to change common things

- **Colors of the risk ramps**: `src/hazard.ts` (the `FLOOD`, `DROUGHT`,
  `COMPOUND` arrays) and the CSS variables in `src/index.css`.
- **Overall theme (navy header, borders, fonts)**: `src/index.css` `:root`.
- **Card layout / wording**: `src/components/Sidebar.tsx` + `.card*` styles in
  `App.css`.
- **Add a preset date**: the `PRESETS` array at the top of `App.tsx`.
- **Legend text**: `src/hazard.ts` (`LEGEND`) and `src/components/Legend.tsx`.
- **Map starting position / zoom**: `MapView.tsx`, the `new maplibregl.Map({...})`
  call (`center`, `zoom`).

## Ideas to improve (pick what you like)

Rough edges and nice-to-haves, roughly easy to hard:

- **Polish the cards**: icons for pump vs truck, better spacing, hover states.
- **Loading skeletons**: right now re-optimizing just shows a text line.
- **Mobile / narrow layout**: the right panel is a fixed 372px; it does not
  collapse on small screens.
- **Animated hindcast**: a play button that steps the date forward day by day so
  the map animates through a flood or drought developing. The date state and API
  already support this; you just need a timer that advances `date`.
- **Highlight the selected district on the map**: there is a dormant
  `district-highlight` layer in `MapView.tsx` that is never turned on. Wire it to
  the selected district for a nice touch.
- **Legend/scale for the arrows**: explain that arrow thickness = number of units.
- **A small time-series sparkline** in the district drawer (the backend has daily
  history; you would add an endpoint or precompute).
- **Accessibility**: keyboard focus states, aria labels on the icon buttons.

Design intent to preserve: it should look like serious agency software. Flat
surfaces, thin borders, restrained color (color means risk, not decoration), no
gradients or glassy effects, Indonesian labels throughout. Please keep that.

## API reference (what the frontend calls)

All at `http://localhost:8000`. Full typed wrappers are in `src/api/client.ts`.

- `GET /districts` -> GeoJSON of all kecamatan (boundaries + names).
- `GET /risk?date=YYYY-MM-DD` -> `{ date, date_min, date_max, districts: [{district_id, flood_prob, drought_prob}] }`. Snaps to nearest available date.
- `GET /scenario` -> `{ depots, resources, resource_labels, date_min, date_max, note }`.
- `POST /allocate` body `{ date, locks: [{district_id, resource, units}], rejects: [{district_id, resource}] }` -> `{ date, plan: [...], summary: {...} }`. The plan items carry the ready-made Indonesian `reason` string and all the numbers the cards show.

Interactive API docs are at http://localhost:8000/docs while the backend runs.

## Gotchas

- MapLibre v5 has no default export: import it as `import * as maplibregl`.
- `vite.config.ts` excludes `maplibre-gl` from dep optimization on purpose;
  removing that makes the map hang on load. Leave it.
- If the map canvas is blank but tiles load, it is a resize issue; `MapView`
  already has a `ResizeObserver` for this.
