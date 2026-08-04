// Raw SVG strings for HTML map markers. Kept as strings (not React) because
// maplibregl.Marker takes a DOM element.

const stroke = (path: string, color: string) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const truckSvg = (color: string) =>
  stroke(
    `<rect x="1" y="6" width="13" height="10"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>`,
    color,
  );

export const pumpSvg = (color: string) =>
  stroke(
    `<path d="M4 20h16"/><path d="M7 20v-6a5 5 0 0 1 10 0v6"/><path d="M12 9V4M9 4h6"/>`,
    color,
  );

export const depotSvg = () =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-5 9 5v12"/><path d="M3 21h18"/><rect x="9" y="13" width="6" height="8"/></svg>`;

export const FLOOD = "#3478f6";
export const DROUGHT = "#ff5a5f";
