import { AlertIcon, FleetIcon, GridIcon, InfoIcon, MapIcon } from "../icons";

export type View = "peta" | "insiden" | "inventaris" | "ringkasan" | "tentang";

const ITEMS: { key: View; label: string; Icon: typeof MapIcon }[] = [
  { key: "peta", label: "Peta Risiko", Icon: MapIcon },
  { key: "insiden", label: "Insiden Aktif", Icon: AlertIcon },
  { key: "inventaris", label: "Inventaris", Icon: FleetIcon },
  { key: "ringkasan", label: "Ringkasan", Icon: GridIcon },
  { key: "tentang", label: "Tentang", Icon: InfoIcon },
];

export default function NavRail({
  view,
  onView,
  incidentCount,
  lastUpdated,
}: {
  view: View;
  onView: (v: View) => void;
  incidentCount: number;
  lastUpdated: string;
}) {
  return (
    <nav className={`navrail navrail-${view}`} aria-label="Navigasi utama">
      <div className="navrail-brand">
        <div className="navrail-brand-name">PUSDALOPS</div>
        <div className="navrail-brand-sub">Pusat Kendali Operasi</div>
      </div>
      <div className="navrail-section">Modul</div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`navrail-btn${view === it.key ? " active" : ""}`}
          onClick={() => onView(it.key)}
        >
          <it.Icon size={18} />
          <span>{it.label}</span>
          {it.key === "insiden" && incidentCount > 0 && (
            <span className="nav-badge">{incidentCount}</span>
          )}
        </button>
      ))}
      <div className="navrail-foot">
        <div className="system-status-head">
          <span className="system-icon"><FleetIcon size={20} /></span>
          <strong>Status Sistem</strong>
          <span className="system-online"><span className="dot-live" /> Online</span>
        </div>
        <div className="system-updated">Terakhir diperbarui<br />{formatDate(lastUpdated)}</div>
      </div>
    </nav>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
