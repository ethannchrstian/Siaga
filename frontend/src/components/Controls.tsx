import type { ViewMode } from "../hazard";

export type CompareMode = "siaga" | "terpisah";

interface Props {
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  compare: CompareMode;
  onCompare: (c: CompareMode) => void;
  date: string;
  dateMin: string;
  dateMax: string;
  onDate: (d: string) => void;
  presets: { label: string; date: string }[];
  onReplay?: () => void;
  onDisrupt?: () => void;
  disabled?: boolean;
}

const MODES: { key: ViewMode; label: string }[] = [
  { key: "gabungan", label: "Gabungan" },
  { key: "banjir", label: "Banjir" },
  { key: "cekaman", label: "Cekaman air" },
];

const COMPARES: { key: CompareMode; label: string }[] = [
  { key: "siaga", label: "Terpadu (SIAGA)" },
  { key: "terpisah", label: "Terpisah" },
];

export default function Controls({
  mode,
  onMode,
  compare,
  onCompare,
  date,
  dateMin,
  dateMax,
  onDate,
  presets,
  onReplay,
  onDisrupt,
  disabled,
}: Props) {
  return (
    <div className={`controls${disabled ? " controls-disabled" : ""}`}>
      <div className="seg-row">
        <div className="seg">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`seg-btn${mode === m.key ? " active" : ""}`}
              onClick={() => onMode(m.key)}
              disabled={disabled}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="seg seg-compare" title="Bandingkan rencana terpadu dengan penanganan dua bahaya secara terpisah">
          {COMPARES.map((c) => (
            <button
              key={c.key}
              className={`seg-btn${compare === c.key ? " active" : ""}`}
              onClick={() => onCompare(c.key)}
              disabled={disabled}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="date-row">
        <label className="date-picker">
          <span>{formatDate(date)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
            <path d="M8 3.5v4M16 3.5v4M3.5 10h17" />
          </svg>
          <input
            type="date"
            aria-label="Pilih tanggal risiko"
            value={date}
            min={dateMin}
            max={dateMax}
            onChange={(e) => onDate(e.target.value)}
            disabled={disabled}
          />
        </label>
        {presets.map((p) => (
          <button
            key={p.date}
            className={`chip${date === p.date ? " active" : ""}`}
            onClick={() => onDate(p.date)}
            disabled={disabled}
          >
            {p.label}
          </button>
        ))}
        {onReplay && (
          <button
            className="chip chip-replay"
            onClick={onReplay}
            disabled={disabled}
            title="Putar ulang 3 minggu risiko menuju tanggal terpilih"
          >
            ▶ Putar ulang
          </button>
        )}
        {onDisrupt && (
          <button
            className="chip chip-disrupt"
            onClick={onDisrupt}
            disabled={disabled}
            title="Simulasi laporan lapangan: rute ke alokasi banjir teratas terputus"
          >
            ⚠ Jalur terputus
          </button>
        )}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
