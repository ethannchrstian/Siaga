import type { PlanItem, RiskDistrict } from "../api/client";
import { fmtInt } from "../metrics";

interface Props {
  risk: Map<string, RiskDistrict>;
  plan: PlanItem[];
  date: string;
  onSelect: (districtId: string) => void;
}

// Every district with either hazard high, ranked by severity. This is the
// "active incidents" queue an operator works down.
export default function Insiden({ risk, plan, date, onSelect }: Props) {
  const served = new Set(plan.map((p) => p.district_id));
  const rows = [...risk.values()]
    .map((d) => ({
      ...d,
      sev: Math.max(d.flood_prob, d.drought_prob),
    }))
    .filter((d) => d.sev >= 0.5)
    .sort((a, b) => b.sev * b.population - a.sev * a.population);

  return (
    <div className="page">
      <div className="ov-head">
        <h2>Insiden aktif</h2>
        <span className="ov-date">
          {rows.length} kecamatan berisiko tinggi · {date}
        </span>
      </div>
      <div className="panel nopad">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kecamatan</th>
              <th>Kab/Kota</th>
              <th className="num">Banjir</th>
              <th className="num">Cekaman air</th>
              <th className="num">Populasi</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const both = d.flood_prob >= 0.5 && d.drought_prob >= 0.5;
              return (
                <tr key={d.district_id} onClick={() => onSelect(d.district_id)}>
                  <td className="strong">{d.name}</td>
                  <td className="dim">{d.kabupaten}</td>
                  <td className="num">
                    <Pct v={d.flood_prob} color="#2171b5" />
                  </td>
                  <td className="num">
                    <Pct v={d.drought_prob} color="#cc4c02" />
                  </td>
                  <td className="num dim">{fmtInt(d.population)}</td>
                  <td>
                    {both ? (
                      <span className="pill-tag both">Majemuk</span>
                    ) : d.drought_prob >= d.flood_prob ? (
                      <span className="pill-tag dr">Cekaman air</span>
                    ) : (
                      <span className="pill-tag fl">Banjir</span>
                    )}
                    {served.has(d.district_id) && (
                      <span className="pill-tag ok">Dilayani</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="dim" style={{ padding: 16 }}>
                  Tidak ada insiden berisiko tinggi pada tanggal ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pct({ v, color }: { v: number; color: string }) {
  const p = Math.round(v * 100);
  return (
    <span style={{ color: p >= 50 ? color : "var(--text-dim)", fontWeight: p >= 50 ? 700 : 400 }}>
      {p}%
    </span>
  );
}
