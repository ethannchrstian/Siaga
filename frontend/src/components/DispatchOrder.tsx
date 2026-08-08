/** Printable pre-positioning order.
 *
 * The app decides where the fleet should go and then, until now, kept that
 * decision inside a browser tab. A Pusdalops shift needs to hand the plan to
 * the depots that will execute it, and to leave a copy behind for whoever asks
 * later why the trucks went where they went.
 *
 * Rendered as an overlay and printed with the browser, so there is no PDF
 * dependency to ship and no server round trip. `window.print()` on this view
 * produces a document with the plan, the operator's own decisions, and the
 * provenance note that keeps scenario figures from being read as real
 * inventory.
 */

import type { AllocateResponse, PlanItem } from "../api/client";
import {
  formatDateTime,
  KIND_LABEL,
  operatorName,
  type DecisionEntry,
} from "../decisionLog";

interface Props {
  result: AllocateResponse;
  locks: Set<string>;
  log: DecisionEntry[];
  planDate: string;
  scenarioNote?: string;
  onClose: () => void;
}

const fmt = (n: number) => n.toLocaleString("id-ID");

function keyOf(p: PlanItem) {
  return `${p.district_id}:${p.resource}`;
}

/** A bare percentage in a column called "Peluang" does not say peluang of
 *  what. Every row names its hazard and the window the probability covers, so
 *  the number next to it can only be read one way. */
const HAZARD = {
  pompa: { name: "Banjir", horizon: "0–72 jam", cls: "flood" },
  truk_tangki: { name: "Cekaman air", horizon: "bulan depan", cls: "drought" },
} as const;

interface DepotTotals {
  name: string;
  pompa: number;
  truk_tangki: number;
  districts: Set<string>;
  slowest: number;
}

/** Pusdalops issues one order, but each depot only executes its own lines.
 *  The recap is what a depot commander checks against their yard. */
function depotTotals(plan: PlanItem[]): DepotTotals[] {
  const byDepot = new Map<string, DepotTotals>();
  for (const p of plan) {
    let row = byDepot.get(p.from_depot);
    if (!row) {
      row = { name: p.from_depot, pompa: 0, truk_tangki: 0, districts: new Set(), slowest: 0 };
      byDepot.set(p.from_depot, row);
    }
    row[p.resource] += p.units;
    row.districts.add(p.district_id);
    row.slowest = Math.max(row.slowest, p.minutes);
  }
  return [...byDepot.values()].sort(
    (a, b) => b.pompa + b.truk_tangki - (a.pompa + a.truk_tangki) || a.name.localeCompare(b.name),
  );
}

export default function DispatchOrder({
  result,
  locks,
  log,
  planDate,
  scenarioNote,
  onClose,
}: Props) {
  const issued = new Date().toISOString();
  const plan = result.plan;
  const lockedCount = plan.filter((p) => locks.has(keyOf(p))).length;
  const totalUnits = plan.reduce((s, p) => s + p.units, 0);
  // Not the sum of the exposure column. A kecamatan facing both hazards has one
  // row per hazard, so adding that column counts its population twice. This is
  // the backend's own coverage figure, the same one the dashboard reports.
  const covered = result.comparison?.siaga.expected_covered ?? 0;
  const districtCount = new Set(plan.map((p) => p.district_id)).size;

  // Only decisions taken against the plan currently on screen belong on the
  // order. Earlier dates are history, not instructions.
  const relevant = log.filter((e) => e.planDate === planDate);
  const depots = depotTotals(plan);
  const reference = `SIAGA/PP/${planDate}`;

  return (
    <div className="order-backdrop" role="dialog" aria-label="Surat perintah prapenempatan">
      <div className="order-sheet">
        <div className="order-actions">
          <button className="btn-primary" onClick={() => window.print()}>
            Cetak atau simpan PDF
          </button>
          <button className="btn-quiet" onClick={onClose}>
            Tutup
          </button>
        </div>

        <header className="order-head">
          <div>
            <p className="order-eyebrow">
              Pusdalops &middot; Koridor Pantura &middot; Sistem SIAGA
            </p>
            <h1>Perintah Prapenempatan Sumber Daya</h1>
            <p className="order-sub">
              Rencana disusun oleh SIAGA, keputusan akhir pada operator Pusdalops
            </p>
          </div>
          <dl className="order-meta">
            <div>
              <dt>Nomor dokumen</dt>
              <dd>{reference}</dd>
            </div>
            <div>
              <dt>Tanggal operasi</dt>
              <dd>{planDate}</dd>
            </div>
            <div>
              <dt>Diterbitkan</dt>
              <dd>{formatDateTime(issued)}</dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{operatorName()}</dd>
            </div>
          </dl>
        </header>

        <section className="order-summary">
          <div>
            <span className="order-figure">{districtCount}</span>
            <span className="order-figure-label">kecamatan dituju</span>
          </div>
          <div>
            <span className="order-figure">{totalUnits}</span>
            <span className="order-figure-label">unit dikerahkan</span>
          </div>
          <div>
            <span className="order-figure">{depots.length}</span>
            <span className="order-figure-label">depot pelaksana</span>
          </div>
          <div>
            <span className="order-figure">{lockedCount}</span>
            <span className="order-figure-label">baris dikunci operator</span>
          </div>
          <div>
            <span className="order-figure">{fmt(covered)}</span>
            <span className="order-figure-label">
              jiwa tercakup, rata-rata 30 skenario
            </span>
          </div>
        </section>

        <h2 className="order-h2">A. Rencana penempatan per kecamatan</h2>
        <table className="order-table">
          <caption>
            Diurutkan menurut jiwa terpapar, paling besar di atas. Satu kecamatan
            dapat muncul dua baris bila menghadapi dua bahaya sekaligus. Baris
            bertanda &#10003; sudah dikunci operator dan tidak akan berubah pada
            optimasi berikutnya.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="col-tick">&#10003;</th>
              <th scope="col">Kecamatan</th>
              <th scope="col">Bahaya yang diantisipasi</th>
              <th scope="col" className="num">Peluang bahaya</th>
              <th scope="col">Sumber daya</th>
              <th scope="col" className="num">Unit</th>
              <th scope="col">Dari depot</th>
              <th scope="col" className="num">Tempuh</th>
              <th scope="col" className="num">Jiwa terpapar</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => {
              const locked = locks.has(keyOf(p));
              const hazard = HAZARD[p.resource];
              return (
                <tr key={keyOf(p)} className={locked ? "is-locked" : undefined}>
                  <td className="col-tick">{locked ? "✓" : ""}</td>
                  <td>
                    {p.district}
                    <small>{p.kabupaten}</small>
                  </td>
                  <td>
                    <span className={`order-hazard ${hazard.cls}`}>{hazard.name}</span>
                    <small>{hazard.horizon}</small>
                  </td>
                  <td className="num">{Math.round(p.hazard_prob * 100)}%</td>
                  <td>{p.resource_label}</td>
                  <td className="num">{p.units}</td>
                  <td>{p.from_depot}</td>
                  <td className="num">{p.minutes} mnt</td>
                  <td className="num">{fmt(p.people_exposed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 className="order-h2">B. Rekapitulasi per depot pelaksana</h2>
        <table className="order-table">
          <caption>
            Yang harus disiapkan tiap depot. Regu diambil dari satu kumpulan yang
            sama untuk pompa maupun truk, sehingga jumlah regu sama dengan jumlah
            unit yang berangkat.
          </caption>
          <thead>
            <tr>
              <th scope="col">Depot</th>
              <th scope="col" className="num">Pompa banjir</th>
              <th scope="col" className="num">Truk tangki air</th>
              <th scope="col" className="num">Total unit</th>
              <th scope="col" className="num">Kecamatan dituju</th>
              <th scope="col" className="num">Tempuh terjauh</th>
            </tr>
          </thead>
          <tbody>
            {depots.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td className="num">{d.pompa || "—"}</td>
                <td className="num">{d.truk_tangki || "—"}</td>
                <td className="num">{d.pompa + d.truk_tangki}</td>
                <td className="num">{d.districts.size}</td>
                <td className="num">{d.slowest} mnt</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Jumlah</td>
              <td className="num">{depots.reduce((s, d) => s + d.pompa, 0)}</td>
              <td className="num">{depots.reduce((s, d) => s + d.truk_tangki, 0)}</td>
              <td className="num">{totalUnits}</td>
              {/* Deliberately blank: a kecamatan served by two depots is counted
                  by both, so the column does not sum to the order's kecamatan
                  count. That figure is in the summary at the top. */}
              <td className="num" />
              <td className="num" />
            </tr>
          </tfoot>
        </table>

        {relevant.length > 0 && (
          <section className="order-log">
            <h2 className="order-h2">C. Catatan keputusan operator</h2>
            <table className="order-table">
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Tindakan</th>
                  <th scope="col">Kecamatan</th>
                  <th scope="col">Sumber daya</th>
                  <th scope="col">Operator</th>
                </tr>
              </thead>
              <tbody>
                {relevant.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{formatDateTime(e.at)}</td>
                    <td>{KIND_LABEL[e.kind]}</td>
                    <td>{e.district ?? "—"}</td>
                    <td>
                      {e.resourceLabel
                        ? `${e.units ?? ""} ${e.resourceLabel}`.trim()
                        : "—"}
                    </td>
                    <td>{e.operator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="order-foot">
          <h2 className="order-h2">Keterangan</h2>
          <p>
            <strong>Arti kolom Peluang bahaya.</strong> Probabilitas bahaya pada
            kolom di sebelahnya terjadi di kecamatan tersebut, dalam jangka waktu
            yang tertulis di bawah nama bahaya: 0&ndash;72 jam untuk banjir, satu
            bulan ke depan untuk cekaman air. Angka ini bukan tingkat keparahan
            dan bukan bagian penduduk yang terdampak.
          </p>
          <p>
            <strong>Dasar perhitungan.</strong> Peluang bahaya berasal dari model
            terkalibrasi atas curah hujan ERA5 dan debit GloFAS; jiwa terpapar
            dihitung dari WorldPop sebagai peluang bahaya tertinggi dikalikan
            populasi, bukan perkiraan jumlah korban. Rencana dipilih oleh optimasi
            stokastik dua tahap yang meminimalkan kebutuhan tak terpenuhi beserta
            risiko ekornya, dengan pompa dan truk memperebutkan satu kumpulan
            regu.
          </p>
          <p>
            <strong>Peringatan.</strong> Peluang bahaya bukan kepastian. Pada
            ambang operasi, sekitar dua dari tiga peringatan banjir tidak diikuti
            kejadian. Perintah ini adalah usulan prapenempatan, bukan pernyataan
            bahwa bencana pasti terjadi.
            {scenarioNote ? ` ${scenarioNote}` : ""}
          </p>
          <div className="order-signatures">
            <div>
              <span className="order-sign-role">Disusun oleh</span>
              <span className="order-sign-line" aria-hidden="true" />
              <span className="order-sign-name">Sistem SIAGA</span>
              <span className="order-sign-note">{reference}</span>
            </div>
            <div>
              <span className="order-sign-role">Diperiksa dan disetujui</span>
              <span className="order-sign-line" aria-hidden="true" />
              <span className="order-sign-name">{operatorName()}</span>
              <span className="order-sign-note">Nama terang, tanda tangan, dan tanggal</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
