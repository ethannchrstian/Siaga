import { GridIcon, InfoIcon, MapIcon } from "../icons";

export type View = "peta" | "ringkasan" | "tentang";

const ITEMS: { key: View; label: string; Icon: typeof MapIcon }[] = [
  { key: "peta", label: "Peta", Icon: MapIcon },
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
      <div className="navrail-mark">S</div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`navrail-btn${view === it.key ? " active" : ""}`}
          onClick={() => onView(it.key)}
          title={it.label}
        >
          <it.Icon size={20} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
