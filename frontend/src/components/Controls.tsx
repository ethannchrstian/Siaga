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
        <input
          type="date"
          value={date}
          min={dateMin}
          max={dateMax}
          onChange={(e) => onDate(e.target.value)}
        />
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
