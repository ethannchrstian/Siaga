import { sourcesOf, type AllocateResponse, type Depot } from "../api/client";
import { TargetIcon } from "../icons";

interface Props {
  depot: Depot | null;
  result: AllocateResponse | null;
  reachVisible: boolean;
  onToggleReach: () => void;
  onClose: () => void;
}

export default function DepotDrawer({ depot, result, reachVisible, onToggleReach, onClose }: Props) {
  if (!depot) return null;
  const items = (result?.plan ?? []).flatMap((item) =>
    sourcesOf(item).filter((source) => source.depot_id === depot.depot_id).map((source) => ({ item, source })),
  );
  const pumps = items.filter(({ item }) => item.resource === "pompa").reduce((sum, { source }) => sum + source.units, 0);
  const trucks = items.filter(({ item }) => item.resource === "truk_tangki").reduce((sum, { source }) => sum + source.units, 0);
  const teams = pumps + trucks;
  const destinations = new Set(items.map(({ item }) => item.district_id)).size;

  return <div className="drawer depot-readiness-drawer">
    <div className="drawer-head">
      <div><div className="drawer-title">{depot.name}</div><div className="drawer-sub">{depot.tier === "local" ? "Depot lokal" : depot.tier === "regional" ? "Dukungan regional" : "Cadangan provinsi terkonfirmasi"} · inventaris InaLogpal</div></div>
      <button className="x" onClick={onClose} aria-label="Tutup detail depot">×</button>
    </div>
    <div className="drawer-body">
      <div className="drawer-section">
        Armada di depot ini
        <em>sisa skenario / terdaftar</em>
      </div>
      <div className="depot-fleet">
        <Availability label="Pompa banjir" used={pumps} total={depot.fleet.pompa} />
        <Availability label="Truk tangki air" used={trucks} total={depot.fleet.truk_tangki} />
        <Availability label="Regu (asumsi)" used={teams} total={depot.fleet.regu} />
      </div>
      <div className="depot-provenance">
        <span>Peralatan terdaftar · belum menyatakan kesiapan aktual</span>
        <span>{depot.location_accuracy === "provincial_capital_proxy" ? "Lokasi ibu kota provinsi (proxy)" : "Lokasi centroid kabupaten/kota"}</span>
      </div>
      <div className="depot-reach-control">
        <button type="button" className={reachVisible ? "is-on" : ""} onClick={onToggleReach}>
          <TargetIcon size={14} />
          {reachVisible ? "Sembunyikan cakupan depot" : "Lihat cakupan depot ini"}
        </button>
        <p>Perkiraan geometris setara batas 180 menit; kondisi jalan aktual tetap perlu dikonfirmasi.</p>
      </div>
      <div className="drawer-section">
        Pengiriman dari depot ini
        {items.length > 0 && <em>{teams} unit · {destinations} kecamatan</em>}
      </div>
      {items.length === 0 ? <div className="drawer-gap-state">Belum ada pengiriman. Seluruh kapasitas tersedia untuk optimasi.</div> : items.map(({ item, source }) => <div className={`drawer-assign evidence-assignment ${item.resource === "pompa" ? "flood" : "drought"}`} key={`${item.resource}:${item.district_id}:${source.depot_id}`}><b>{source.units} {item.resource_label}</b><span>ke {item.district} · {source.minutes} menit</span></div>)}
    </div>
  </div>;
}

/** Both numbers matter to a shift: what is left to give, and how much of the
 *  depot this plan already spends. The bar carries the second one so the row
 *  does not need a third figure. */
function Availability({ label, used, total }: { label: string; used: number; total: number }) {
  const available = Math.max(total - used, 0);
  const spent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return <div className="depot-fleet-row">
    <div className="depot-fleet-line"><span>{label}</span><b><em>{available}</em> / {total}</b></div>
    <i className="depot-fleet-bar" aria-hidden="true"><em style={{ width: `${spent}%` }} /></i>
    <small>{used === 0 ? "seluruhnya tersedia" : `${used} dikerahkan pada rencana ini`}</small>
  </div>;
}
