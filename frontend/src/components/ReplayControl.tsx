interface Props {
  dates: string[];
  idx: number;
  onStop: () => void;
  restoring?: boolean;
}

// Progress overlay while the hindcast replay sweeps toward the decision date.
// Occupies the CompareBanner slot: risk builds day by day, then the banner
// returns with the allocation the moment SIAGA "decides".
export default function ReplayControl({ dates, idx, onStop, restoring = false }: Props) {
  const pct = dates.length > 1 ? (100 * idx) / (dates.length - 1) : 0;
  return (
    <div className="replay-banner">
      <div className="replay-row">
        <span className="replay-label">{restoring ? "Menyiapkan keputusan" : "Putar ulang risiko"}</span>
        <b className="replay-date">{formatDate(dates[idx])}</b>
        <button
          type="button"
          className="replay-stop"
          onClick={onStop}
          title="Hentikan putar ulang"
          aria-label="Hentikan putar ulang risiko"
          disabled={restoring}
        >
          ■
        </button>
      </div>
      <div className="replay-track">
        <div className="replay-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
