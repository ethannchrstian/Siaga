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
      <div className="legend-sep" />
      <div className="legend-row">
        <span className="swatch depot-sq" />
        Depot BPBD
      </div>
      <div className="legend-row">
        <span className="swatch pill blue">7</span>
        Pompa dikirim (jumlah)
      </div>
      <div className="legend-row">
        <span className="swatch pill orange">7</span>
        Truk tangki dikirim (jumlah)
      </div>
    </div>
  );
}
