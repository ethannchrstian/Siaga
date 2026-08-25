import {
  AlertIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FleetIcon,
  GridIcon,
  InfoIcon,
  LogoutIcon,
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
      { key: "inventaris", label: "Inventaris & Alokasi", Icon: FleetIcon },
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
  operator,
  onSignOut,
}: {
  view: View;
  onView: (v: View) => void;
  /** Display name from the session, stamped on every decision this operator
   *  makes, so the console can say who decided what. */
  operator?: string;
  onSignOut?: () => void;
  monitoringCount: number;
  date: string;
  dateMin: string;
  dateMax: string;
  presets: { label: string; date: string; note: string }[];
  onDate: (date: string) => void;
  disabled?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const activePreset = presets.find((preset) => preset.date === date);
  return (
    <>
    {/* Rendered outside the <nav>, not inside it: the rail scrolls, so a
        handle straddling its border would be clipped. It rides the border
        line and mirrors the plan panel's tab on the far side. */}
    {onToggleCollapsed && (
      <button
        type="button"
        className="rail-handle"
        onClick={onToggleCollapsed}
        title={collapsed ? "Perlebar navigasi" : "Perkecil navigasi"}
        aria-label={collapsed ? "Perlebar navigasi" : "Perkecil navigasi"}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </button>
    )}
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
          {activePreset && <small className="navrail-scenario-note">{activePreset.note}</small>}
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
      <div className="navrail-foot">
        <div className="navrail-operator">
          <span className="account-avatar" aria-hidden="true">{initials(operator)}</span>
          {/* Its own class rather than :last-child: the sign-out button now
              sits after it, which silently cost this block its column layout
              and ran the name into the role. */}
          <span className="navrail-operator-id">
            <strong title={operator ?? "Operator SIAGA"}>{operator ?? "Operator SIAGA"}</strong>
            <small>PUSDALOPS</small>
          </span>
          {onSignOut && (
            <button
              type="button"
              className="navrail-signout"
              onClick={onSignOut}
              title="Keluar dari sesi"
              aria-label="Keluar dari sesi"
            >
              <LogoutIcon size={15} />
            </button>
          )}
        </div>
      </div>
    </nav>
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

/** Initials from word starts, so "Operator SIAGA" reads OS rather than OP. */
function initials(name?: string): string {
  const words = (name ?? "Operator SIAGA").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "OS";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
