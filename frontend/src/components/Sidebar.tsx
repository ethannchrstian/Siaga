import type { AllocateResponse, PlanItem } from "../api/client";

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
}: Props) {
  const s = result?.summary;
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

      <div className="cards">
        {loading && <div className="muted">Mengoptimasi ulang…</div>}
        {!loading && result && result.plan.length === 0 && (
          <div className="muted">
            Tidak ada kebutuhan prapenempatan pada tanggal ini.
          </div>
        )}
        {result?.plan.map((p) => {
          const k = key(p);
          const locked = locks.has(k);
          const isFlood = p.resource === "pompa";
          return (
            <div className={`card${locked ? " locked" : ""}`} key={k}>
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
              <div className="card-actions">
                <button
                  className={`btn${locked ? " on" : ""}`}
                  onClick={() => onLock(p)}
                >
                  {locked ? "✓ Terkunci" : "Kunci"}
                </button>
                <button className="btn ghost" onClick={() => onReject(p)}>
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
