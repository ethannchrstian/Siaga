import { AlertIcon, DropIcon, EyeIcon, PeopleIcon, SunIcon } from "../icons";
import { fmtCompact, fmtInt, type Kpis } from "../metrics";

export default function KpiStrip({ kpis }: { kpis: Kpis }) {
  const cards = [
    {
      Icon: AlertIcon,
      label: "Kecamatan terdampak",
      value: fmtInt(kpis.atRisk),
      note: "Perlu pemantauan",
      tone: "neutral",
    },
    {
      Icon: DropIcon,
      label: "Risiko banjir tinggi",
      value: fmtInt(kpis.highFlood),
      note: `${kpis.monitored ? ((kpis.highFlood / kpis.monitored) * 100).toFixed(1) : "0,0"}% dari total`.replace(".", ","),
      tone: "flood",
    },
    {
      Icon: SunIcon,
      label: "Risiko cekaman air tinggi",
      value: fmtInt(kpis.highDrought),
      note: `${kpis.monitored ? ((kpis.highDrought / kpis.monitored) * 100).toFixed(1) : "0,0"}% dari total`.replace(".", ","),
      tone: "drought",
    },
    {
      Icon: PeopleIcon,
      label: "Populasi terpapar",
      value: fmtCompact(kpis.exposed),
      note: "Estimasi paparan",
      tone: "neutral",
    },
    {
      Icon: EyeIcon,
      label: "Kecamatan dipantau",
      value: fmtInt(kpis.monitored),
      note: "100% dari total",
      tone: "neutral",
    },
  ];
  return (
    <div className="kpi-strip">
      {cards.map((c) => (
        <div className={`kpi kpi-${c.tone}`} key={c.label}>
          <div className="kpi-text">
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-value">{c.value}</div>
            <div className="kpi-note">{c.note}</div>
          </div>
          <span className="kpi-icon"><c.Icon size={28} /></span>
        </div>
      ))}
    </div>
  );
}
