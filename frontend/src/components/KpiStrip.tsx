import { AlertIcon, DropIcon, EyeIcon, PeopleIcon, SunIcon } from "../icons";
import { fmtCompact, fmtInt, type Kpis } from "../metrics";

export default function KpiStrip({
  kpis,
  variant = "cards",
}: {
  kpis: Kpis;
  variant?: "cards" | "compact";
}) {
  const cards = [
    {
      Icon: AlertIcon,
      label: "Melewati ambang pemantauan",
      value: fmtInt(kpis.aboveMonitoring),
      note: "Peluang bahaya ≥50%",
      tone: "neutral",
    },
    {
      Icon: DropIcon,
      label: "Pemantauan banjir",
      value: fmtInt(kpis.floodMonitoring),
      note: `${kpis.totalDistricts ? ((kpis.floodMonitoring / kpis.totalDistricts) * 100).toFixed(1) : "0,0"}% dari total`.replace(".", ","),
      tone: "flood",
    },
    {
      Icon: SunIcon,
      label: "Pemantauan cekaman air",
      value: fmtInt(kpis.droughtMonitoring),
      note: `${kpis.totalDistricts ? ((kpis.droughtMonitoring / kpis.totalDistricts) * 100).toFixed(1) : "0,0"}% dari total`.replace(".", ","),
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
      value: fmtInt(kpis.totalDistricts),
      note: "100% dari total",
      tone: "neutral",
    },
  ];
  return (
    <div className={`kpi-strip kpi-strip-${variant}`}>
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
