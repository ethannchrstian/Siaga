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
            <h1>Perintah Prapenempatan Sumber Daya</h1>
            <p className="order-sub">
              Koridor Pantura &middot; disusun oleh SIAGA, diputuskan oleh operator
            </p>
          </div>
          <dl className="order-meta">
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
            <span className="order-figure">{lockedCount}</span>
            <span className="order-figure-label">dikunci operator</span>
          </div>
          <div>
            <span className="order-figure">{fmt(covered)}</span>
            <span className="order-figure-label">
              jiwa tercakup, rata-rata 30 skenario
            </span>
          </div>
        </section>

        <table className="order-table">
          <caption>
            Rencana penempatan. Baris bertanda &#10003; sudah dikunci operator dan
            tidak akan berubah pada optimasi berikutnya.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="col-tick">&#10003;</th>
              <th scope="col">Kecamatan</th>
              <th scope="col">Kabupaten/Kota</th>
              <th scope="col">Sumber daya</th>
              <th scope="col" className="num">Unit</th>
              <th scope="col">Dari depot</th>
              <th scope="col" className="num">Tempuh</th>
              <th scope="col" className="num">Peluang</th>
              <th scope="col" className="num">Jiwa terpapar</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => {
              const locked = locks.has(keyOf(p));
              return (
                <tr key={keyOf(p)} className={locked ? "is-locked" : undefined}>
                  <td className="col-tick">{locked ? "✓" : ""}</td>
                  <td>{p.district}</td>
                  <td>{p.kabupaten}</td>
                  <td>{p.resource_label}</td>
                  <td className="num">{p.units}</td>
                  <td>{p.from_depot}</td>
                  <td className="num">{p.minutes} mnt</td>
                  <td className="num">{Math.round(p.hazard_prob * 100)}%</td>
                  <td className="num">{fmt(p.people_exposed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {relevant.length > 0 && (
          <section className="order-log">
            <h2>Catatan keputusan operator</h2>
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
          <p>
            <strong>Dasar perhitungan.</strong> Peluang bahaya berasal dari model
            terkalibrasi atas curah hujan ERA5 dan debit GloFAS; jiwa terpapar
            dihitung dari WorldPop. Rencana dipilih oleh optimasi stokastik dua
            tahap yang meminimalkan kebutuhan tak terpenuhi beserta risiko
            ekornya, dengan pompa dan truk memperebutkan satu kumpulan regu.
          </p>
          <p>
            <strong>Peringatan.</strong> Peluang bahaya bukan kepastian. Pada
            ambang operasi, sekitar dua dari tiga peringatan banjir tidak diikuti
            kejadian. Perintah ini adalah usulan prapenempatan, bukan pernyataan
            bahwa bencana pasti terjadi.
            {scenarioNote ? ` ${scenarioNote}` : ""}
          </p>
          <p className="order-sign">
            Diperiksa dan disetujui: ..................................................
          </p>
        </footer>
      </div>
    </div>
  );
}
