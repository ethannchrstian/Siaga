import { AlertIcon, FleetIcon, GridIcon, InfoIcon, MapIcon } from "../icons";

export type View = "peta" | "insiden" | "inventaris" | "ringkasan" | "tentang";

// Two groups: what you do during an operation, and how to check the system's
// reasoning. Metode & Data is reference material, not an operational screen.
const SECTIONS: { label: string; items: { key: View; label: string; Icon: typeof MapIcon }[] }[] = [
  {
    label: "Operasi",
    items: [
      { key: "peta", label: "Peta & Alokasi", Icon: MapIcon },
      { key: "insiden", label: "Pemantauan Wilayah", Icon: AlertIcon },
      { key: "inventaris", label: "Kesiapan Armada", Icon: FleetIcon },
      { key: "ringkasan", label: "Laporan Operasional", Icon: GridIcon },
    ],
  },
  {
    label: "Analisis",
    items: [{ key: "tentang", label: "Metode & Data", Icon: InfoIcon }],
  },
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
        <div className="navrail-logo">
          <img src="/siaga-logo.png" alt="" aria-hidden="true" />
          <div>
            <div className="navrail-brand-name">SIAGA</div>
            <div className="navrail-brand-sub">Pusat kendali ketahanan air</div>
          </div>
        </div>
      </div>
      {SECTIONS.map((section) => (
        <div className="navrail-group" key={section.label}>
          <div className="navrail-section">{section.label}</div>
          {section.items.map((it) => (
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
        </div>
      ))}
      <div className="navrail-foot">
        <div className="system-status-head">
          <span className="system-icon"><FleetIcon size={20} /></span>
          <strong>Konteks data</strong>
          <span className="system-hindcast">Simulasi historis</span>
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
