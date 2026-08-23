import type {
  DistrictProperties,
  HazardCalibration,
  PlanItem,
  RiskDistrict,
  RobReading,
} from "../api/client";
import {
  CRITICAL_ALLOCATION_THRESHOLD_HELP,
  MONITORING_THRESHOLD,
  MONITORING_THRESHOLD_HELP,
} from "../thresholds";
import { frequencyPhrase, verificationNote, verifiedAt } from "../calibration";
import Sparkline from "./Sparkline";

interface Props {
  props: DistrictProperties | null;
  risk: RiskDistrict | undefined;
  assignments: PlanItem[];
  date: string;
  calibration?: Partial<Record<"flood" | "drought", HazardCalibration>>;
  // Month the radar figures were observed in, for the caption. Sentinel-1
  // revisits every 12 days, so a reading is monthly, not daily.
  robMonth?: string | null;
  onClose: () => void;
}

function Bar({
  label,
  value,
  color,
  cal,
}: {
  label: string;
  value: number;
  color: string;
  cal?: HazardCalibration;
}) {
  // A percentage alone reads as a claim about today. The frequency line says
  // what it is, and the verification line says how well that claim has held.
  const verified = verifiedAt(value, cal);
  return (
    <div className="bar-row">
      <div className="bar-label">{label}<b>{Math.round(value * 100)}%</b></div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.min(value * 100, 100)}%`, background: color }} />
        <i className="bar-threshold allocation" title={CRITICAL_ALLOCATION_THRESHOLD_HELP} />
        <i className="bar-threshold monitoring" title={MONITORING_THRESHOLD_HELP} />
      </div>
      <div className="bar-frequency">{frequencyPhrase(value)}</div>
      {verified?.notable && (
        <div className="bar-verified" title={verificationNote(verified)}>
          {verified.gap < 0 ? "↓" : "↑"} teramati {Math.round(verified.observed * 100)}%
          pada uji 2023–2024
        </div>
      )}
    </div>
  );
}

const MONTH_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function monthLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_ID[idx]} ${y}` : null;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** What the radar actually saw, kept visually distinct from the two forecast
 *  bars above it. Everything else in this drawer is a model output; this is a
 *  measurement, and conflating the two would be the worst thing this panel
 *  could do. */
function RobPanel({
  rob,
  blindSpot,
  month,
}: {
  rob: RobReading;
  blindSpot: boolean;
  month?: string | null;
}) {
  const label = monthLabel(month);
  const anomaly = rob.anomaly;
  const headline =
    rob.level === "tinggi"
      ? "Genangan luas terpantau"
      : rob.level === "waspada"
        ? "Genangan di atas normal"
        : rob.level === "normal"
          ? "Sesuai normal bulan ini"
          : "Belum cukup data radar";

  return (
    <div className={`drawer-rob rob-${rob.level}`}>
      <div className="drawer-section">
        Terpantau radar{label ? ` · ${label}` : ""}
      </div>
      <div className="drawer-rob-head">{headline}</div>

      <div className="drawer-rob-rows">
        <div>
          <span>Tergenang</span>
          <b>{pct(rob.water_frac)}</b>
        </div>
        {rob.baseline != null && (
          <div>
            <span>Normal bulan ini</span>
            <b>{pct(rob.baseline)}</b>
          </div>
        )}
        {anomaly != null && (
          <div>
            <span>Selisih</span>
            <b>{anomaly >= 0 ? "+" : ""}{pct(anomaly)}</b>
          </div>
        )}
      </div>

      {rob.chronic && (
        <div className="drawer-rob-note chronic">
          Genangan permanen tumbuh {pct(rob.trend)} luas wilayah sejak 2015.
          Pola penurunan muka tanah, bukan musim.
        </div>
      )}

      {blindSpot && (
        <div className="drawer-rob-note blind">
          Radar melihat air, model banjir tidak. Model dilatih pada debit sungai
          sehingga tidak menangkap rob. Jangan pakai angka banjir di atas
          sebagai satu-satunya dasar untuk kecamatan ini.
        </div>
      )}

      <small className="drawer-rob-src">
        Sentinel-1 VV, median bulanan, ambang &minus;16 dB. Persentase luas
        kecamatan, dibandingkan normal kecamatan ini sendiri pada bulan yang sama.
      </small>
    </div>
  );
}

export default function DistrictDrawer({
  props,
  risk,
  assignments,
  date,
  calibration,
  robMonth,
  onClose,
}: Props) {
  if (!props) return null;
  const exposure = risk?.people_exposed ?? null;
  const compound = (risk?.flood_prob ?? 0) >= MONITORING_THRESHOLD
    && (risk?.drought_prob ?? 0) >= MONITORING_THRESHOLD;
  const aboveMonitoring = Math.max(risk?.flood_prob ?? 0, risk?.drought_prob ?? 0)
    >= MONITORING_THRESHOLD;

  return (
    <div className="drawer district-evidence-drawer">
      <div className="drawer-head">
        <div>
          <div className="drawer-title">{props.name}</div>
          <div className="drawer-sub">{props.kabupaten}, {props.provinsi}</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Tutup detail kecamatan">×</button>
      </div>
      <div className="drawer-body">
      {risk && !risk.modeled ? (
        <div className="drawer-risk-status unmodeled">Di luar cakupan model</div>
      ) : (
        <div
          className={`drawer-risk-status${compound ? " compound" : aboveMonitoring ? " high" : ""}`}
          title={MONITORING_THRESHOLD_HELP}
        >
          {compound ? "Dua bahaya dipantau" : aboveMonitoring ? "Melewati Ambang Pemantauan" : "Di bawah Ambang Pemantauan"}
        </div>
      )}
      {risk && !risk.modeled ? (
        /* Showing 0% here would say the models checked and found nothing. They
           never ran: this kecamatan has no modelled river reach. */
        <div className="drawer-unmodeled">
          <b>Belum dimodelkan</b>
          <span>
            Kecamatan ini tidak memiliki ruas sungai yang dimodelkan GloFAS,
            sehingga tidak ada prakiraan banjir maupun cekaman air untuknya.
            Angka 0% tidak berlaku di sini.
          </span>
          <small>
            6 dari 324 kecamatan, seluruhnya di pesisir Cirebon dan Indramayu.
            Gunakan lapisan radar dan penilaian lapangan.
          </small>
        </div>
      ) : (
        <>
          <Bar
            label="Banjir · 0–72 jam"
            value={risk?.flood_prob ?? 0}
            color="#4b7898"
            cal={calibration?.flood}
          />
          <Bar
            label="Cekaman air · bulan depan"
            value={risk?.drought_prob ?? 0}
            color="#955159"
            cal={calibration?.drought}
          />
        </>
      )}
      {exposure != null && (
        <div className="drawer-stat evidence-stat">
          <span>Estimasi paparan</span>
          <b>{exposure.toLocaleString("id-ID")} jiwa</b>
          <small>Peluang bahaya tertinggi × populasi. Bukan jumlah korban.</small>
        </div>
      )}

      {risk?.rob && <RobPanel rob={risk.rob} blindSpot={risk.rob_blind_spot} month={robMonth} />}

      <Sparkline districtId={props.district_id} end={date} />

      <div className="drawer-section">Alokasi dalam rencana</div>
      {assignments.length === 0 ? (
        <div className="drawer-gap-state">Belum ada alokasi untuk wilayah ini pada rencana aktif.</div>
      ) : assignments.map((assignment) => (
        <div
          className={`drawer-assign evidence-assignment ${assignment.resource === "pompa" ? "flood" : "drought"}`}
          key={assignment.resource}
        >
          <b>{assignment.units} {assignment.resource_label}</b>
          <span>dari {assignment.from_depot} · {assignment.minutes} menit</span>
          {assignment.reason && <small>{assignment.reason}</small>}
        </div>
      ))}
      </div>
    </div>
  );
}
