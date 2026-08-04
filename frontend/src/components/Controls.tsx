import type { ViewMode } from "../hazard";

interface Props {
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  date: string;
  dateMin: string;
  dateMax: string;
  onDate: (d: string) => void;
  presets: { label: string; date: string }[];
}

const MODES: { key: ViewMode; label: string }[] = [
  { key: "gabungan", label: "Gabungan" },
  { key: "banjir", label: "Banjir" },
  { key: "cekaman", label: "Cekaman air" },
];

export default function Controls({
  mode,
  onMode,
  date,
  dateMin,
  dateMax,
  onDate,
  presets,
}: Props) {
  return (
    <div className="controls">
      <div className="seg">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={`seg-btn${mode === m.key ? " active" : ""}`}
            onClick={() => onMode(m.key)}
          >
            {m.label}
          </button>
        ))}
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
          />
        </label>
        {presets.map((p) => (
          <button
            key={p.date}
            className={`chip${date === p.date ? " active" : ""}`}
            onClick={() => onDate(p.date)}
          >
            {p.label}
          </button>
        ))}
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
