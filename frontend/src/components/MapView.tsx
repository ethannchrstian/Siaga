import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getDistricts,
  type Depot,
  type PlanItem,
  type RiskDistrict,
} from "../api/client";
import { mapStyleFor, type ViewMode } from "../hazard";
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

interface Props {
  risk: Map<string, RiskDistrict>;
  mode: ViewMode;
  depots: Depot[];
  plan: PlanItem[];
  onSelect: (districtId: string) => void;
  onDepot: (depotId: string) => void;
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

export default function MapView({ risk, mode, depots, plan, onSelect, onDepot }: Props) {
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
  const depotMarkersRef = useRef<maplibregl.Marker[]>([]);
  const allocMarkersRef = useRef<maplibregl.Marker[]>([]);
  const boundsRef = useRef<[[number, number], [number, number]] | null>(null);
  const fadeTokenRef = useRef(0);
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
          padding: { top: 80, bottom: 24, left: 24, right: 24 },
          duration: 350,
        });
      }),
      "top-right",
    );
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.on("error", (e) => console.error("[SIAGA] map error:", e.error));

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on("load", async () => {
      const districts = await getDistricts();
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
          padding: { top: 80, bottom: 24, left: 24, right: 24 },
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
      const el = document.createElement("div");
      el.className = "alloc-marker";
      el.innerHTML = items
        .map((p) => {
          const isPump = p.resource === "pompa";
          const color = isPump ? FLOOD : DROUGHT;
          const icon = isPump ? pumpSvg("#ffffff") : truckSvg("#ffffff");
          return `<span class="alloc-badge alloc-badge-${isPump ? "flood" : "drought"}" style="--marker-color:${color}">${icon}<b>${p.units}</b></span>`;
        })
        .join("");
      el.onclick = () => onSelect(did);
      el.title = items.map((p) => `${p.units} ${p.resource_label}`).join(" + ");
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
