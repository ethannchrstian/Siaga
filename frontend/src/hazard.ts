import { MONITORING_THRESHOLD } from "./thresholds";

// Risk-to-color logic. Kept out of the map component so the legend and map
// agree by construction.

export type ViewMode = "gabungan" | "banjir" | "cekaman" | "rob";

// Reference-matched emergency-map palette: translucent signal colors over a
// quiet monochrome basemap, with the boundary carrying most of the emphasis.
const FLOOD = ["#d1e0e6", "#6f94a8"];
const DROUGHT = ["#eddbdd", "#b4777d"];
// Both hazards at once, which is the single case this product exists for.
// Purple because blue and red combined say it without a legend, and because
// the panels have always drawn the "Majemuk" chip in this hue family. It used
// to be grey #8c939b here: 7% saturation, a shade off the near-grey that means
// "no hazard at all", so the most severe state was the least visible thing on
// the map and never matched its own chip. This is a lighter tint of the panel
// purple so the three hazard fills sit at comparable lightness.
const COMPOUND = "#8a6a99";
const EMPTY = "#f3f4f4";

// Radar is a different kind of statement from the hazard ramps: it reports what
// was seen, not what is expected. Teal keeps it visually separate from the
// flood blue so nobody reads an observation as a forecast.
const ROB = ["#dce9e8", "#5c9a95", "#2f6f6c"];
const ROB_OUTLINE = "#2f6f6c";

const OUTLINE = {
  flood: "#4b7898",
  drought: "#955159",
  compound: "#5d4269",
  empty: "#a6adb3",
  rob: ROB_OUTLINE,
} as const;

// Anomaly bands in fraction of kecamatan area above that month's own normal.
// Mirrors ANOM_WATCH / ANOM_HIGH in ml/build_rob.py; both must move together.
export const ROB_WATCH = 0.02;
export const ROB_HIGH = 0.06;

export function robFill(anomaly: number | null | undefined): string {
  if (anomaly === null || anomaly === undefined) return EMPTY;
  if (anomaly >= ROB_HIGH) return ROB[2];
  if (anomaly >= ROB_WATCH) return ROB[1];
  return ROB[0];
}

function ramp(colors: string[], p: number): string {
  return p < MONITORING_THRESHOLD ? colors[0] : colors[1];
}

export function colorFor(
  mode: ViewMode,
  flood: number,
  drought: number,
  robAnomaly?: number | null,
): string {
  if (mode === "rob") return robFill(robAnomaly);
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
  robAnomaly?: number | null,
): DistrictMapStyle {
  // Radar mode ignores the model entirely. The whole point of the layer is to
  // show what was observed independently of what was predicted.
  if (mode === "rob") {
    const unobserved = robAnomaly === null || robAnomaly === undefined;
    const high = !unobserved && robAnomaly >= ROB_HIGH;
    return {
      fill: robFill(robAnomaly),
      outline: unobserved ? OUTLINE.empty : OUTLINE.rob,
      opacity: unobserved ? 0.5 : 0.84,
      outlineWidth: high ? 1.55 : unobserved ? 0.42 : 0.86,
    };
  }

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
  // Radar bands are area above the kecamatan's own normal for this month, so
  // the labels say "di atas normal" and never "peluang". It is an observation.
  rob: [
    { swatch: ROB[0], outline: OUTLINE.empty, label: "Normal untuk bulan ini" },
    { swatch: ROB[1], outline: OUTLINE.rob, label: "Genangan di atas normal (≥2%)" },
    { swatch: ROB[2], outline: OUTLINE.rob, label: "Genangan luas (≥6% luas wilayah)" },
    { swatch: EMPTY, outline: OUTLINE.empty, label: "Tidak terpantau radar" },
  ],
};
