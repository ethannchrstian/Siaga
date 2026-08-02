import { AlertIcon, FleetIcon, MapIcon, PeopleIcon } from "../icons";
import { fmtCompact, fmtInt, type Kpis } from "../metrics";

export default function KpiStrip({ kpis }: { kpis: Kpis }) {
  const cards = [
    {
      Icon: PeopleIcon,
      label: "Jiwa terpapar",
      value: fmtCompact(kpis.exposed),
      accent: "#b3261e",
    },
    {
      Icon: AlertIcon,
      label: "Kecamatan berisiko tinggi",
      value: fmtInt(kpis.atRisk),
      accent: "#cc4c02",
    },
    {
      Icon: MapIcon,
      label: "Kecamatan dilayani",
      value: fmtInt(kpis.served),
      accent: "#2171b5",
    },
    {
      Icon: FleetIcon,
      label: "Armada terpakai",
      value: `${kpis.fleetPct}%`,
      accent: "#1f7a33",
    },
  ];
  return (
    <div className="kpi-strip">
      {cards.map((c) => (
        <div className="kpi" key={c.label}>
          <span className="kpi-icon" style={{ color: c.accent }}>
            <c.Icon size={18} />
          </span>
          <div className="kpi-text">
            <div className="kpi-value">{c.value}</div>
            <div className="kpi-label">{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
