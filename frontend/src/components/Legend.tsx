import { LEGEND, type ViewMode } from "../hazard";

interface Props {
  mode: ViewMode;
  dispatched?: { pompa: number; truk_tangki: number };
}

export default function Legend({ mode, dispatched }: Props) {
  return (
    <div className="legend">
      <div className="legend-title">
        {mode === "gabungan"
          ? "Risiko dua bahaya"
          : mode === "banjir"
            ? "Risiko banjir"
            : "Risiko cekaman air"}
      </div>
      {LEGEND[mode].map((row) => (
        <div className="legend-row" key={row.label}>
          <span className="swatch" style={{ background: row.swatch }} />
          {row.label}
        </div>
      ))}
      <div className="legend-sep" />
      <div className="legend-row">
        <span className="swatch depot-sq" />
        Depot BPBD
      </div>
      <div className="legend-row">
        <span className="swatch pill blue">{dispatched?.pompa ?? 0}</span>
        Pompa dikirim (total)
      </div>
      <div className="legend-row">
        <span className="swatch pill orange">{dispatched?.truk_tangki ?? 0}</span>
        Truk tangki dikirim (total)
      </div>
    </div>
  );
}
