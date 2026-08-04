// Risk-to-color logic. Kept out of the map component so the legend and map
// agree by construction.

export type ViewMode = "gabungan" | "banjir" | "cekaman";

const FLOOD = ["#f0f6fd", "#d7e8fb", "#9fc7f4", "#5a9bf2"]; // light -> deep blue
const DROUGHT = ["#fff2f2", "#fbdcde", "#f5adb1", "#f47b82"]; // light -> coral red
const COMPOUND = "#bcc4ce"; // both hazards high; darker base, rendered at low map opacity
const EMPTY = "#eef1f4";

const HI = 0.5; // "high" hazard threshold used for the compound class

function ramp(colors: string[], p: number): string {
  if (p < 0.05) return colors[0];
  if (p < 0.25) return colors[1];
  if (p < 0.5) return colors[2];
  return colors[3];
}

export function colorFor(
  mode: ViewMode,
  flood: number,
  drought: number,
): string {
  if (mode === "banjir") return flood < 0.05 ? EMPTY : ramp(FLOOD, flood);
  if (mode === "cekaman") return drought < 0.05 ? EMPTY : ramp(DROUGHT, drought);
  // gabungan: compound where both are high, else the dominant hazard's ramp
  if (flood >= HI && drought >= HI) return COMPOUND;
  if (flood < 0.05 && drought < 0.05) return EMPTY;
  return drought >= flood ? ramp(DROUGHT, drought) : ramp(FLOOD, flood);
}

export const LEGEND: Record<
  ViewMode,
  { swatch: string; label: string }[]
> = {
  gabungan: [
    { swatch: FLOOD[3], label: "Risiko banjir tinggi" },
    { swatch: DROUGHT[3], label: "Risiko cekaman air tinggi" },
    { swatch: COMPOUND, label: "Keduanya (gabungan)" },
    { swatch: EMPTY, label: "Rendah / tidak ada" },
  ],
  banjir: [
    { swatch: FLOOD[1], label: "Rendah" },
    { swatch: FLOOD[2], label: "Sedang" },
    { swatch: FLOOD[3], label: "Tinggi" },
  ],
  cekaman: [
    { swatch: DROUGHT[1], label: "Rendah" },
    { swatch: DROUGHT[2], label: "Sedang" },
    { swatch: DROUGHT[3], label: "Tinggi" },
  ],
};
