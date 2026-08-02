import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getDistricts,
  type Depot,
  type PlanItem,
  type RiskDistrict,
} from "../api/client";
import { colorFor, type ViewMode } from "../hazard";
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
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

interface Props {
  risk: Map<string, RiskDistrict>;
  mode: ViewMode;
  depots: Depot[];
  plan: PlanItem[];
  onSelect: (districtId: string) => void;
  onDepot: (depotId: string) => void;
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
    properties: { district_id: string; name: string; kabupaten: string; color?: string };
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
  const htmlMarkersRef = useRef<maplibregl.Marker[]>([]);
  const boundsRef = useRef<[[number, number], [number, number]] | null>(null);

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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
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
      geoRef.current = districts as unknown as DistrictData;

      map.addSource("districts", { type: "geojson", data: districts });
      map.addLayer({
        id: "district-fill",
        type: "fill",
        source: "districts",
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#e9ecef"],
          "fill-opacity": 0.72,
        },
      });
      map.addLayer({
        id: "district-line",
        type: "line",
        source: "districts",
        paint: { "line-color": "#6b7784", "line-width": 0.4 },
      });

      map.addSource("arrows", { type: "geojson", data: emptyFC() });
      // A soft casing under the routes so they read on any basemap color.
      map.addLayer({
        id: "arrows-casing",
        type: "line",
        source: "arrows",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "arrows",
        type: "line",
        source: "arrows",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "resource"], "pompa", FLOOD, "truk_tangki", DROUGHT, "#666"],
          "line-width": 2.6,
          "line-opacity": 0.95,
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
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${f.properties!.name}</strong><br/>${f.properties!.kabupaten}<br/>` +
              `<span style="color:${FLOOD}">Banjir ${fp}%</span> &middot; ` +
              `<span style="color:${DROUGHT}">Cekaman air ${dp}%</span>`,
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
          padding: { top: 24, bottom: 24, left: 24, right: 24 },
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
      paintHtmlMarkers();
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
    for (const f of data.features) {
      const r = riskRef.current.get(f.properties.district_id);
      f.properties.color = colorFor(mode, r?.flood_prob ?? 0, r?.drought_prob ?? 0);
    }
    (map.getSource("districts") as maplibregl.GeoJSONSource).setData(
      data as unknown as GeoJSON.FeatureCollection,
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
  function paintHtmlMarkers() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    htmlMarkersRef.current.forEach((m) => m.remove());
    htmlMarkersRef.current = [];

    // depots
    for (const d of depotsRef.current) {
      const el = document.createElement("div");
      el.className = "depot-marker";
      el.innerHTML = depotSvg();
      el.title = `${d.name} (klik untuk rincian)`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        onDepot(d.depot_id);
      };
      htmlMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([d.lon, d.lat]).addTo(map),
      );
    }

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
          const icon = isPump ? pumpSvg(color) : truckSvg(color);
          return `<span class="alloc-badge" style="border-color:${color}">${icon}<b style="color:${color}">${p.units}</b></span>`;
        })
        .join("");
      el.onclick = () => onSelect(did);
      el.title = items.map((p) => `${p.units} ${p.resource_label}`).join(" + ");
      htmlMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map),
      );
    }
  }

  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk, mode]);
  useEffect(() => {
    paintArrows();
    paintHtmlMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, depots]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
