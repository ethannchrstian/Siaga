import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getDistricts,
  type Depot,
  type PlanItem,
  type RiskDistrict,
} from "../api/client";
import { mapStyleFor, type ViewMode } from "../hazard";
import { playDispatch, playRedirect } from "./dispatchAnimation";
import { CRITICAL_ALLOCATION_THRESHOLD, MONITORING_THRESHOLD } from "../thresholds";
import {
  depotSvg,
  DROUGHT,
  FLOOD,
  pumpSvg,
  truckSvg,
} from "../mapmarkers";

// Labeled street basemap so districts have real geographic context
// (place names, coastline, roads), unlike the blank tiles before.
const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap, &copy; CARTO",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#edf0f1" },
    },
    {
      id: "carto",
      type: "raster",
      source: "carto",
      paint: {
        "raster-saturation": -1,
        "raster-contrast": -0.2,
        "raster-brightness-min": 0.42,
        "raster-brightness-max": 1,
        "raster-opacity": 0.48,
      },
    },
  ],
};

// Allocation badges are anchored on a kecamatan's centroid and can be ~100px
// wide when a district gets both a pump and a truck. Cilincing sits at the far
// west end of the corridor, so a tight fit clipped half its badge against the
// canvas edge. Pad enough for the widest marker on either side.
const CORRIDOR_PADDING = { top: 84, bottom: 34, left: 76, right: 76 };

interface Props {
  risk: Map<string, RiskDistrict>;
  mode: ViewMode;
  depots: Depot[];
  plan: PlanItem[];
  onSelect: (districtId: string) => void;
  onDepot: (depotId: string) => void;
  /** Kecamatan under the cursor in the decision list; outlined on the map. */
  highlightedId?: string | null;
  /** "districtId:resource" keys the operator has locked; drawn as committed. */
  lockedKeys?: Set<string>;
}

export interface MapHandle {
  /** Pan to a kecamatan and pulse it, so a card click has a visible target. */
  focusDistrict: (districtId: string) => void;
  /** Send a unit along its route; resolves on arrival. */
  dispatch: (item: PlanItem) => void;
  /** Show a route being cut before the optimizer re-solves around it. */
  redirect: (item: PlanItem) => void;
}

class ResetViewControl implements maplibregl.IControl {
  private container?: HTMLDivElement;
  private readonly onReset: () => void;

  constructor(onReset: () => void) {
    this.onReset = onReset;
  }

  onAdd() {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-reset-icon";
    button.title = "Tampilkan seluruh wilayah";
    button.setAttribute("aria-label", "Tampilkan seluruh wilayah");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4"/></svg>';
    button.addEventListener("click", this.onReset);
    this.container.appendChild(button);
    return this.container;
  }

  onRemove() {
    this.container?.remove();
    this.container = undefined;
  }
}

// Gojek-style flowing dash along the supply routes, so the direction of flow
// (depot -> district) reads at a glance. Defined before the component so
// Vite Fast Refresh never sees it as used-before-defined.
function startRouteAnimation(map: maplibregl.Map) {
  const steps: number[][] = [
    [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5],
    [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5],
    [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5],
    [0, 3, 3, 1], [0, 3.5, 3, 0.5],
  ];
  let i = 0;
  const tick = () => {
    if (!map.getLayer("arrows")) return;
    map.setPaintProperty("arrows", "line-dasharray", steps[i % steps.length]);
    i++;
    window.setTimeout(() => requestAnimationFrame(tick), 55);
  };
  requestAnimationFrame(tick);
}

interface DistrictData {
  type: "FeatureCollection";
  features: {
    properties: {
      district_id: string;
      name: string;
      kabupaten: string;
      color?: string;
      outline?: string;
      opacity?: number;
      outlineWidth?: number;
    };
    geometry: GeoJSON.Geometry;
  }[];
}

function centroid(geom: GeoJSON.Geometry): [number, number] {
  const rings =
    geom.type === "Polygon"
      ? geom.coordinates
      : geom.type === "MultiPolygon"
        ? geom.coordinates.flat()
        : [];
  let sx = 0, sy = 0, n = 0;
  for (const ring of rings)
    for (const [x, y] of ring as [number, number][]) {
      sx += x; sy += y; n++;
    }
  return n ? [sx / n, sy / n] : [0, 0];
}

function styleDistricts(
  data: DistrictData,
  risk: Map<string, RiskDistrict>,
  mode: ViewMode,
): DistrictData {
  return {
    ...data,
    features: data.features.map((feature) => {
      const districtRisk = risk.get(feature.properties.district_id);
      const style = mapStyleFor(
        mode,
        districtRisk?.flood_prob ?? 0,
        districtRisk?.drought_prob ?? 0,
      );
      return {
        ...feature,
        properties: {
          ...feature.properties,
          color: style.fill,
          outline: style.outline,
          opacity: style.opacity,
          outlineWidth: style.outlineWidth,
        },
      };
    }),
  };
}

function MapView(
  { risk, mode, depots, plan, onSelect, onDepot, highlightedId, lockedKeys }: Props,
  ref: React.Ref<MapHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  const geoRef = useRef<DistrictData | null>(null);
  const depotsRef = useRef<Depot[]>(depots);
  depotsRef.current = depots;
  const riskRef = useRef<Map<string, RiskDistrict>>(risk);
  riskRef.current = risk;
  const planRef = useRef<PlanItem[]>(plan);
  planRef.current = plan;
  const lockedKeysRef = useRef<Set<string>>(lockedKeys ?? new Set());
  lockedKeysRef.current = lockedKeys ?? new Set();
  const depotMarkersRef = useRef<maplibregl.Marker[]>([]);
  const allocMarkersRef = useRef<maplibregl.Marker[]>([]);
  const boundsRef = useRef<[[number, number], [number, number]] | null>(null);
  const fadeTokenRef = useRef(0);
  const dispatchTokenRef = useRef(0);
  const hadPlanRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [108.5, -6.6],
      zoom: 7.3,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new ResetViewControl(() => {
        if (!boundsRef.current) return;
        map.fitBounds(boundsRef.current, {
          padding: CORRIDOR_PADDING,
          duration: 350,
        });
      }),
      "top-right",
    );
    map.addControl(new maplibregl.FullscreenControl(), "top-right");

    async function fetchDistrictsWithRetry(attempts = 4) {
      for (let i = 0; i < attempts; i++) {
        try {
          return await getDistricts();
        } catch (e) {
          if (i === attempts - 1) {
            console.error("[SIAGA] gagal memuat batas kecamatan:", e);
            return null;
          }
          await new Promise((r) => setTimeout(r, 400 * 2 ** i));
        }
      }
      return null;
    }
    map.on("error", (e) => console.error("[SIAGA] map error:", e.error));

    // Coalesce to one resize per frame. A panel that animates its width fires
    // this observer continuously, and an unthrottled map.resize() on every
    // notification is what makes the collapse stutter.
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        map.resize();
      });
    });
    ro.observe(containerRef.current);

    map.on("load", async () => {
      // A cold backend loses this race and the map silently ends up with no
      // polygons and no click handlers. Retry rather than fail closed.
      const districts = await fetchDistrictsWithRetry();
      if (!districts) return;
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      for (const f of districts.features) {
        centroidsRef.current.set(f.properties.district_id, centroid(f.geometry));
        const rings =
          f.geometry.type === "Polygon"
            ? f.geometry.coordinates
            : f.geometry.type === "MultiPolygon"
              ? f.geometry.coordinates.flat()
              : [];
        for (const ring of rings)
          for (const [x, y] of ring as [number, number][]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
      }
      geoRef.current = styleDistricts(
        districts as unknown as DistrictData,
        riskRef.current,
        mode,
      );

      map.addSource("districts", { type: "geojson", data: geoRef.current as unknown as GeoJSON.FeatureCollection });
      map.addLayer({
        id: "district-fill",
        type: "fill",
        source: "districts",
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#f3f4f4"],
          "fill-opacity": ["coalesce", ["get", "opacity"], 0.66],
        },
      });
      // The kecamatan the operator is pointing at in the plan list. A fill
      // tint plus an outline: an outline alone is easy to lose among 324
      // polygons, and the point is to make "this card is that place" instant.
      // Filtered rather than re-baked, so hovering costs nothing.
      map.addLayer({
        id: "district-highlight-fill",
        type: "fill",
        source: "districts",
        filter: ["==", ["get", "district_id"], "__none__"],
        paint: {
          "fill-color": "#12182d",
          "fill-opacity": 0.24,
        },
      });
      map.addLayer({
        id: "district-highlight",
        type: "line",
        source: "districts",
        filter: ["==", ["get", "district_id"], "__none__"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#12182d",
          "line-width": 1.5,
          "line-opacity": 0.95,
        },
      });
      map.addSource("arrows", { type: "geojson", data: emptyFC() });
      // A soft casing under the routes so they read on any basemap color.
      map.addLayer({
        id: "arrows-casing",
        type: "line",
        source: "arrows",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": 0.42 },
      });
      map.addLayer({
        id: "arrows",
        type: "line",
        source: "arrows",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "resource"], "pompa", FLOOD, "truk_tangki", DROUGHT, "#666"],
          "line-width": 2.1,
          "line-opacity": 0.68,
          "line-dasharray": [0, 2, 3],
        },
      });
      startRouteAnimation(map);

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", "district-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const id = f.properties!.district_id as string;
        const r = riskRef.current.get(id);
        const fp = r ? Math.round(r.flood_prob * 100) : 0;
        const dp = r ? Math.round(r.drought_prob * 100) : 0;
        const peak = Math.max(r?.flood_prob ?? 0, r?.drought_prob ?? 0);
        const thresholdContext = peak >= MONITORING_THRESHOLD
          ? "Melewati Ambang Pemantauan 50%"
          : peak >= CRITICAL_ALLOCATION_THRESHOLD
            ? "Di bawah pemantauan · masuk rentang optimizer 5–49%"
            : "Di bawah kedua ambang";
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${f.properties!.name}</strong><br/>${f.properties!.kabupaten}<br/>` +
              `<span style="color:${FLOOD}">Banjir ${fp}%</span> &middot; ` +
              `<span style="color:${DROUGHT}">Cekaman air ${dp}%</span><br/>` +
              `<small>${thresholdContext}</small>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "district-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "district-fill", (e) => {
        const f = e.features?.[0];
        if (f) onSelect(f.properties!.district_id as string);
      });

      readyRef.current = true;
      // Zoom to the corridor so the strip fills the frame (no empty Java).
      boundsRef.current = [[minX, minY], [maxX, maxY]];
      const fit = () =>
        mapRef.current?.fitBounds(boundsRef.current!, {
          padding: CORRIDOR_PADDING,
          duration: 0,
        });
      // Re-fit after each resize so the settled canvas shows the whole corridor.
      [0, 120, 350, 700].forEach((ms) =>
        setTimeout(() => {
          mapRef.current?.resize();
          fit();
        }, ms),
      );
      // Lock the map to the corridor: can't pan into empty ocean/inland or
      // zoom out past the affected strip.
      setTimeout(() => {
        const m = mapRef.current;
        if (!m) return;
        const pad = 0.25;
        m.setMaxBounds([
          [minX - pad, minY - pad],
          [maxX + pad, maxY + pad],
        ]);
        m.setMinZoom(Math.max(m.getZoom() - 0.4, 6));
      }, 800);
      paint();
      paintArrows();
      paintDepotMarkers();
      paintAllocMarkers();
      hadPlanRef.current = planRef.current.length > 0;
    });

    return () => {
      ro.disconnect();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function paint() {
    const map = mapRef.current;
    const data = geoRef.current;
    if (!map || !readyRef.current || !data) return;
    const nextData = styleDistricts(data, riskRef.current, mode);
    geoRef.current = nextData;
    (map.getSource("districts") as maplibregl.GeoJSONSource).setData(
      nextData as unknown as GeoJSON.FeatureCollection,
    );
  }

  function paintArrows() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const depotById = new Map(depotsRef.current.map((d) => [d.name, d]));
    const feats: GeoJSON.Feature[] = [];
    for (const p of planRef.current) {
      const dc = centroidsRef.current.get(p.district_id);
      const dep = depotById.get(p.from_depot);
      if (!dc || !dep) continue;
      feats.push({
        type: "Feature",
        properties: { resource: p.resource },
        geometry: { type: "LineString", coordinates: [[dep.lon, dep.lat], dc] },
      });
    }
    (map.getSource("arrows") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: feats,
    });
  }

  // Depots and allocations as HTML markers so they carry real icons + counts.
  // Painted separately: depots are stable, allocations swap with the plan.
  function paintDepotMarkers() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    depotMarkersRef.current.forEach((m) => m.remove());
    depotMarkersRef.current = [];
    for (const d of depotsRef.current) {
      const el = document.createElement("div");
      el.className = "depot-marker";
      el.innerHTML = depotSvg();
      el.title = `${d.name} (klik untuk rincian)`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        onDepot(d.depot_id);
      };
      depotMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([d.lon, d.lat]).addTo(map),
      );
    }
  }

  function paintAllocMarkers() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    allocMarkersRef.current.forEach((m) => m.remove());
    allocMarkersRef.current = [];

    // allocations grouped by district (a district can get both a pump and a truck)
    const byDistrict = new Map<string, PlanItem[]>();
    for (const p of planRef.current) {
      const arr = byDistrict.get(p.district_id) ?? [];
      arr.push(p);
      byDistrict.set(p.district_id, arr);
    }
    for (const [did, items] of byDistrict) {
      const c = centroidsRef.current.get(did);
      if (!c) continue;
      // Compound districts need both a pump and a truck on the same day: the
      // thesis case. Flag it on the map so it isn't just another grey polygon.
      const isCompound = new Set(items.map((p) => p.resource)).size > 1;
      const el = document.createElement("div");
      el.className = `alloc-marker${isCompound ? " alloc-marker-compound" : ""}`;
      const badges = items
        .map((p) => {
          const isPump = p.resource === "pompa";
          const color = isPump ? FLOOD : DROUGHT;
          // currentColor so one pair of icons serves both the filled locked
          // badge and the hollow pending one.
          const icon = isPump ? pumpSvg("currentColor") : truckSvg("currentColor");
          // Decision state is carried by fill and outline, never by a new hue:
          // colour on this map means hazard, and nothing else. Locked is a
          // committed decision, filled and sealed with a check. Pending is
          // hollow with a dashed edge, so a glance at the map says what is
          // still open without anything having to move.
          const locked = lockedKeysRef.current.has(`${p.district_id}:${p.resource}`);
          // The one thing worth animating. A compound kecamatan that is still
          // undecided is where the shared-crew trade-off actually bites, and
          // there are only ever a handful, so a slow ring there still means
          // something. Pulsing all thirteen pending badges would mean nothing.
          const urgent = !locked && isCompound;
          const state = locked ? " is-locked" : " is-pending";
          return `<span class="alloc-badge alloc-badge-${isPump ? "flood" : "drought"}${state}${urgent ? " needs-decision" : ""}" style="--marker-color:${color}">${icon}<b>${p.units}</b>${locked ? '<i class="alloc-lock" aria-hidden="true">&#10003;</i>' : ""}</span>`;
        })
        .join("");
      const pendingHere = items.filter(
        (p) => !lockedKeysRef.current.has(`${p.district_id}:${p.resource}`),
      ).length;
      // Stacked in normal flow, never absolutely positioned: a MapLibre marker
      // element owns its own position/transform, and overriding either detaches
      // it from its coordinate.
      el.innerHTML = isCompound
        ? `<span class="alloc-flag" aria-hidden="true">DUA BAHAYA</span><span class="alloc-badges">${badges}</span>`
        : badges;
      el.onclick = () => onSelect(did);
      const load = items.map((p) => `${p.units} ${p.resource_label}`).join(" + ");
      const status = pendingHere === 0
        ? "seluruhnya dikunci"
        : `${pendingHere} menunggu keputusan`;
      el.title = isCompound
        ? `Dua bahaya bersamaan · ${load} · ${status}`
        : `${load} · ${status}`;
      // Mount transparent; the CSS transition fades it in on the next frame.
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.style.opacity = "1";
      });
      allocMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map),
      );
    }
  }

  // Crossfade to a new plan: routes + badges fade out, repaint, fade back in.
  // Used when one plan replaces another (compare toggle, lock/reject re-solve)
  // so the swap reads as a deliberate exchange rather than a flicker.
  function swapPlan() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const token = ++fadeTokenRef.current;
    const OUT = 160;

    const setLineOpacity = (v: number) => {
      if (!map.getLayer("arrows")) return;
      map.setPaintProperty("arrows", "line-opacity", 0.95 * v);
      map.setPaintProperty("arrows-casing", "line-opacity", 0.7 * v);
    };
    for (const m of allocMarkersRef.current) m.getElement().style.opacity = "0";

    const t0 = performance.now();
    const fadeOut = (now: number) => {
      if (token !== fadeTokenRef.current) return;
      const t = Math.min(1, (now - t0) / OUT);
      setLineOpacity(1 - t);
      if (t < 1) requestAnimationFrame(fadeOut);
      else {
        paintArrows();
        paintAllocMarkers();
        const t1 = performance.now();
        const fadeIn = (n: number) => {
          if (token !== fadeTokenRef.current) return;
          const u = Math.min(1, (n - t1) / OUT);
          setLineOpacity(u);
          if (u < 1) requestAnimationFrame(fadeIn);
        };
        requestAnimationFrame(fadeIn);
      }
    };
    requestAnimationFrame(fadeOut);
  }

  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk, mode]);
  useEffect(() => {
    paintDepotMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depots]);
  useEffect(() => {
    const swapping = hadPlanRef.current && plan.length > 0;
    hadPlanRef.current = plan.length > 0;
    if (swapping) swapPlan();
    else {
      paintArrows();
      paintAllocMarkers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  useEffect(() => {
    const map = mapRef.current;
    // Guard both layers, not just one: filtering a layer that does not exist
    // yet throws, and they can be briefly out of step during a hot reload.
    if (
      !map ||
      !readyRef.current ||
      !map.getLayer("district-highlight") ||
      !map.getLayer("district-highlight-fill")
    ) {
      return;
    }
    const filter: maplibregl.FilterSpecification = [
      "==",
      ["get", "district_id"],
      highlightedId ?? "__none__",
    ];
    map.setFilter("district-highlight", filter);
    map.setFilter("district-highlight-fill", filter);
  }, [highlightedId]);

  // Locking does not always change the plan, so the badges need their own
  // repaint trigger to pick up the committed state.
  useEffect(() => {
    paintAllocMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedKeys]);

  // The drawer no longer overlaps the canvas (it takes its own width via
  // .map-wrap.with-drawer), so framing only needs room for the floating
  // controls at the top and the legend at the bottom left.
  const FRAME_PADDING = { top: 74, bottom: 46, left: 56, right: 56 };

  useImperativeHandle(ref, () => ({
    focusDistrict(districtId: string) {
      const map = mapRef.current;
      const center = centroidsRef.current.get(districtId);
      if (!map || !center) return;
      // Wait a frame so the canvas has finished shrinking for the drawer,
      // otherwise we centre against the old width and it lands off to one side.
      window.setTimeout(() => {
        const m = mapRef.current;
        if (!m) return;
        m.resize();
        m.easeTo({ center, zoom: Math.max(m.getZoom(), 8.6), duration: 700 });
        pulseAt(m, center);
      }, 240);
    },
    dispatch(item: PlanItem) {
      const map = mapRef.current;
      const to = centroidsRef.current.get(item.district_id);
      const dep = depotsRef.current.find((d) => d.name === item.from_depot);
      if (!map || !to || !dep) return;
      const token = ++dispatchTokenRef.current;
      const from: [number, number] = [dep.lon, dep.lat];
      // Frame the whole route first, otherwise the unit can travel entirely
      // off-screen and the operator sees nothing at all.
      map.fitBounds(
        [
          [Math.min(from[0], to[0]), Math.min(from[1], to[1])],
          [Math.max(from[0], to[0]), Math.max(from[1], to[1])],
        ],
        { padding: FRAME_PADDING, maxZoom: 10, duration: 600 },
      );
      window.setTimeout(() => {
        if (token !== dispatchTokenRef.current || !mapRef.current) return;
        playDispatch(map, from, to, item.resource, () => token !== dispatchTokenRef.current)
          .then(() => {
            if (token === dispatchTokenRef.current) {
              pulseAt(map, to, item.resource === "pompa" ? "flood" : "drought");
            }
          });
      }, 640);
    },
    redirect(item: PlanItem) {
      const map = mapRef.current;
      const to = centroidsRef.current.get(item.district_id);
      const dep = depotsRef.current.find((d) => d.name === item.from_depot);
      if (!map || !to || !dep) return;
      dispatchTokenRef.current += 1; // cancel any unit still in flight
      const from: [number, number] = [dep.lon, dep.lat];
      map.fitBounds(
        [
          [Math.min(from[0], to[0]), Math.min(from[1], to[1])],
          [Math.max(from[0], to[0]), Math.max(from[1], to[1])],
        ],
        { padding: FRAME_PADDING, maxZoom: 10, duration: 500 },
      );
      playRedirect(map, from, to);
    },
  }));

  // Sized by CSS, not inline style, so the wrapper can shrink the canvas when a
  // drawer opens. The ResizeObserver above turns that into a map.resize().
  return <div ref={containerRef} className="map-canvas" />;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/** One-shot ring at a coordinate: gives a click or an arrival a visible target. */
function pulseAt(map: maplibregl.Map, at: [number, number], tone = "flood") {
  const el = document.createElement("div");
  el.className = `map-pulse map-pulse-${tone}`;
  const marker = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
  window.setTimeout(() => marker.remove(), 1100);
}

export default forwardRef<MapHandle, Props>(MapView);
