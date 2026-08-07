// Dispatch feedback on the map.
//
// Locking or redirecting a recommendation used to change only a button label,
// so an operator could not tell that anything had happened. These give the two
// actions a physical reading: a unit travels its route, or a route is cut.

import * as maplibregl from "maplibre-gl";
import { DROUGHT, FLOOD, pumpSvg, truckSvg } from "../mapmarkers";

type Coord = [number, number];

// Accelerate out of the depot, cruise, decelerate into the destination. A pure
// ease-out front-loads the whole trip and reads as a snap rather than travel.
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const lerp = (a: Coord, b: Coord, t: number): Coord => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/**
 * Send a unit along its route, depot to kecamatan. Resolves on arrival so the
 * caller can pulse the destination or flip card state at the right moment.
 * A token guards against a second click overtaking the first.
 */
export function playDispatch(
  map: maplibregl.Map,
  from: Coord,
  to: Coord,
  resource: "pompa" | "truk_tangki",
  isCancelled: () => boolean,
): Promise<void> {
  const color = resource === "pompa" ? FLOOD : DROUGHT;
  const el = document.createElement("div");
  el.className = `dispatch-unit dispatch-unit-${resource === "pompa" ? "flood" : "drought"}`;
  el.innerHTML = resource === "pompa" ? pumpSvg(color) : truckSvg(color);

  const marker = new maplibregl.Marker({ element: el }).setLngLat(from).addTo(map);

  if (prefersReducedMotion()) {
    marker.remove();
    return Promise.resolve();
  }

  // Slow enough to follow. At ~1.2s the eye arrives after the unit does, which
  // defeats the point of showing the trip at all.
  const DURATION = 2100;
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      if (isCancelled()) {
        marker.remove();
        resolve();
        return;
      }
      const t = Math.min((now - start) / DURATION, 1);
      marker.setLngLat(lerp(from, to, easeInOutCubic(t)));
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      // Hold at the destination so arrival reads as an event, not a vanish.
      el.classList.add("arrived");
      window.setTimeout(() => {
        marker.remove();
        resolve();
      }, 420);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Mark a route as cut: an X at the midpoint that fades out. Runs while the
 * optimizer re-solves, so the wait reads as consequence rather than lag.
 */
export function playRedirect(map: maplibregl.Map, from: Coord, to: Coord): void {
  const el = document.createElement("div");
  el.className = "dispatch-cut";
  el.textContent = "✕";
  const marker = new maplibregl.Marker({ element: el })
    .setLngLat(lerp(from, to, 0.5))
    .addTo(map);
  window.setTimeout(() => marker.remove(), prefersReducedMotion() ? 200 : 900);
}
