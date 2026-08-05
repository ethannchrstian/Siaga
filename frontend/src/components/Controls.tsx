import type { ViewMode } from "../hazard";
import { AlertIcon, ResetIcon } from "../icons";

export type CompareMode = "siaga" | "terpisah";

interface Props {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  compare: CompareMode;
  onCompare: (mode: CompareMode) => void;
  onReplay?: () => void;
  onDisrupt?: () => void;
  disabled?: boolean;
}

const MODES: { key: ViewMode; label: string; horizon: string }[] = [
  { key: "gabungan", label: "Gabungan", horizon: "Dua horizon" },
  { key: "banjir", label: "Banjir", horizon: "0–72 jam" },
  { key: "cekaman", label: "Cekaman air", horizon: "Bulan depan" },
];

const COMPARE_MODES: { key: CompareMode; label: string; note: string }[] = [
  { key: "siaga", label: "Terpadu", note: "SIAGA" },
  { key: "terpisah", label: "Terpisah", note: "Baseline" },
];

export default function Controls({
  mode,
  onMode,
  compare,
  onCompare,
  onReplay,
  onDisrupt,
  disabled = false,
}: Props) {
  return (
    <div className={`controls map-mode-control${disabled ? " controls-disabled" : ""}`}>
      <span className="map-mode-label">Tampilan risiko</span>
      <div className="seg map-risk-seg">
        {MODES.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`seg-btn${mode === item.key ? " active" : ""}`}
            onClick={() => onMode(item.key)}
            disabled={disabled}
          >
            <span>{item.label}</span>
            <small>{item.horizon}</small>
          </button>
        ))}
      </div>

      <div className="map-feature-row">
        <div
          className="seg seg-compare"
          aria-label="Bandingkan rencana terpadu dan terpisah"
          title="Bandingkan koordinasi SIAGA dengan penanganan dua bahaya secara terpisah"
        >
          {COMPARE_MODES.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`seg-btn${compare === item.key ? " active" : ""}`}
              onClick={() => onCompare(item.key)}
              disabled={disabled}
            >
              <span>{item.label}</span>
              <small>{item.note}</small>
            </button>
          ))}
        </div>

        {onReplay && (
          <button
            type="button"
            className="map-feature-button"
            onClick={onReplay}
            disabled={disabled}
            title="Putar ulang 3 minggu risiko menuju tanggal terpilih"
          >
            <ResetIcon size={13} />
            <span>Putar ulang</span>
          </button>
        )}
        {onDisrupt && (
          <button
            type="button"
            className="map-feature-button disrupt"
            onClick={onDisrupt}
            disabled={disabled}
            title="Simulasikan rute ke alokasi banjir teratas yang terputus"
          >
            <AlertIcon size={13} />
            <span>Jalur putus</span>
          </button>
        )}
      </div>
    </div>
  );
}
