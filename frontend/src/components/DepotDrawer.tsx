import type { AllocateResponse, Depot } from "../api/client";

interface Props { depot: Depot | null; result: AllocateResponse | null; onClose: () => void; }

export default function DepotDrawer({ depot, result, onClose }: Props) {
  if (!depot) return null;
  const items = (result?.plan ?? []).filter((item) => item.from_depot === depot.name);
  const pumps = items.filter((item) => item.resource === "pompa").reduce((sum, item) => sum + item.units, 0);
  const trucks = items.filter((item) => item.resource === "truk_tangki").reduce((sum, item) => sum + item.units, 0);
  const teams = pumps + trucks;

  return <div className="drawer depot-readiness-drawer">
    <div className="drawer-head"><div><div className="drawer-title">{depot.name}</div><div className="drawer-sub">Depot BPBD · kapasitas skenario</div></div><button className="x" onClick={onClose} aria-label="Tutup detail depot">×</button></div>
    <div className="depot-fleet">
      <Availability label="Pompa tersedia" available={depot.fleet.pompa - pumps} total={depot.fleet.pompa} />
      <Availability label="Truk tersedia" available={depot.fleet.truk_tangki - trucks} total={depot.fleet.truk_tangki} />
      <Availability label="Regu tersedia" available={depot.fleet.regu - teams} total={depot.fleet.regu} />
    </div>
    <div className="drawer-section">Pengiriman dari depot ini</div>
    {items.length === 0 ? <div className="drawer-gap-state">Belum ada pengiriman. Seluruh kapasitas tersedia untuk optimasi.</div> : items.map((item) => <div className={`drawer-assign evidence-assignment ${item.resource === "pompa" ? "flood" : "drought"}`} key={`${item.resource}:${item.district_id}`}><b>{item.units} {item.resource_label}</b><span>ke {item.district} · {item.minutes} menit</span></div>)}
  </div>;
}

function Availability({ label, available, total }: { label: string; available: number; total: number }) {
  return <div className="depot-fleet-row"><span>{label}</span><b>{Math.max(available, 0)} / {total}</b></div>;
}
