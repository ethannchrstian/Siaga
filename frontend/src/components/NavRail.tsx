import { AlertIcon, FleetIcon, GridIcon, InfoIcon, MapIcon } from "../icons";

export type View = "peta" | "insiden" | "inventaris" | "ringkasan" | "tentang";

const ITEMS: { key: View; label: string; Icon: typeof MapIcon }[] = [
  { key: "peta", label: "Peta & Alokasi", Icon: MapIcon },
  { key: "insiden", label: "Pemantauan Wilayah", Icon: AlertIcon },
  { key: "inventaris", label: "Kesiapan Armada", Icon: FleetIcon },
  { key: "ringkasan", label: "Briefing Operasi", Icon: GridIcon },
  { key: "tentang", label: "Metode & Data", Icon: InfoIcon },
];

export default function NavRail({
  view,
  onView,
  monitoringCount,
  lastUpdated,
}: {
  view: View;
  onView: (v: View) => void;
  monitoringCount: number;
  lastUpdated: string;
}) {
  return (
    <nav className={`navrail navrail-${view}`} aria-label="Navigasi utama">
      <div className="navrail-brand">
        <div className="navrail-brand-name">PUSDALOPS</div>
        <div className="navrail-brand-sub">Pusat Kendali Operasi</div>
      </div>
      <div className="navrail-section">Operasi</div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`navrail-btn${view === it.key ? " active" : ""}`}
          onClick={() => onView(it.key)}
        >
          <it.Icon size={18} />
          <span>{it.label}</span>
          {it.key === "insiden" && monitoringCount > 0 && (
            <span className="nav-badge">{monitoringCount}</span>
          )}
        </button>
      ))}
      <div className="navrail-foot">
        <div className="system-status-head">
          <span className="system-icon"><FleetIcon size={20} /></span>
          <strong>Konteks data</strong>
          <span className="system-hindcast">Hindcast</span>
        </div>
        <div className="system-updated">Tanggal yang dianalisis<br />{formatDate(lastUpdated)}</div>
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
