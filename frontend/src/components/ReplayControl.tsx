interface Props {
  dates: string[];
  idx: number;
  onStop: () => void;
}

// Progress overlay while the hindcast replay sweeps toward the decision date.
// Occupies the CompareBanner slot: risk builds day by day, then the banner
// returns with the allocation the moment SIAGA "decides".
export default function ReplayControl({ dates, idx, onStop }: Props) {
  const pct = dates.length > 1 ? (100 * idx) / (dates.length - 1) : 0;
  return (
    <div className="replay-banner">
      <div className="replay-row">
        <span className="replay-label">Putar ulang risiko</span>
        <b className="replay-date">{formatDate(dates[idx])}</b>
        <button className="replay-stop" onClick={onStop} title="Hentikan">
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
