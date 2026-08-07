import type { DistrictProperties, PlanItem, RiskDistrict } from "../api/client";
import {
  CRITICAL_ALLOCATION_THRESHOLD_HELP,
  MONITORING_THRESHOLD,
  MONITORING_THRESHOLD_HELP,
} from "../thresholds";
import Sparkline from "./Sparkline";

interface Props {
  props: DistrictProperties | null;
  risk: RiskDistrict | undefined;
  assignments: PlanItem[];
  date: string;
  onClose: () => void;
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar-row">
      <div className="bar-label">{label}<b>{Math.round(value * 100)}%</b></div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.min(value * 100, 100)}%`, background: color }} />
        <i className="bar-threshold allocation" title={CRITICAL_ALLOCATION_THRESHOLD_HELP} />
        <i className="bar-threshold monitoring" title={MONITORING_THRESHOLD_HELP} />
      </div>
    </div>
  );
}

export default function DistrictDrawer({ props, risk, assignments, date, onClose }: Props) {
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
      <div
        className={`drawer-risk-status${compound ? " compound" : aboveMonitoring ? " high" : ""}`}
        title={MONITORING_THRESHOLD_HELP}
      >
        {compound ? "Dua bahaya dipantau" : aboveMonitoring ? "Melewati Ambang Pemantauan" : "Di bawah Ambang Pemantauan"}
      </div>
      <Bar label="Banjir · 0–72 jam" value={risk?.flood_prob ?? 0} color="#4b7898" />
      <Bar label="Cekaman air · bulan depan" value={risk?.drought_prob ?? 0} color="#955159" />
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
  );
}
