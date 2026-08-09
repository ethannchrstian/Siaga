import { AlertIcon, ChevronDownIcon, FleetIcon, GridIcon, InfoIcon, MapIcon } from "../icons";
import { MONITORING_THRESHOLD_HELP } from "../thresholds";

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
      <div className="navrail-context">
        <div className="navrail-context-title">
          <strong>Peringatan dini banjir &amp; cekaman air</strong>
          <span>Koridor pesisir utara Jawa</span>
        </div>
        <label className={`navrail-date${disabled ? " is-disabled" : ""}`}>
          <span>Hindcast · tanggal aktif</span>
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
        <label className={`navrail-scenario${disabled ? " is-disabled" : ""}`}>
          <span className="sr-only">Pilih skenario contoh</span>
          <select
            value={presets.some((preset) => preset.date === date) ? date : ""}
            onChange={(event) => event.target.value && onDate(event.target.value)}
            disabled={disabled}
          >
            <option value="">Pilih skenario</option>
            {presets.map((preset) => <option key={preset.date} value={preset.date}>{preset.label}</option>)}
          </select>
          <ChevronDownIcon size={13} />
        </label>
        <div className="navrail-monitoring" title={MONITORING_THRESHOLD_HELP}>
          <AlertIcon size={15} />
          <span>
            <strong>{monitoringCount > 0 ? `${monitoringCount} kecamatan dipantau` : "Tidak ada wilayah di atas ambang"}</strong>
            <small>Ambang pemantauan ≥50%</small>
          </span>
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
