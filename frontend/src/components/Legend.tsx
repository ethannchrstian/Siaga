import { LEGEND, type ViewMode } from "../hazard";

export default function Legend({ mode }: { mode: ViewMode }) {
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
      <div className="legend-row" style={{ marginTop: 6 }}>
        <span className="swatch depot-dot" />
        Depot BPBD
      </div>
    </div>
  );
}
