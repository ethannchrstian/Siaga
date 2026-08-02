import type { DistrictProperties, PlanItem, RiskDistrict } from "../api/client";

interface Props {
  props: DistrictProperties | null;
  risk: RiskDistrict | undefined;
  population: number | undefined;
  assignments: PlanItem[];
  onClose: () => void;
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar-row">
      <div className="bar-label">
        {label} <b>{Math.round(value * 100)}%</b>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${Math.min(value * 100, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function DistrictDrawer({
  props,
  risk,
  population,
  assignments,
  onClose,
}: Props) {
  if (!props) return null;
  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="drawer-title">{props.name}</div>
          <div className="drawer-sub">
            {props.kabupaten}, {props.provinsi}
          </div>
        </div>
        <button className="x" onClick={onClose}>
          ✕
        </button>
      </div>

      <Bar label="Risiko banjir (0–72 jam)" value={risk?.flood_prob ?? 0} color="#2171b5" />
      <Bar
        label="Risiko cekaman air (bulan depan)"
        value={risk?.drought_prob ?? 0}
        color="#cc4c02"
      />

      {population != null && (
        <div className="drawer-stat">
          Populasi terpapar: <b>{population.toLocaleString("id-ID")}</b>
        </div>
      )}

      <div className="drawer-section">Penempatan saat ini</div>
      {assignments.length === 0 ? (
        <div className="muted">Belum ada penempatan pada rencana ini.</div>
      ) : (
        assignments.map((a) => (
          <div className="drawer-assign" key={a.resource}>
            <b>
              {a.units} {a.resource_label}
            </b>{" "}
            dari {a.from_depot} ({a.minutes} mnt)
          </div>
        ))
      )}
    </div>
  );
}
