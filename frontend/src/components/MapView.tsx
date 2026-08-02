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

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
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
}

// Rough polygon centroid (average of exterior ring vertices). Good enough to
// anchor depot->district arrows.
function centroid(geom: GeoJSON.Geometry): [number, number] {
  const rings =
    geom.type === "Polygon"
      ? geom.coordinates
      : geom.type === "MultiPolygon"
        ? geom.coordinates.flat()
        : [];
  let sx = 0,
    sy = 0,
    n = 0;
  for (const ring of rings)
    for (const [x, y] of ring as [number, number][]) {
      sx += x;
      sy += y;
      n++;
    }
  return n ? [sx / n, sy / n] : [0, 0];
}

export default function MapView({ risk, mode, depots, plan, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  const depotsRef = useRef<Depot[]>(depots);
  depotsRef.current = depots;
  const riskRef = useRef<Map<string, RiskDistrict>>(risk);
  riskRef.current = risk;
  const geoRef = useRef<DistrictData | null>(null);

  // one-time init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [108.5, -6.7],
      zoom: 7.2,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-left");

    // The flex layout can settle after the map initializes, leaving the canvas
    // sized wrong (blank). Keep it in sync with the container.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on("load", async () => {
      const districts = await getDistricts();
      for (const f of districts.features)
        centroidsRef.current.set(
          f.properties.district_id,
          centroid(f.geometry),
        );
      geoRef.current = districts as unknown as DistrictData;

      map.addSource("districts", { type: "geojson", data: districts });
      map.addLayer({
        id: "district-fill",
        type: "fill",
        source: "districts",
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#e9ecef"],
          "fill-opacity": 0.8,
        },
      });
      map.addLayer({
        id: "district-line",
        type: "line",
        source: "districts",
        paint: { "line-color": "#8894a0", "line-width": 0.4 },
      });
      map.addLayer({
        id: "district-highlight",
        type: "line",
        source: "districts",
        paint: { "line-color": "#14273f", "line-width": 2 },
        filter: ["==", "district_id", "__none__"],
      });

      map.addSource("arrows", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "arrows",
        type: "line",
        source: "arrows",
        paint: {
          "line-color": [
            "match",
            ["get", "resource"],
            "pompa",
            "#2171b5",
            "truk_tangki",
            "#cc4c02",
            "#666",
          ],
          "line-width": ["interpolate", ["linear"], ["get", "units"], 1, 1, 15, 4],
          "line-opacity": 0.7,
        },
      });

      map.addSource("depots", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "depots",
        type: "circle",
        source: "depots",
        paint: {
          "circle-radius": 5,
          "circle-color": "#14273f",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
      });
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
            `<strong>${f.properties!.name}</strong><br/>` +
              `${f.properties!.kabupaten}<br/>` +
              `Banjir ${fp}% &middot; Cekaman air ${dp}%`,
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
      map.resize();
      paint();
      paintDepots();
      paintArrows();
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // repaint choropleth when risk or mode changes
  function paint() {
    const map = mapRef.current;
    const data = geoRef.current;
    if (!map || !readyRef.current || !data) return;
    for (const f of data.features) {
      const r = riskRef.current.get(f.properties.district_id);
      f.properties.color = colorFor(
        mode,
        r?.flood_prob ?? 0,
        r?.drought_prob ?? 0,
      );
    }
    (map.getSource("districts") as maplibregl.GeoJSONSource).setData(
      data as unknown as GeoJSON.FeatureCollection,
    );
  }

  function paintDepots() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("depots") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: depotsRef.current.map((d) => ({
        type: "Feature",
        properties: { name: d.name },
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
      })),
    });
  }

  function paintArrows() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const depotById = new Map(depotsRef.current.map((d) => [d.name, d]));
    const feats: GeoJSON.Feature[] = [];
    for (const p of plan) {
      const dc = centroidsRef.current.get(p.district_id);
      const dep = depotById.get(p.from_depot);
      if (!dc || !dep) continue;
      feats.push({
        type: "Feature",
        properties: { resource: p.resource, units: p.units },
        geometry: {
          type: "LineString",
          coordinates: [[dep.lon, dep.lat], dc],
        },
      });
    }
    (map.getSource("arrows") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: feats,
    });
  }

  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk, mode]);
  useEffect(() => {
    paintArrows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  useEffect(() => {
    paintDepots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depots]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

interface DistrictData {
  type: "FeatureCollection";
  features: {
    properties: { district_id: string; name: string; kabupaten: string; color?: string };
    geometry: GeoJSON.Geometry;
  }[];
}
