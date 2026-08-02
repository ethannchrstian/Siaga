import type { AllocateResponse, Depot } from "../api/client";

interface Props {
  depot: Depot | null;
  result: AllocateResponse | null;
  onClose: () => void;
}

export default function DepotDrawer({ depot, result, onClose }: Props) {
  if (!depot) return null;
  const items = (result?.plan ?? []).filter((p) => p.from_depot === depot.name);
  const pompa = items.filter((p) => p.resource === "pompa").reduce((a, p) => a + p.units, 0);
  const truk = items.filter((p) => p.resource === "truk_tangki").reduce((a, p) => a + p.units, 0);

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="drawer-title">{depot.name}</div>
          <div className="drawer-sub">Depot BPBD · sumber daya</div>
        </div>
        <button className="x" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="depot-fleet">
        <div className="depot-fleet-row">
          <span>Pompa banjir</span>
          <b>
            {pompa} / {depot.fleet.pompa}
          </b>
        </div>
        <div className="depot-fleet-row">
          <span>Truk tangki air</span>
          <b>
            {truk} / {depot.fleet.truk_tangki}
          </b>
        </div>
        <div className="depot-fleet-row">
          <span>Regu personel</span>
          <b>{depot.fleet.regu}</b>
        </div>
      </div>

      <div className="drawer-section">Pengiriman dari depot ini</div>
      {items.length === 0 ? (
        <div className="muted">Belum ada pengiriman pada rencana ini.</div>
      ) : (
        items.map((p) => (
          <div className="drawer-assign" key={p.resource + p.district_id}>
            <b>
              {p.units} {p.resource_label}
            </b>{" "}
            ke {p.district} ({p.minutes} mnt)
          </div>
        ))
      )}
    </div>
  );
}
