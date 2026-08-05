import { useMemo, useState } from "react";
import type { AllocateResponse, Depot, PlanItem } from "../api/client";
import { ChevronDownIcon, PumpIcon, SearchIcon, TruckIcon } from "../icons";

interface Props {
  depots: Depot[];
  result: AllocateResponse | null;
  note?: string;
}

type CapacityFilter = "all" | "critical" | "active" | "idle";

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
  const criticalCount = rows.filter((row) => row.utilization >= 0.8).length;
  const visibleRows = rows.filter((row) => {
    const matchesQuery = !query.trim() || row.depot.name.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id"));
    const matchesFilter = filter === "all" || (filter === "critical" && row.utilization >= 0.8) || (filter === "active" && row.teamUsed > 0) || (filter === "idle" && row.teamUsed === 0);
    return matchesQuery && matchesFilter;
  });

  return (
    <main className="page readiness-page">
      <header className="operational-page-head">
        <div>
          <span className="operational-page-kicker">Kapasitas respons</span>
          <h1>Kesiapan armada</h1>
          <p>{depots.length} depot BPBD · koridor Pantura</p>
        </div>
        <span className="scenario-data-badge">Inventaris skenario</span>
      </header>

      {criticalCount > 0 ? (
        <div className="capacity-alert"><span>!</span><div><strong>{criticalCount} depot melewati batas perhatian 80%</strong><p>Periksa sisa regu sebelum mengunci alokasi tambahan.</p></div></div>
      ) : (
        <div className="capacity-alert stable"><span>✓</span><div><strong>Kapasitas depot masih terkendali</strong><p>Tidak ada depot yang menggunakan 80% atau lebih kapasitas regu.</p></div></div>
      )}

      <section className="readiness-totals">
        <CapacityCard label="Pompa banjir" available={totals.pump - totals.pumpUsed} used={totals.pumpUsed} total={totals.pump} tone="flood" Icon={PumpIcon} />
        <CapacityCard label="Truk tangki air" available={totals.truck - totals.truckUsed} used={totals.truckUsed} total={totals.truck} tone="drought" Icon={TruckIcon} />
        <CapacityCard label="Regu personel" available={totals.team - totals.teamUsed} used={totals.teamUsed} total={totals.team} tone="team" />
        <div className="readiness-summary-card"><span>Depot kritis</span><strong>{criticalCount}</strong><p>dari {depots.length} depot melewati 80%</p></div>
      </section>

      <section className="readiness-panel">
        <div className="readiness-toolbar">
          <label className="readiness-search"><SearchIcon size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari depot..." /><span className="sr-only">Cari depot</span></label>
          <div className="readiness-filters" aria-label="Filter kapasitas depot">
            {([[
              "all", "Semua depot",
            ], ["critical", "Kritis ≥80%"], ["active", "Sedang mengirim"], ["idle", "Belum digunakan"]] as [CapacityFilter, string][]).map(([value, label]) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
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

function CapacityCard({ label, available, used, total, tone, Icon }: { label: string; available: number; used: number; total: number; tone: string; Icon?: typeof PumpIcon }) {
  const percentage = total ? Math.min((used / total) * 100, 100) : 0;
  return <article className={`capacity-card ${tone}`}><div className="capacity-card-head">{Icon && <Icon size={19} />}<span>{label}</span></div><div className="capacity-card-value"><strong>{Math.max(available, 0)}</strong><span>tersedia dari {total}</span></div><div className="capacity-track"><span style={{ width: `${percentage}%` }} /></div><small>{used} sedang dialokasikan</small></article>;
}

function FragmentRow({ row, expanded, onToggle }: { row: DepotRow; expanded: boolean; onToggle: () => void }) {
  const pct = Math.round(row.utilization * 100);
  const status = pct >= 80 ? "critical" : row.teamUsed > 0 ? "active" : "idle";
  return <>
    <tr className={expanded ? "expanded" : ""}>
      <td><div className="depot-name-cell"><strong>{row.depot.name}</strong><span>{row.assignments.length} tujuan pengiriman</span></div></td>
      <td><CapacityCell used={row.pumpUsed} total={row.depot.fleet.pompa} unit="pompa" /></td>
      <td><CapacityCell used={row.truckUsed} total={row.depot.fleet.truk_tangki} unit="truk" /></td>
      <td><div className="team-use-cell"><div><span style={{ width: `${Math.min(pct, 100)}%` }} /><i /></div><b>{row.teamUsed}/{row.depot.fleet.regu}</b><small>{pct}%</small></div></td>
      <td><span className={`depot-status ${status}`}>{status === "critical" ? "Kritis" : status === "active" ? "Aktif" : "Siap"}</span></td>
      <td><button type="button" className="depot-expand" onClick={onToggle} aria-expanded={expanded}><ChevronDownIcon size={15} /> <span className="sr-only">Rincian {row.depot.name}</span></button></td>
    </tr>
    {expanded && <tr className="depot-detail-row"><td colSpan={6}><div className="depot-assignment-list"><div><span>Sisa kapasitas</span><strong>{Math.max(row.depot.fleet.regu - row.teamUsed, 0)} regu · {Math.max(row.depot.fleet.pompa - row.pumpUsed, 0)} pompa · {Math.max(row.depot.fleet.truk_tangki - row.truckUsed, 0)} truk</strong></div>{row.assignments.length ? row.assignments.map((item) => <div key={`${item.district_id}:${item.resource}`}><span>{item.district}</span><strong>{item.units} {item.resource_label} · {item.minutes} menit</strong></div>) : <div><span>Belum ada pengiriman</span><strong>Seluruh kapasitas tersedia untuk optimasi.</strong></div>}</div></td></tr>}
  </>;
}

function CapacityCell({ used, total, unit }: { used: number; total: number; unit: string }) {
  return <div className="capacity-cell"><strong>{Math.max(total - used, 0)} tersedia</strong><span>{used}/{total} {unit} digunakan</span></div>;
}
