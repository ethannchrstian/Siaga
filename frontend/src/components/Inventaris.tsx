import { useMemo, useState } from "react";
import type { AllocateResponse, Depot, PlanItem } from "../api/client";
import { ChevronDownIcon, PumpIcon, SearchIcon, TruckIcon } from "../icons";

interface Props {
  depots: Depot[];
  result: AllocateResponse | null;
  note?: string;
}

type CapacityFilter = "all" | "noreserve" | "active" | "idle";

interface DepotRow {
  depot: Depot;
  pumpUsed: number;
  truckUsed: number;
  teamUsed: number;
  utilization: number;
  assignments: PlanItem[];
}

export default function Inventaris({ depots, result, note }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CapacityFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo<DepotRow[]>(() => depots.map((depot) => {
    const dispatch = Object.values(result?.depot_dispatch ?? {}).find((item) => item.name === depot.name);
    const assignments = (result?.plan ?? []).filter((item) => item.from_depot === depot.name);
    const pumpUsed = dispatch?.pompa ?? 0;
    const truckUsed = dispatch?.truk_tangki ?? 0;
    const teamUsed = pumpUsed + truckUsed;
    return { depot, pumpUsed, truckUsed, teamUsed, utilization: depot.fleet.regu ? teamUsed / depot.fleet.regu : 0, assignments };
  }).sort((a, b) => b.utilization - a.utilization), [depots, result]);

  const totals = rows.reduce((acc, row) => ({
    pump: acc.pump + row.depot.fleet.pompa,
    pumpUsed: acc.pumpUsed + row.pumpUsed,
    truck: acc.truck + row.depot.fleet.truk_tangki,
    truckUsed: acc.truckUsed + row.truckUsed,
    team: acc.team + row.depot.fleet.regu,
    teamUsed: acc.teamUsed + row.teamUsed,
  }), { pump: 0, pumpUsed: 0, truck: 0, truckUsed: 0, team: 0, teamUsed: 0 });
  // A depot running at capacity is the optimizer doing its job. The only thing
  // an operator actually has to act on is a depot with no regu left in reserve.
  const noReserveCount = rows.filter((row) => row.depot.fleet.regu - row.teamUsed <= 0).length;
  const visibleRows = rows.filter((row) => {
    const matchesQuery = !query.trim() || row.depot.name.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id"));
    const hasNoReserve = row.depot.fleet.regu - row.teamUsed <= 0;
    const matchesFilter = filter === "all" || (filter === "noreserve" && hasNoReserve) || (filter === "active" && row.teamUsed > 0) || (filter === "idle" && row.teamUsed === 0);
    return matchesQuery && matchesFilter;
  });

  return (
    <main className="page readiness-page">
      <header className="operational-page-head">
        <div>
          <h1>Kesiapan armada</h1>
          <p>{depots.length} depot BPBD · koridor Pantura</p>
        </div>
        <span className="scenario-data-badge">Inventaris skenario</span>
      </header>

      {noReserveCount > 0 ? (
        <div className="capacity-alert stable"><span>✓</span><div><strong>Seluruh armada sudah ditempatkan pada rencana aktif</strong><p>{noReserveCount} dari {depots.length} depot kini tanpa regu cadangan. Setiap permintaan baru harus mengambil alih alokasi yang ada.</p></div></div>
      ) : (
        <div className="capacity-alert stable"><span>✓</span><div><strong>Masih ada regu cadangan di setiap depot</strong><p>Permintaan tambahan dapat dilayani tanpa menarik alokasi yang sudah berjalan.</p></div></div>
      )}

      <section className="readiness-totals">
        <CapacityCard label="Pompa banjir" used={totals.pumpUsed} total={totals.pump} tone="flood" Icon={PumpIcon} />
        <CapacityCard label="Truk tangki air" used={totals.truckUsed} total={totals.truck} tone="drought" Icon={TruckIcon} />
        <CapacityCard label="Regu personel" used={totals.teamUsed} total={totals.team} tone="team" />
        <div className="readiness-summary-card"><span>Tanpa cadangan</span><strong>{noReserveCount}</strong><p>dari {depots.length} depot sudah habis regunya</p></div>
      </section>

      <section className="readiness-panel">
        <div className="readiness-toolbar">
          <label className="readiness-search"><SearchIcon size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari depot..." /><span className="sr-only">Cari depot</span></label>
          <div className="readiness-filters" aria-label="Filter kapasitas depot">
            {([[
              "all", "Semua depot",
            ], ["noreserve", "Tanpa cadangan"], ["active", "Sedang mengirim"], ["idle", "Belum digunakan"]] as [CapacityFilter, string][]).map(([value, label]) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <span className="readiness-result-count">{visibleRows.length} depot</span>
        </div>

        <div className="table-scroll">
          <table className="data-table readiness-table">
            <thead><tr><th>Depot</th><th>Pompa</th><th>Truk tangki</th><th>Pemakaian regu</th><th>Status</th><th><span className="sr-only">Rincian</span></th></tr></thead>
            <tbody>
              {visibleRows.map((row) => {
                const isExpanded = expanded === row.depot.depot_id;
                return <FragmentRow key={row.depot.depot_id} row={row} expanded={isExpanded} onToggle={() => setExpanded(isExpanded ? null : row.depot.depot_id)} />;
              })}
              {visibleRows.length === 0 && <tr><td colSpan={6} className="table-empty">Tidak ada depot yang sesuai dengan pencarian atau filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="inventory-disclaimer">
        <strong>Cara membaca kapasitas</strong>
        <span>Unit terkirim dihitung sebagai komitmen regu pada rencana aktif. Angka inventaris adalah skenario dan belum mewakili stok lapangan real-time.</span>
        {note && <small>{note}</small>}
      </footer>
    </main>
  );
}

// Leads with what has been deployed. The old version led with what was left,
// so a fully committed fleet (the optimizer succeeding) rendered as a zero.
function CapacityCard({ label, used, total, tone, Icon }: { label: string; used: number; total: number; tone: string; Icon?: typeof PumpIcon }) {
  const percentage = total ? Math.min((used / total) * 100, 100) : 0;
  const spare = Math.max(total - used, 0);
  return <article className={`capacity-card ${tone}`}>
    <div className="capacity-card-head">{Icon && <Icon size={19} />}<span>{label}</span></div>
    <div className="capacity-card-value"><strong>{used}</strong><span>dari {total} ditempatkan</span></div>
    <div className="capacity-track"><span style={{ width: `${percentage}%` }} /></div>
    <small>{spare > 0 ? `${spare} unit masih cadangan` : "Tidak ada cadangan tersisa"}</small>
  </article>;
}

function FragmentRow({ row, expanded, onToggle }: { row: DepotRow; expanded: boolean; onToggle: () => void }) {
  const pct = Math.round(row.utilization * 100);
  const remainingTeam = Math.max(row.depot.fleet.regu - row.teamUsed, 0);
  const status = remainingTeam === 0 && row.teamUsed > 0 ? "full" : row.teamUsed > 0 ? "active" : "idle";
  const remainingPump = Math.max(row.depot.fleet.pompa - row.pumpUsed, 0);
  const remainingTruck = Math.max(row.depot.fleet.truk_tangki - row.truckUsed, 0);
  return <>
    <tr className={expanded ? "expanded" : ""}>
      <td><div className="depot-name-cell"><strong>{row.depot.name}</strong><span>{row.assignments.length} tujuan pengiriman</span></div></td>
      <td><CapacityCell used={row.pumpUsed} total={row.depot.fleet.pompa} unit="pompa" /></td>
      <td><CapacityCell used={row.truckUsed} total={row.depot.fleet.truk_tangki} unit="truk" /></td>
      <td><div className="team-use-cell"><div><span style={{ width: `${Math.min(pct, 100)}%` }} /><i /></div><b>{row.teamUsed}/{row.depot.fleet.regu}</b><small>{pct}%</small></div></td>
      <td><span className={`depot-status ${status}`}>{status === "full" ? "Penuh" : status === "active" ? "Aktif" : "Siap"}</span></td>
      <td><button type="button" className="depot-expand" onClick={onToggle} aria-expanded={expanded}><ChevronDownIcon size={15} /> <span className="sr-only">Rincian {row.depot.name}</span></button></td>
    </tr>
    {expanded && (
      <tr className="depot-detail-row">
        <td colSpan={6}>
          <div className="depot-manifest">
            <aside className="depot-available">
              <div className="depot-detail-heading">
                <span>Kapasitas siap pakai</span>
                <strong>{remainingTeam} regu tersedia</strong>
              </div>
              <div className="depot-resource-grid">
                <div className="depot-resource-stat team">
                  <span className="depot-resource-icon">RG</span>
                  <p><strong>{remainingTeam}</strong><small>Regu</small></p>
                </div>
                <div className="depot-resource-stat flood">
                  <span className="depot-resource-icon"><PumpIcon size={15} /></span>
                  <p><strong>{remainingPump}</strong><small>Pompa</small></p>
                </div>
                <div className="depot-resource-stat drought">
                  <span className="depot-resource-icon"><TruckIcon size={15} /></span>
                  <p><strong>{remainingTruck}</strong><small>Truk</small></p>
                </div>
              </div>
            </aside>

            <section className="depot-dispatches" aria-label={`Manifest pengiriman ${row.depot.name}`}>
              <div className="depot-detail-heading dispatch-heading">
                <span>Manifest pengiriman</span>
                <strong>{row.assignments.length} tujuan aktif</strong>
              </div>
              {row.assignments.length ? (
                <div className="dispatch-card-grid">
                  {row.assignments.map((item) => {
                    const isPump = item.resource === "pompa";
                    return (
                      <article className={`dispatch-card ${isPump ? "flood" : "drought"}`} key={`${item.district_id}:${item.resource}`}>
                        <div className="dispatch-destination">
                          <small>Tujuan</small>
                          <strong>{item.district}</strong>
                        </div>
                        <div className="dispatch-resource">
                          <span>{isPump ? <PumpIcon size={14} /> : <TruckIcon size={14} />}{item.resource_label}</span>
                          <strong>{item.units}<small> unit</small></strong>
                        </div>
                        <div className="dispatch-eta">
                          <small>Estimasi tiba</small>
                          <strong>{item.minutes}<span> menit</span></strong>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="dispatch-empty">
                  <div><strong>Belum ada pengiriman aktif</strong><p>Seluruh kapasitas depot tersedia untuk optimasi berikutnya.</p></div>
                </div>
              )}
            </section>
          </div>
        </td>
      </tr>
    )}
  </>;
}

function CapacityCell({ used, total, unit }: { used: number; total: number; unit: string }) {
  const spare = Math.max(total - used, 0);
  return <div className="capacity-cell">
    <strong>{used} dari {total} {unit}</strong>
    <span>{spare > 0 ? `${spare} cadangan` : "tanpa cadangan"}</span>
  </div>;
}
