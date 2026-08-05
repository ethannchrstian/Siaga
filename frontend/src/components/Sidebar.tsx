import type { AllocateResponse, PlanItem } from "../api/client";
import { useCountUp } from "../hooks/useCountUp";

interface Props {
  result: AllocateResponse | null;
  loading: boolean;
  locks: Set<string>;
  rejects: Set<string>;
  onLock: (p: PlanItem) => void;
  onReject: (p: PlanItem) => void;
  onClearReject: (key: string) => void;
  onSelect: (districtId: string) => void;
  labelFor: (key: string) => string;
  /** True while the map shows the uncoordinated counterfactual — the SIAGA
   *  plan stays visible here but can't be edited against the wrong map. */
  readonly?: boolean;
  /** Expected-covered change vs the previous solve (same date); shows the
   *  operator what their last Kunci/Tolak actually cost or gained. */
  coverageDelta?: number | null;
  crew?: { used: number; total: number };
}

const key = (p: PlanItem) => `${p.district_id}:${p.resource}`;

function idNum(n: number): string {
  return n.toLocaleString("id-ID");
}

export default function Sidebar({
  result,
  loading,
  locks,
  rejects,
  onLock,
  onReject,
  onClearReject,
  onSelect,
  labelFor,
  readonly,
  coverageDelta,
  crew,
}: Props) {
  const s = result?.summary;
  const covered = useCountUp(result?.comparison?.siaga.expected_covered ?? 0, 600);
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">Rencana prapenempatan</div>
        {s && (
          <div className="summary">
            <span>
              <b>{s.total_dispatched.pompa}</b>/{s.total_fleet.pompa} pompa
            </span>
            <span>
              <b>{s.total_dispatched.truk_tangki}</b>/{s.total_fleet.truk_tangki}{" "}
              truk
            </span>
            <span>
              <b>{s.n_districts_served}</b> kecamatan
            </span>
            <span>armada {s.fleet_used_pct}%</span>
          </div>
        )}
        {result?.comparison && (
          <div className="coverage-line">
            <span>
              ≈ <b>{idNum(covered)}</b> jiwa terlindungi
            </span>
            {coverageDelta != null && coverageDelta !== 0 && (
              <span
                className={`coverage-delta ${coverageDelta > 0 ? "up" : "down"}`}
                title="Perubahan akibat keputusan terakhir Anda"
              >
                {coverageDelta > 0 ? "▲" : "▼"} {idNum(Math.abs(coverageDelta))}
              </span>
            )}
          </div>
        )}
        {crew && crew.total > 0 && (
          <div className="crew-meter" title="Satu regu per unit yang dikirim — pompa dan truk bersaing untuk regu yang sama">
            <span className="crew-label">
              Regu <b>{crew.used}</b>/{crew.total}
            </span>
            <span className="crew-track">
              <span
                className="crew-fill"
                style={{ width: `${Math.min(100, (100 * crew.used) / crew.total)}%` }}
              />
            </span>
          </div>
        )}
      </div>

      {rejects.size > 0 && (
        <div className="rejected-bar">
          {[...rejects].map((k) => (
            <button
              key={k}
              className="chip reject"
              onClick={() => onClearReject(k)}
              title="Batalkan penolakan"
            >
              ✕ {labelFor(k)}
            </button>
          ))}
        </div>
      )}

      <div className={`cards${loading ? " solving" : ""}`}>
        {loading && <div className="muted">Mengoptimasi ulang…</div>}
        {!loading && result && result.plan.length === 0 && (
          <div className="muted">
            Tidak ada kebutuhan prapenempatan pada tanggal ini.
          </div>
        )}
        {result?.plan.map((p, idx) => {
          const k = key(p);
          const locked = locks.has(k);
          const isFlood = p.resource === "pompa";
          return (
            <div
              className={`card${locked ? " locked" : ""}`}
              key={k}
              style={{ "--i": idx } as React.CSSProperties}
            >
              <div className="card-top">
                <span
                  className="tag"
                  style={{ background: isFlood ? "#1463d6" : "#ef3c35" }}
                >
                  {isFlood ? "BANJIR" : "CEKAMAN AIR"}
                </span>
                <button
                  className="link"
                  onClick={() => onSelect(p.district_id)}
                  title="Lihat detail kecamatan"
                >
                  {p.district}
                </button>
                <span className="kab">{p.kabupaten}</span>
              </div>
              <div className="card-line">
                <b>
                  {p.units} {p.resource_label}
                </b>{" "}
                dari {p.from_depot}
              </div>
              <div className="card-meta">
                {Math.round(p.hazard_prob * 100)}% peluang · {p.minutes} mnt ·{" "}
                {idNum(p.people_exposed)} jiwa terpapar
              </div>
              <div
                className="card-reason"
                style={{ borderLeftColor: isFlood ? "#1463d6" : "#ef3c35" }}
              >
                {p.reason}
              </div>
              <div className="card-actions">
                <button
                  className={`btn${locked ? " on" : ""}`}
                  onClick={() => onLock(p)}
                  disabled={readonly}
                  title={readonly ? "Kembali ke mode Terpadu untuk mengubah rencana" : undefined}
                >
                  {locked ? "✓ Terkunci" : "Kunci"}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => onReject(p)}
                  disabled={readonly}
                  title={readonly ? "Kembali ke mode Terpadu untuk mengubah rencana" : undefined}
                >
                  Tolak
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
