import { GridIcon, InfoIcon, MapIcon } from "../icons";

export type View = "peta" | "ringkasan" | "tentang";

const ITEMS: { key: View; label: string; Icon: typeof MapIcon }[] = [
  { key: "peta", label: "Peta Risiko", Icon: MapIcon },
  { key: "ringkasan", label: "Ringkasan", Icon: GridIcon },
  { key: "tentang", label: "Tentang", Icon: InfoIcon },
];

export default function NavRail({
  view,
  onView,
}: {
  view: View;
  onView: (v: View) => void;
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
        </button>
      ))}
      <div className="navrail-foot">
        <span className="dot-live" /> Sistem aktif
      </div>
    </nav>
  );
}
