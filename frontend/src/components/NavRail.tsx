import {
  AlertIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FleetIcon,
  GridIcon,
  InfoIcon,
  MapIcon,
} from "../icons";

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
  date,
  dateMin,
  dateMax,
  presets,
  onDate,
  disabled = false,
  collapsed = false,
  onToggleCollapsed,
}: {
  view: View;
  onView: (v: View) => void;
  monitoringCount: number;
  date: string;
  dateMin: string;
  dateMax: string;
  presets: { label: string; date: string }[];
  onDate: (date: string) => void;
  disabled?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  return (
    <nav
      className={`navrail navrail-${view}${collapsed ? " is-collapsed" : ""}`}
      aria-label="Navigasi utama"
    >
      <div className="navrail-brand">
        <div className="navrail-logo">
          <img src="/siaga-logo.png" alt="" aria-hidden="true" />
          <div>
            <div className="navrail-brand-name">SIAGA</div>
            <div className="navrail-brand-sub">Pusat kendali ketahanan air</div>
          </div>
        </div>
      </div>
      {/* Filters only. The tagline that used to sit here said nothing the brand
          block does not, and the monitoring count is already the nav badge. */}
      {/* Each control carries its label above the box rather than inside it,
          so the white face holds only the value the operator is reading. */}
      <div className="navrail-context">
        <div className="navrail-field">
          <span className="navrail-field-label">Hindcast · tanggal aktif</span>
          <label className={`navrail-date${disabled ? " is-disabled" : ""}`}>
            <strong>{formatDate(date)}</strong>
            <ChevronDownIcon size={13} />
            <input
              type="date"
              value={date}
              min={dateMin}
              max={dateMax}
              onChange={(event) => onDate(event.target.value)}
              aria-label="Pilih tanggal data"
              disabled={disabled}
            />
          </label>
        </div>
        <div className="navrail-field">
          <span className="navrail-field-label" id="navrail-scenario-label">Skenario contoh</span>
          <label className={`navrail-scenario${disabled ? " is-disabled" : ""}`}>
            <select
              aria-labelledby="navrail-scenario-label"
              value={presets.some((preset) => preset.date === date) ? date : ""}
              onChange={(event) => event.target.value && onDate(event.target.value)}
              disabled={disabled}
            >
              <option value="">Pilih skenario</option>
              {presets.map((preset) => <option key={preset.date} value={preset.date}>{preset.label}</option>)}
            </select>
            <ChevronDownIcon size={13} />
          </label>
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
              /* Collapsed, the icon is all that is left to identify the item. */
              title={it.label}
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
      {/* Kept out of the brand block: sharing that row squeezed the tagline
          onto two lines and inherited its left alignment when collapsed. */}
      {onToggleCollapsed && (
        <div className="navrail-collapse">
          <button
            type="button"
            className="navrail-toggle"
            onClick={onToggleCollapsed}
            title={collapsed ? "Perlebar navigasi" : "Perkecil navigasi"}
            aria-label={collapsed ? "Perlebar navigasi" : "Perkecil navigasi"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRightIcon size={15} /> : <ChevronLeftIcon size={15} />}
          </button>
        </div>
      )}
      <div className="navrail-foot">
        <div className="navrail-operator">
          <span className="account-avatar" aria-hidden="true">OS</span>
          <span><strong>Operator SIAGA</strong><small>PUSDALOPS</small></span>
        </div>
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
