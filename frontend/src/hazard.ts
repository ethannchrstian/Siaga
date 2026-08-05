import { MONITORING_THRESHOLD } from "./thresholds";

// Risk-to-color logic. Kept out of the map component so the legend and map
// agree by construction.

export type ViewMode = "gabungan" | "banjir" | "cekaman";

// Reference-matched emergency-map palette: translucent signal colors over a
// quiet monochrome basemap, with the boundary carrying most of the emphasis.
const FLOOD = ["#d1e0e6", "#6f94a8"];
const DROUGHT = ["#eddbdd", "#b4777d"];
const COMPOUND = "#8c939b";
const EMPTY = "#f3f4f4";

const OUTLINE = {
  flood: "#4b7898",
  drought: "#955159",
  compound: "#626a73",
  empty: "#a6adb3",
} as const;

function ramp(colors: string[], p: number): string {
  return p < MONITORING_THRESHOLD ? colors[0] : colors[1];
}

export function colorFor(
  mode: ViewMode,
  flood: number,
  drought: number,
): string {
  if (mode === "banjir") return ramp(FLOOD, flood);
  if (mode === "cekaman") return ramp(DROUGHT, drought);
  // gabungan: compound where both are high, else the dominant hazard's ramp
  if (flood >= MONITORING_THRESHOLD && drought >= MONITORING_THRESHOLD) return COMPOUND;
  if (flood < MONITORING_THRESHOLD && drought < MONITORING_THRESHOLD) return EMPTY;
  return drought >= flood ? DROUGHT[1] : FLOOD[1];
}

export interface DistrictMapStyle {
  fill: string;
  outline: string;
  opacity: number;
  outlineWidth: number;
}

export function mapStyleFor(
  mode: ViewMode,
  flood: number,
  drought: number,
): DistrictMapStyle {
  const activeFlood = mode !== "cekaman" ? flood : 0;
  const activeDrought = mode !== "banjir" ? drought : 0;
  const peak = Math.max(activeFlood, activeDrought);

  if (mode === "gabungan" && flood >= MONITORING_THRESHOLD && drought >= MONITORING_THRESHOLD) {
    return {
      fill: COMPOUND,
      outline: OUTLINE.compound,
      opacity: 0.9,
      outlineWidth: peak >= 0.85 ? 1.12 : 0.86,
    };
  }

  if (peak < MONITORING_THRESHOLD) {
    const lowFill = mode === "banjir" ? FLOOD[0] : mode === "cekaman" ? DROUGHT[0] : EMPTY;
    return { fill: lowFill, outline: OUTLINE.empty, opacity: 0.78, outlineWidth: 0.42 };
  }

  const isDrought = activeDrought >= activeFlood;
  return {
    fill: isDrought ? ramp(DROUGHT, activeDrought) : ramp(FLOOD, activeFlood),
    outline: isDrought ? OUTLINE.drought : OUTLINE.flood,
    opacity: peak >= MONITORING_THRESHOLD ? 0.84 : 0.76,
    outlineWidth: peak >= 0.85 ? 1.55 : peak >= MONITORING_THRESHOLD ? 1.05 : 0.7,
  };
}

export const LEGEND: Record<
  ViewMode,
  { swatch: string; outline: string; label: string }[]
> = {
  gabungan: [
    { swatch: FLOOD[1], outline: OUTLINE.flood, label: "Banjir · dipantau (≥50%)" },
    { swatch: DROUGHT[1], outline: OUTLINE.drought, label: "Cekaman · dipantau (≥50%)" },
    { swatch: COMPOUND, outline: OUTLINE.compound, label: "Keduanya dipantau" },
    { swatch: EMPTY, outline: OUTLINE.empty, label: "Di bawah pemantauan" },
  ],
  banjir: [
    { swatch: FLOOD[0], outline: OUTLINE.empty, label: "Di bawah pemantauan (<50%)" },
    { swatch: FLOOD[1], outline: OUTLINE.flood, label: "Perlu dipantau (≥50%)" },
  ],
  cekaman: [
    { swatch: DROUGHT[0], outline: OUTLINE.empty, label: "Di bawah pemantauan (<50%)" },
    { swatch: DROUGHT[1], outline: OUTLINE.drought, label: "Perlu dipantau (≥50%)" },
  ],
};
