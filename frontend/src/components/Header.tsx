import { AlertIcon, ChevronDownIcon, InfoIcon } from "../icons";
import { MONITORING_THRESHOLD_HELP } from "../thresholds";

interface Props {
  date: string;
  dateMin: string;
  dateMax: string;
  monitoringCount: number;
  presets: { label: string; date: string }[];
  onDate: (date: string) => void;
  disabled?: boolean;
}

export default function Header({ date, dateMin, dateMax, monitoringCount, presets, onDate, disabled = false }: Props) {
  return (
    <header className="topbar global-commandbar">
      {/* Brand identity now lives in the dark rail; the command bar carries
          only the descriptor and the controls. */}
      <div className="commandbar-context">
        <strong>Peringatan dini banjir &amp; cekaman air</strong>
        <span>Koridor pesisir utara Jawa</span>
      </div>

      <div className="global-context" aria-label="Konteks data aktif">
        {/* Mode and date were two separate chips of different heights saying
            related things. One control: the mode qualifies the date it applies to. */}
        <label className={`global-date-control${disabled ? " is-disabled" : ""}`}>
          <span>Hindcast · tanggal aktif</span>
          <strong>{formatShortDate(date)}</strong>
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
        <label className={`global-scenario-control${disabled ? " is-disabled" : ""}`}>
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
      </div>

      <div className="topbar-situation" title={MONITORING_THRESHOLD_HELP}>
        <span className="topbar-situation-icon"><AlertIcon size={16} /></span>
        <span className="topbar-situation-copy">
          <strong>{monitoringCount > 0 ? `${monitoringCount} kecamatan dipantau` : "Tidak ada wilayah di atas ambang"}</strong>
          <span>Ambang Pemantauan ≥50% · visual saja <InfoIcon size={11} /></span>
        </span>
      </div>

      <div className="account-static" aria-label="Operator aktif" title="Operator SIAGA · PUSDALOPS">
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
