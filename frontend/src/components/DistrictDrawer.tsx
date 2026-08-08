import type {
  DistrictProperties,
  HazardCalibration,
  PlanItem,
  RiskDistrict,
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

export default function DistrictDrawer({
  props,
  risk,
  assignments,
  date,
  calibration,
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
      <div
        className={`drawer-risk-status${compound ? " compound" : aboveMonitoring ? " high" : ""}`}
        title={MONITORING_THRESHOLD_HELP}
      >
        {compound ? "Dua bahaya dipantau" : aboveMonitoring ? "Melewati Ambang Pemantauan" : "Di bawah Ambang Pemantauan"}
      </div>
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
      {exposure != null && (
        <div className="drawer-stat evidence-stat">
          <span>Estimasi paparan</span>
          <b>{exposure.toLocaleString("id-ID")} jiwa</b>
          <small>Peluang bahaya tertinggi × populasi. Bukan jumlah korban.</small>
        </div>
      )}

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
