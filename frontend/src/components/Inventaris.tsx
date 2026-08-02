import type { AllocateResponse, Depot } from "../api/client";
import { PumpIcon, TruckIcon } from "../icons";

interface Props {
  depots: Depot[];
  result: AllocateResponse | null;
  note?: string;
}

// Real fleet inventory per depot, plus how much is currently committed by the
// active plan. Fleet counts are scenario data (see Tentang).
export default function Inventaris({ depots, result, note }: Props) {
  // Real per-depot outflow from the solver (respects each depot's capacity),
  // keyed by depot name.
  const dispatchedByDepot = new Map<string, { pompa: number; truk: number }>();
  for (const dd of Object.values(result?.depot_dispatch ?? {})) {
    dispatchedByDepot.set(dd.name, { pompa: dd.pompa, truk: dd.truk_tangki });
  }

  const total = depots.reduce(
    (a, d) => ({
      pompa: a.pompa + d.fleet.pompa,
      truk: a.truk + d.fleet.truk_tangki,
      regu: a.regu + d.fleet.regu,
    }),
    { pompa: 0, truk: 0, regu: 0 },
  );
  const disp = result?.summary.total_dispatched ?? { pompa: 0, truk_tangki: 0 };

  return (
    <div className="page">
      <div className="ov-head">
        <h2>Inventaris armada</h2>
        <span className="ov-date">{depots.length} depot BPBD · koridor Pantura</span>
      </div>

      <div className="inv-totals">
        <TotalCard label="Pompa banjir" used={disp.pompa} total={total.pompa} color="#2171b5" Icon={PumpIcon} />
        <TotalCard label="Truk tangki air" used={disp.truk_tangki} total={total.truk} color="#cc4c02" Icon={TruckIcon} />
        <TotalCard label="Regu personel" used={disp.pompa + disp.truk_tangki} total={total.regu} color="#1f7a33" />
      </div>

      <div className="panel nopad">
        <table className="data-table">
          <thead>
            <tr>
              <th>Depot</th>
              <th className="num">Pompa</th>
              <th className="num">Truk tangki</th>
              <th className="num">Regu</th>
              <th className="num">Terkirim (rencana)</th>
            </tr>
          </thead>
          <tbody>
            {depots.map((d) => {
              const dd = dispatchedByDepot.get(d.name) ?? { pompa: 0, truk: 0 };
              return (
                <tr key={d.depot_id}>
                  <td className="strong">{d.name}</td>
                  <td className="num">{d.fleet.pompa}</td>
                  <td className="num">{d.fleet.truk_tangki}</td>
                  <td className="num">{d.fleet.regu}</td>
                  <td className="num">
                    {dd.pompa + dd.truk > 0 ? (
                      <span className="strong">
                        {dd.pompa > 0 && (
                          <span style={{ color: "#2171b5" }}>{dd.pompa} pompa </span>
                        )}
                        {dd.truk > 0 && (
                          <span style={{ color: "#cc4c02" }}>{dd.truk} truk</span>
                        )}
                      </span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <p className="panel-note">{note}</p>}
    </div>
  );
}

function TotalCard({
  label,
  used,
  total,
  color,
  Icon,
}: {
  label: string;
  used: number;
  total: number;
  color: string;
  Icon?: typeof PumpIcon;
}) {
  const pct = total ? (used / total) * 100 : 0;
  return (
    <div className="inv-total">
      <div className="inv-total-top">
        {Icon && (
          <span style={{ color }}>
            <Icon size={18} />
          </span>
        )}
        <span className="inv-total-label">{label}</span>
      </div>
      <div className="inv-total-num">
        <b>{used}</b> / {total} terkirim
      </div>
      <div className="rbar-track">
        <div className="rbar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
