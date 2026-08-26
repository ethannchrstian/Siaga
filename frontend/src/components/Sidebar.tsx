import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { sourcesOf, type AllocateResponse, type PlanItem } from "../api/client";
import { useCountUp } from "../hooks/useCountUp";
import {
  AlertIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentIcon,
  FleetIcon,
  PeopleIcon,
  SearchIcon,
} from "../icons";
import SourceSummary from "./SourceSummary";

interface Props {
  result: AllocateResponse | null;
  loading: boolean;
  locks: Set<string>;
  rejects: Set<string>;
  onLock: (plan: PlanItem) => void;
  onReject: (plan: PlanItem) => void;
  onClearReject: (key: string) => void;
  onClearLocks: () => void;
  onSelect: (districtId: string) => void;
  labelFor: (key: string) => string;
  /** SIAGA recommendations remain visible while the map shows the baseline. */
  readonly?: boolean;
  /** Expected-covered change caused by the latest lock/reject decision. */
  coverageDelta?: number | null;
  diversionOutcome?: DiversionOutcome | null;
  onDismissDiversion?: () => void;
  crew?: { used: number; total: number };
  /** Kecamatan selected on the map; its card scrolls into view and flashes. */
  selectedId?: string | null;
  /** Reports the card under the cursor so the map can outline it. */
  onHover?: (districtId: string | null) => void;
  /** Publishing is the terminal action of this panel, so the button lives here
      rather than in a page header the screen no longer has. */
  onPublishOrder?: () => void;
  /** Hands the panel's width back to the map. */
  onCollapse?: () => void;
  /** Supply scope changes the plan, so its control belongs with the plan rather
      than floating over the hazard map. */
  supplyControl?: ReactNode;
}

export interface DiversionOutcome {
  targetDistrict: string;
  resourceLabel: string;
  removedUnits: number;
  destinations: { district: string; units: number }[];
  returnedUnits: number;
  coverageDelta: number;
  failed: boolean;
}

interface DecisionGroup {
  districtId: string;
  district: string;
  kabupaten: string;
  items: PlanItem[];
  exposure: number;
}

type DecisionFilter = "all" | "pending" | "compound" | "flood" | "drought" | "locked";

const key = (plan: PlanItem) => `${plan.district_id}:${plan.resource}`;

export default function Sidebar({
  result,
  loading,
  locks,
  rejects,
  onLock,
  onReject,
  onClearReject,
  onClearLocks,
  onSelect,
  labelFor,
  readonly = false,
  coverageDelta,
  diversionOutcome,
  onDismissDiversion,
  crew,
  selectedId,
  onHover,
  onPublishOrder,
  onCollapse,
  supplyControl,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [confirmingDiversion, setConfirmingDiversion] = useState<string | null>(null);
  // On a first visit the top card's evidence is open, so a new viewer sees
  // that a "why" exists at all. Returning users keep it collapsed.
  const [expandFirst] = useState(() => {
    try {
      if (localStorage.getItem("siaga_seen_evidence")) return false;
      localStorage.setItem("siaga_seen_evidence", "1");
      return true;
    } catch {
      return false;
    }
  });
  const summary = result?.summary;
  const covered = useCountUp(result?.comparison?.siaga.expected_covered ?? 0, 600);
  const groups = useMemo(() => groupPlan(result?.plan ?? []), [result]);
  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id");
    return groups.filter((group) => {
      const resources = new Set(group.items.map((item) => item.resource));
      const matchesFilter =
        filter === "all" ||
        (filter === "pending" && group.items.some((item) => !locks.has(key(item)))) ||
        (filter === "compound" && resources.size > 1) ||
        (filter === "flood" && resources.has("pompa")) ||
        (filter === "drought" && resources.has("truk_tangki")) ||
        (filter === "locked" && group.items.some((item) => locks.has(key(item))));
      const location = `${group.district} ${group.kabupaten}`.toLocaleLowerCase("id");
      return matchesFilter && (!normalized || location.includes(normalized));
    });
  }, [filter, groups, locks, query]);

  // Counted in kecamatan, not in rows, so the number on the chip is the number
  // of cards the chip reveals.
  const pendingCount = useMemo(
    () => groups.filter((group) => group.items.some((item) => !locks.has(key(item)))).length,
    [groups, locks],
  );

  const readonlyTitle = readonly
    ? "Kembali ke mode Terpadu untuk mengubah rencana"
    : undefined;

  // Clicking a kecamatan on the map should surface its card rather than leave
  // the operator scrolling a list of nine to find it.
  const selectedCardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    selectedCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <aside className="sidebar decision-sidebar">
      <div className="sidebar-head">
        <div className="sidebar-kicker">Rekomendasi keputusan</div>
        <div className="sidebar-title-row">
          <div className="sidebar-title">Rencana prapenempatan</div>
          <span className="plan-count">{groups.length}</span>
          {onCollapse && (
            <button
              type="button"
              className="plan-collapse-btn"
              onClick={onCollapse}
              title="Sembunyikan panel, perlebar peta"
              aria-label="Sembunyikan panel rencana"
            >
              <ChevronRightIcon size={16} />
            </button>
          )}
        </div>
        {/* Locks persist across a reload, so there has to be one obvious way
            back to the optimizer's own recommendation. */}
        {locks.size > 0 && !readonly && (
          <button type="button" className="clear-locks" onClick={onClearLocks}>
            {locks.size} keputusan dikunci · lepas semua
          </button>
        )}
        {summary && (
          <div className="decision-summary-line">
            <span><b>{summary.n_districts_served}</b><span>kecamatan</span></span>
            <span><b>{summary.total_dispatched.pompa + summary.total_dispatched.truk_tangki}</b><span>unit</span></span>
            <span><b>{summary.fleet_used_pct}%</b><span>armada</span></span>
          </div>
        )}
        {result?.comparison && (
          <div className="coverage-line">
            <span className="coverage-metric"><b>≈ {idNum(covered)}</b><span>jiwa terlindungi</span></span>
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
        {/* Teaches the interaction model at the point of use, then gets out of
            the way. Someone who has already decided does not need telling. */}
        {!readonly && locks.size === 0 && rejects.size === 0 && groups.length > 0 && (
          <p className="decision-hint">
            Kunci untuk menyetujui. Alihkan mengeluarkan alokasi terpilih lalu menghitung ulang.
          </p>
        )}
        {/* The plan has to be able to leave the browser: a depot crew acts on
            paper or a message, not on a tab someone has open. Full width and
            on its own row, because as a chip beside the title it was missed.
            Stays visible in Terpisah since the order always prints the SIAGA
            plan, and a button that vanishes on the toggle flickers mid-demo. */}
        {onPublishOrder && (
          <button
            type="button"
            className="btn-order sidebar-order"
            onClick={onPublishOrder}
            disabled={groups.length === 0}
            title="Susun perintah prapenempatan untuk dicetak atau disimpan sebagai PDF"
          >
            <DocumentIcon size={15} />
            <span>Terbitkan perintah</span>
          </button>
        )}
      </div>

      {supplyControl && (
        <div className="sidebar-supply-slot">
          {supplyControl}
        </div>
      )}

      {readonly && (
        <div className="sidebar-readonly-note">
          Peta menampilkan baseline Terpisah. Kembali ke Terpadu untuk mengubah rekomendasi SIAGA.
        </div>
      )}

      <div className="decision-scroll-region">
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
            ["pending", "Menunggu"],
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
              title={value === "pending" ? "Kecamatan yang belum diputuskan operator" : undefined}
            >
              {label}
              {value === "pending" && pendingCount > 0 && (
                <span className="filter-count">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
        </div>

        {rejects.size > 0 && (
          <div className="rejected-bar">
            <span className="rejected-label">Dikeluarkan dari rencana · klik untuk batalkan</span>
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

        {diversionOutcome && (
          <div className={`diversion-outcome${diversionOutcome.failed ? " failed" : ""}`} role="status">
            <header>
              <strong>{diversionOutcome.failed ? "Pengalihan belum diterapkan" : "Rencana diperbarui"}</strong>
              {onDismissDiversion && <button type="button" onClick={onDismissDiversion} aria-label="Tutup hasil pengalihan">×</button>}
            </header>
            <p><b>{diversionOutcome.removedUnits} {diversionOutcome.resourceLabel}</b> ke {diversionOutcome.targetDistrict} {diversionOutcome.failed ? "masih berada dalam rencana." : "dikeluarkan dari rencana."}</p>
            {!diversionOutcome.failed && diversionOutcome.destinations.length > 0 && (
              <ul>
                {diversionOutcome.destinations.map((destination) => (
                  <li key={destination.district}>{destination.units} unit → {destination.district}</li>
                ))}
              </ul>
            )}
            {!diversionOutcome.failed && diversionOutcome.returnedUnits > 0 && <small>{diversionOutcome.returnedUnits} unit kembali tersedia.</small>}
            {!diversionOutcome.failed && (
              <footer>Estimasi cakupan {diversionOutcome.coverageDelta === 0 ? "tidak berubah" : `${diversionOutcome.coverageDelta > 0 ? "+" : "−"}${idNum(Math.abs(diversionOutcome.coverageDelta))} jiwa`}.</footer>
            )}
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
              className={`decision-card${isCompound ? " compound" : ""}${selectedId === group.districtId ? " is-selected" : ""}`}
              key={group.districtId}
              ref={selectedId === group.districtId ? selectedCardRef : undefined}
              style={{ "--i": index } as CSSProperties}
              onMouseEnter={() => onHover?.(group.districtId)}
              onMouseLeave={() => onHover?.(null)}
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
                        <span className="decision-travel-time" title={sourcesOf(item).map((source) => `${source.depot}: ${source.minutes} menit`).join(" · ")}>
                          <ClockIcon size={12} /> {Math.min(...sourcesOf(item).map((source) => source.minutes))}–{Math.max(...sourcesOf(item).map((source) => source.minutes))} mnt
                        </span>
                        <strong>{item.units} {item.resource_label}</strong>
                        <SourceSummary item={item} className="decision-depot" />
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
                          onClick={() => setConfirmingDiversion((current) => current === itemKey ? null : itemKey)}
                          disabled={readonly}
                          title={readonlyTitle ?? `Keluarkan ${item.units} ${item.resource_label} ke ${item.district} lalu hitung ulang`}
                        >
                          Alihkan
                        </button>
                      </div>
                      {confirmingDiversion === itemKey && (
                        <div className="redirect-confirm" role="dialog" aria-label={`Konfirmasi pengalihan ${item.resource_label} ke ${item.district}`}>
                          <p><strong>Keluarkan {item.units} {item.resource_label} ke {item.district}?</strong><span>SIAGA akan mempertahankan keputusan lain dan menghitung ulang sisa rencana.</span></p>
                          <div>
                            <button type="button" onClick={() => setConfirmingDiversion(null)}>Batal</button>
                            <button type="button" className="confirm" onClick={() => { setConfirmingDiversion(null); onReject(item); }}>Hitung ulang</button>
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>

              {group.items[0] && (
                // The backend `reason` string is a prose serialisation of
                // fields we already hold. Rendering it as a paragraph makes
                // four facts unreadable; render the fields as evidence and
                // keep the sentence only as the tooltip.
                <details className="decision-reason" open={index === 0 && expandFirst}>
                  <summary>Mengapa diprioritaskan?</summary>
                  <div className="evidence-grid" title={group.items[0].reason}>
                    <div className="evidence-cell">
                      <span className="evidence-icon hazard" aria-hidden="true"><AlertIcon size={13} /></span>
                      <div>
                        <small>Peluang bahaya</small>
                        <b>{Math.round(group.items[0].hazard_prob * 100)}%</b>
                        <em>{group.items[0].resource === "pompa" ? "banjir 0–72 jam" : "cekaman air bulan depan"}</em>
                      </div>
                    </div>
                    <div className="evidence-cell">
                      <span className="evidence-icon people" aria-hidden="true"><PeopleIcon size={13} /></span>
                      <div>
                        <small>Jiwa terpapar</small>
                        <b>{idNum(group.exposure)}</b>
                        <em>peluang × populasi</em>
                      </div>
                    </div>
                    <div className="evidence-cell">
                      <span className="evidence-icon travel" aria-hidden="true"><ClockIcon size={13} /></span>
                      <div>
                        <small>Waktu tempuh</small>
                        <b>{Math.min(...sourcesOf(group.items[0]).map((source) => source.minutes))}–{Math.max(...sourcesOf(group.items[0]).map((source) => source.minutes))} menit</b>
                        <em>{sourcesOf(group.items[0]).length} depot sumber</em>
                      </div>
                    </div>
                    <div className="evidence-cell">
                      <span className="evidence-icon fleet" aria-hidden="true"><FleetIcon size={13} /></span>
                      <div>
                        <small>Dikirim</small>
                        <b>{group.items.reduce((sum, i) => sum + i.units, 0)} unit</b>
                        <em>{group.items.map((i) => i.resource_label).join(" + ")}</em>
                      </div>
                    </div>
                  </div>
                </details>
              )}
            </article>
            );
          })}
        </div>
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
