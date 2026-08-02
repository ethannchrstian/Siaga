import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getDistricts } from "../api/client";

// Flat, label-light basemap so the risk choropleth carries the screen.
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

// Deterministic placeholder risk until /risk exists: hash the id to [0, 1).
function dummyRisk(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [108.5, -6.5], // Pantura corridor
      zoom: 7,
      attributionControl: { compact: true },
      // Needed so headless/CDP screenshots capture the WebGL canvas.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    map.on("error", (e) => console.error("[SIAGA] map error:", e.error));

    map.on("load", async () => {
      const districts = await getDistricts();

      for (const f of districts.features) {
        (f.properties as Record<string, unknown>).risk = dummyRisk(
          f.properties.district_id,
        );
      }

      map.addSource("districts", { type: "geojson", data: districts });

      map.addLayer({
        id: "district-fill",
        type: "fill",
        source: "districts",
        paint: {
          "fill-color": [
            "step",
            ["get", "risk"],
            "#e8ecef",
            0.25, "#c6dbef",
            0.5, "#6baed6",
            0.75, "#2171b5",
          ],
          "fill-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "district-line",
        type: "line",
        source: "districts",
        paint: { "line-color": "#7f8b96", "line-width": 0.5 },
      });

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
      });

      map.on("mousemove", "district-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const p = f.properties as {
          name: string;
          kabupaten: string;
          risk: number;
        };
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${p.name}</strong><br/>` +
              `${p.kabupaten}<br/>` +
              `Risiko (placeholder): ${(p.risk * 100).toFixed(0)}%`,
          )
          .addTo(map);
      });

      map.on("mouseleave", "district-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
