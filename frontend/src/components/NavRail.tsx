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
}: {
  view: View;
  onView: (v: View) => void;
  incidentCount: number;
}) {
  return (
    <nav className="navrail">
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
        <span className="dot-live" /> Sistem aktif
      </div>
    </nav>
  );
}
