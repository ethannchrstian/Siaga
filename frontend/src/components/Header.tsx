import { AlertIcon, ChevronDownIcon, InfoIcon } from "../icons";
import { MONITORING_THRESHOLD_HELP } from "../thresholds";

interface Props {
  date: string;
  dateMin: string;
  dateMax: string;
  monitoringCount: number;
  presets: { label: string; date: string }[];
  onDate: (date: string) => void;
}

export default function Header({ date, dateMin, dateMax, monitoringCount, presets, onDate }: Props) {
  return (
    <header className="topbar global-commandbar">
      <div className="brand-lockup">
        <div className="brand-mark siaga-logo-mark" aria-hidden="true">
          <img src="/siaga-logo.png" alt="" />
        </div>
        <div className="brand-copy">
          <div className="brand-name">SIAGA</div>
          <div className="brand-kicker">Pusat kendali ketahanan air</div>
        </div>
        <div className="brand-divider" />
        <div className="brand-subtitle">Peringatan dini banjir &amp; cekaman air<br />Koridor pesisir utara Jawa</div>
      </div>

      <div className="global-context" aria-label="Konteks data aktif">
        <span className="global-hindcast">Hindcast 2015–2024</span>
        <label className="global-date-control">
          <span>Tanggal aktif</span>
          <strong>{formatShortDate(date)}</strong>
          <ChevronDownIcon size={13} />
          <input
            type="date"
            value={date}
            min={dateMin}
            max={dateMax}
            onChange={(event) => onDate(event.target.value)}
            aria-label="Pilih tanggal data"
          />
        </label>
        <label className="global-scenario-control">
          <span className="sr-only">Pilih skenario contoh</span>
          <select
            value={presets.some((preset) => preset.date === date) ? date : ""}
            onChange={(event) => event.target.value && onDate(event.target.value)}
          >
            <option value="">Pilih skenario</option>
            {presets.map((preset) => <option key={preset.date} value={preset.date}>{preset.label}</option>)}
          </select>
          <ChevronDownIcon size={13} />
        </label>
      </div>

      <div className={`topbar-situation${monitoringCount > 0 ? " is-alert" : ""}`} title={MONITORING_THRESHOLD_HELP}>
        <span className="topbar-situation-icon"><AlertIcon size={16} /></span>
        <span className="topbar-situation-copy">
          <strong>{monitoringCount > 0 ? `${monitoringCount} kecamatan perlu dipantau` : "Tidak ada peringatan pemantauan"}</strong>
          <span>Ambang Pemantauan ≥50% · visual saja <InfoIcon size={11} /></span>
        </span>
      </div>

      <div className="account-static" aria-label="Operator aktif">
        <span className="account-avatar" aria-hidden="true">OS</span>
        <span className="account-copy"><strong>Operator SIAGA</strong><span>PUSDALOPS</span></span>
      </div>
    </header>
  );
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
