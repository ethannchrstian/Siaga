import type { AllocateResponse, RiskDistrict } from "../api/client";
import { computeKpis, fmtInt, topExposed } from "../metrics";
import KpiStrip from "./KpiStrip";

interface Props {
  risk: Map<string, RiskDistrict>;
  result: AllocateResponse | null;
  date: string;
  onSelect: (districtId: string) => void;
}

export default function Overview({ risk, result, date, onSelect }: Props) {
  const kpis = computeKpis(risk, result);
  const top = topExposed(risk, 10);
  const maxExposed = top[0]?.exposed ?? 1;
  const disp = result?.summary.total_dispatched ?? { pompa: 0, truk_tangki: 0 };
  const fleet = result?.summary.total_fleet ?? { pompa: 0, truk_tangki: 0 };

  return (
    <div className="overview">
      <div className="ov-head">
        <h2>Ringkasan operasi</h2>
        <span className="ov-date">{date}</span>
      </div>

      <KpiStrip kpis={kpis} />

      <div className="ov-grid">
        <section className="panel">
          <div className="panel-title">
            Kecamatan dengan paparan tertinggi
          </div>
          <div className="hbars">
            {top.map((d) => (
              <button
                key={d.district_id}
                className="hbar-row"
                onClick={() => onSelect(d.district_id)}
                title="Lihat detail"
              >
                <span className="hbar-name">{d.name}</span>
                <span className="hbar-track">
                  <span
                    className="hbar-fill"
                    style={{
                      width: `${(d.exposed / maxExposed) * 100}%`,
                      background: d.dominant === "flood" ? "#2171b5" : "#cc4c02",
                    }}
                  />
                </span>
                <span className="hbar-val">{fmtInt(d.exposed)}</span>
              </button>
            ))}
            {top.length === 0 && (
              <div className="muted">Tidak ada paparan berarti pada tanggal ini.</div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">Pemakaian armada</div>
          <ResourceBar
            label="Pompa banjir"
            used={disp.pompa}
            total={fleet.pompa}
            color="#2171b5"
          />
          <ResourceBar
            label="Truk tangki air"
            used={disp.truk_tangki}
            total={fleet.truk_tangki}
            color="#cc4c02"
          />
          <p className="panel-note">
            Pompa dan truk ditarik dari satu kumpulan regu yang sama, sehingga
            keduanya saling berebut ketika kedua bahaya terjadi bersamaan.
          </p>
        </section>
      </div>
    </div>
  );
}

function ResourceBar({
  label,
  used,
  total,
  color,
}: {
  label: string;
  used: number;
  total: number;
  color: string;
}) {
  const pct = total ? (used / total) * 100 : 0;
  return (
    <div className="rbar">
      <div className="rbar-top">
        <span>{label}</span>
        <span>
          <b>{used}</b> / {total}
        </span>
      </div>
      <div className="rbar-track">
        <div className="rbar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
