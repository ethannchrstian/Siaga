import { useMemo, useState, type CSSProperties } from "react";
import type { AllocateResponse, PlanItem } from "../api/client";
import { useCountUp } from "../hooks/useCountUp";
import { InfoIcon, SearchIcon } from "../icons";
import { CRITICAL_ALLOCATION_THRESHOLD_HELP } from "../thresholds";

interface Props {
  result: AllocateResponse | null;
  loading: boolean;
  locks: Set<string>;
  rejects: Set<string>;
  onLock: (plan: PlanItem) => void;
  onReject: (plan: PlanItem) => void;
  onClearReject: (key: string) => void;
  onSelect: (districtId: string) => void;
  labelFor: (key: string) => string;
  /** SIAGA recommendations remain visible while the map shows the baseline. */
  readonly?: boolean;
  /** Expected-covered change caused by the latest lock/reject decision. */
  coverageDelta?: number | null;
  crew?: { used: number; total: number };
}

interface DecisionGroup {
  districtId: string;
  district: string;
  kabupaten: string;
  items: PlanItem[];
  exposure: number;
}

type DecisionFilter = "all" | "compound" | "flood" | "drought" | "locked";

const key = (plan: PlanItem) => `${plan.district_id}:${plan.resource}`;

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
  readonly = false,
  coverageDelta,
  crew,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const summary = result?.summary;
  const covered = useCountUp(result?.comparison?.siaga.expected_covered ?? 0, 600);
  const groups = useMemo(() => groupPlan(result?.plan ?? []), [result]);
  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id");
    return groups.filter((group) => {
      const resources = new Set(group.items.map((item) => item.resource));
      const matchesFilter =
        filter === "all" ||
        (filter === "compound" && resources.size > 1) ||
        (filter === "flood" && resources.has("pompa")) ||
        (filter === "drought" && resources.has("truk_tangki")) ||
        (filter === "locked" && group.items.some((item) => locks.has(key(item))));
      const location = `${group.district} ${group.kabupaten}`.toLocaleLowerCase("id");
      return matchesFilter && (!normalized || location.includes(normalized));
    });
  }, [filter, groups, locks, query]);

  const readonlyTitle = readonly
    ? "Kembali ke mode Terpadu untuk mengubah rencana"
    : undefined;

  return (
    <aside className="sidebar decision-sidebar">
      <div className="sidebar-head">
        <div className="sidebar-kicker">Rekomendasi keputusan</div>
        <div className="sidebar-title-row">
          <div className="sidebar-title">Rencana prapenempatan</div>
          <span className="plan-count">{groups.length}</span>
        </div>
        {summary && (
          <div className="decision-summary-line">
            <span><b>{summary.n_districts_served}</b> kecamatan</span>
            <span><b>{summary.total_dispatched.pompa + summary.total_dispatched.truk_tangki}</b> unit</span>
            <span><b>{summary.fleet_used_pct}%</b> armada</span>
          </div>
        )}
        {result?.comparison && (
          <div className="coverage-line">
            <span>≈ <b>{idNum(covered)}</b> jiwa terlindungi</span>
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
          <div
            className="crew-meter"
            title="Satu regu per unit yang dikirim—pompa dan truk menggunakan kumpulan regu yang sama"
          >
            <span className="crew-label">Regu <b>{crew.used}</b>/{crew.total}</span>
            <span className="crew-track">
              <span
                className="crew-fill"
                style={{ width: `${Math.min(100, (100 * crew.used) / crew.total)}%` }}
              />
            </span>
          </div>
        )}
      </div>

      {readonly && (
        <div className="sidebar-readonly-note">
          Peta menampilkan baseline Terpisah. Kembali ke Terpadu untuk mengubah rekomendasi SIAGA.
        </div>
      )}

      <div className="optimizer-threshold-note" title={CRITICAL_ALLOCATION_THRESHOLD_HELP}>
        <span className="optimizer-threshold-icon"><InfoIcon size={13} /></span>
        <div>
          <strong>Ambang Alokasi Kritis · 5%</strong>
          <p>Optimizer mempertimbangkan kebutuhan mulai peluang 5%. Ini terpisah dari Ambang Pemantauan 50% dan tidak menjamin alokasi otomatis.</p>
        </div>
      </div>

      <div className="decision-tools">
        <label className="decision-search">
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari kecamatan..."
          />
          <span className="sr-only">Cari rekomendasi kecamatan</span>
        </label>
        <div className="decision-filters" aria-label="Filter rekomendasi">
          {([
            ["all", "Semua"],
            ["compound", "Majemuk"],
            ["flood", "Banjir"],
            ["drought", "Cekaman"],
            ["locked", "Dikunci"],
          ] as [DecisionFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rejects.size > 0 && (
        <div className="rejected-bar">
          <span className="rejected-label">Dialihkan · klik untuk batalkan</span>
          {[...rejects].map((rejectKey) => (
            <button
              type="button"
              key={rejectKey}
              className="chip reject"
              onClick={() => onClearReject(rejectKey)}
              disabled={readonly}
              title={readonlyTitle}
            >
              × {labelFor(rejectKey)}
            </button>
          ))}
        </div>
      )}

      <div className={`cards decision-group-list${loading ? " solving" : ""}`}>
        {loading && <DecisionSkeleton />}
        {!loading && result && result.plan.length === 0 && (
          <div className="decision-empty">Tidak ada kebutuhan prapenempatan pada tanggal ini. Pilih tanggal lain untuk melihat rekomendasi.</div>
        )}
        {!loading && result && result.plan.length > 0 && visibleGroups.length === 0 && (
          <div className="decision-empty">Tidak ada rekomendasi yang sesuai dengan pencarian atau filter.</div>
        )}

        {!loading && visibleGroups.map((group, index) => {
          const isCompound = new Set(group.items.map((item) => item.resource)).size > 1;
          return (
            <article
              className={`decision-card${isCompound ? " compound" : ""}`}
              key={group.districtId}
              style={{ "--i": index } as CSSProperties}
            >
              <header className="decision-card-head">
                <span className="decision-rank">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className="decision-card-title-row">
                    <button type="button" onClick={() => onSelect(group.districtId)}>{group.district}</button>
                    <span className={`decision-hazard-label ${isCompound ? "compound" : group.items[0].resource === "pompa" ? "flood" : "drought"}`}>
                      {isCompound ? "Majemuk" : group.items[0].resource === "pompa" ? "Banjir" : "Cekaman air"}
                    </span>
                  </div>
                  <span className="decision-location">{group.kabupaten}</span>
                </div>
                <div className="decision-exposure">
                  <span>Estimasi paparan</span><b>{idNum(group.exposure)}</b><small>jiwa</small>
                </div>
              </header>

              <div className="decision-resource-list">
                {group.items.map((item) => {
                  const itemKey = key(item);
                  const locked = locks.has(itemKey);
                  const flood = item.resource === "pompa";
                  const probability = Math.round(item.hazard_prob * 100);
                  return (
                    <section className={`decision-resource-row ${flood ? "flood" : "drought"}`} key={itemKey}>
                      <div className="decision-resource-main">
                        <span className="decision-resource-type">{flood ? "Banjir · 0–72 jam" : "Cekaman air · bulan depan"}</span>
                        <strong>{item.units} {item.resource_label}</strong>
                        <span>dari {item.from_depot} · {item.minutes} menit</span>
                      </div>
                      <div className="decision-probability">
                        <span>Peluang</span><b>{probability}%</b>
                        <i><em style={{ width: `${probability}%` }} /></i>
                      </div>
                      <div className="decision-resource-actions">
                        <button
                          type="button"
                          className={locked ? "locked" : ""}
                          onClick={() => onLock(item)}
                          disabled={readonly}
                          title={readonlyTitle}
                        >
                          {locked ? "✓ Dikunci" : "Kunci"}
                        </button>
                        <button
                          type="button"
                          className="redirect"
                          onClick={() => onReject(item)}
                          disabled={readonly}
                          title={readonlyTitle}
                        >
                          Alihkan
                        </button>
                      </div>
                    </section>
                  );
                })}
              </div>

              {group.items[0]?.reason && (
                <details className="decision-reason">
                  <summary>Mengapa diprioritaskan?</summary>
                  <p>{group.items[0].reason}</p>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function groupPlan(plan: PlanItem[]) {
  const groups = new Map<string, DecisionGroup>();
  for (const item of plan) {
    const current = groups.get(item.district_id);
    if (current) {
      current.items.push(item);
      current.exposure = Math.max(current.exposure, item.people_exposed);
    } else {
      groups.set(item.district_id, {
        districtId: item.district_id,
        district: item.district,
        kabupaten: item.kabupaten,
        exposure: item.people_exposed,
        items: [item],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.exposure - a.exposure);
}

function DecisionSkeleton() {
  return (
    <div className="decision-skeleton" aria-label="Mengoptimasi ulang rencana">
      <span /><span /><span />
    </div>
  );
}

function idNum(value: number) {
  return value.toLocaleString("id-ID");
}
