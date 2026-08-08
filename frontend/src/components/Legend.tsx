import { LEGEND, type ViewMode } from "../hazard";
import { ChevronDownIcon } from "../icons";
import {
  CRITICAL_ALLOCATION_THRESHOLD_HELP,
  CRITICAL_ALLOCATION_THRESHOLD_PERCENT,
  MONITORING_THRESHOLD_HELP,
  MONITORING_THRESHOLD_PERCENT,
} from "../thresholds";

interface Props {
  mode: ViewMode;
  dispatched?: { pompa: number; truk_tangki: number };
}

export default function Legend({ mode, dispatched }: Props) {
  return (
    <div className="legend">
      <details className="legend-disclosure">
        <summary className="legend-summary">
          <span className="legend-summary-copy">
            <small>Legenda risiko</small>
          </span>
          <ChevronDownIcon size={14} aria-hidden="true" />
        </summary>

        <div className="legend-content">
          <div className="legend-section-label">Tingkat risiko</div>
          {LEGEND[mode].map((row) => (
            <div className="legend-row" key={row.label}>
              <span className="swatch" style={{ background: row.swatch, borderColor: row.outline }} />
              {row.label}
            </div>
          ))}
          <div className="legend-sep" />
          <div className="legend-section-label">Penanda alokasi</div>
          <div className="legend-row">
            <span className="swatch depot-sq" />
            Depot BPBD
          </div>
          <div className="legend-row">
            <span className="swatch allocation-sq blue">{dispatched?.pompa ?? 0}</span>
            Pompa dikirim (total)
          </div>
          <div className="legend-row">
            <span className="swatch allocation-sq red">{dispatched?.truk_tangki ?? 0}</span>
            Truk tangki dikirim (total)
          </div>
          <div className="legend-sep" />
          {/* A new encoding on the map needs a key, or it is just decoration. */}
          <div className="legend-section-label">Status keputusan</div>
          <div className="legend-row">
            <span className="swatch decision-sq pending" aria-hidden="true" />
            Menunggu keputusan operator
          </div>
          <div className="legend-row">
            <span className="swatch decision-sq locked" aria-hidden="true">&#10003;</span>
            Dikunci, tidak diubah optimasi ulang
          </div>
          <div className="legend-row">
            <span className="swatch decision-sq pending ring" aria-hidden="true" />
            Dua bahaya &amp; belum diputuskan
          </div>
          <div className="legend-thresholds">
            <div className="legend-section-label">Ambang sistem</div>
            <div className="legend-threshold-guide" aria-label="Perbedaan ambang sistem">
              <div title={MONITORING_THRESHOLD_HELP}>
                <b>{MONITORING_THRESHOLD_PERCENT}%</b>
                <span>Ambang Pemantauan<small>warna &amp; peringatan visual</small></span>
              </div>
              <div title={CRITICAL_ALLOCATION_THRESHOLD_HELP}>
                <b>{CRITICAL_ALLOCATION_THRESHOLD_PERCENT}%</b>
                <span>Ambang Alokasi Kritis<small>kelayakan optimizer</small></span>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
