import { useEffect, useState } from "react";

import { getDecisions, sourcesOf, type AllocateResponse, type DecisionSummary, type PlanItem, type RiskDistrict } from "../api/client";
import { computeKpis, fmtCompact, fmtInt } from "../metrics";
import { ROB_WATCH } from "../hazard";
import { MONITORING_THRESHOLD } from "../thresholds";
import SourceSummary from "./SourceSummary";

/** Where operator overrides are read back as evidence. See
 *  backend/app/routers/decisions.py: the point is not that the model learns
 *  from them, but that the places people keep overruling can be compared with
 *  the places radar independently flags. */
interface Props {
  risk: Map<string, RiskDistrict>;
  result: AllocateResponse | null;
  date: string;
  locks: Set<string>;
  rejects: Set<string>;
  onSelect: (districtId: string) => void;
  onPublishOrder: () => void;
}

interface DistrictDecision {
  districtId: string;
  district: string;
  kabupaten: string;
  peopleExposed: number;
  items: PlanItem[];
}

interface ReportItem {
  tone: "critical" | "watch" | "stable" | "action";
  title: string;
  detail: string;
}

interface FollowUpItem {
  district: RiskDistrict;
  kind: "blind" | "radar" | "forecast";
  label: string;
  evidence: string;
  reason: string;
  travel: string;
}

const planKey = (item: PlanItem) => `${item.district_id}:${item.resource}`;

export default function Overview({ risk, result, date, locks, rejects, onSelect, onPublishOrder }: Props) {
  const [actionStep, setActionStep] = useState(0);
  const kpis = computeKpis(risk, result);
  const districts = [...risk.values()];
  const plan = result?.plan ?? [];
  const summary = result?.summary;
  const plannedIds = new Set(plan.map((item) => item.district_id));
  const monitored = districts
    .filter((district) => Math.max(district.flood_prob, district.drought_prob) >= MONITORING_THRESHOLD)
    .sort((a, b) => exposureOf(b) - exposureOf(a));
  const compound = monitored.filter(
    (district) => district.flood_prob >= MONITORING_THRESHOLD && district.drought_prob >= MONITORING_THRESHOLD,
  );
  const unservedMonitored = monitored.filter((district) => !plannedIds.has(district.district_id));
  const decisions = groupDecisions(plan).slice(0, 7);
  const disp = summary?.total_dispatched ?? { pompa: 0, truk_tangki: 0 };
  const fleet = summary?.total_fleet ?? { pompa: 0, truk_tangki: 0 };
  const expectedCovered = result?.comparison?.siaga.expected_covered ?? 0;
  const expectedDemand = result?.comparison?.siaga.expected_demand ?? 0;
  const expectedCoveragePct = formatCoveragePercent(expectedCovered, expectedDemand);
  const deltaProtected = Math.max(result?.comparison?.delta_protected ?? 0, 0);
  const monitoringCoveragePct = kpis.aboveMonitoring > 0
    ? Math.round((kpis.coveredMonitoring / kpis.aboveMonitoring) * 100)
    : 100;
  const followUps = buildFollowUps(districts, plannedIds, result);
  const followUpPreview = selectFollowUpPreview(followUps, 6);
  const actions = buildActions(unservedMonitored, rejects, compound.length, kpis.fleetPct, risk);
  const activeActionStep = Math.min(actionStep, Math.max(actions.length - 1, 0));
  const lockedInPlan = plan.filter((item) => locks.has(planKey(item))).length;
  const evaluation = evaluationContext(date);
  const dispatchedUnits = disp.pompa + disp.truk_tangki;
  const reviewState = !result || plan.length === 0
    ? "Belum ada rencana"
    : lockedInPlan === plan.length
      ? "Siap diterbitkan"
      : "Menunggu persetujuan";

  return (
    <main className="overview overview-briefing operation-report">
      <header className="command-report-head">
        <div className="command-report-title">
          <span className={`command-live-state ${result && plan.length > 0 ? "is-ready" : "is-pending"}`}>
            <i aria-hidden="true" />{reviewState}
          </span>
          <h1>Laporan Operasional</h1>
          <p>{formatDate(date)} · SIAGA-{date.replaceAll("-", "")} · Koridor pesisir utara Jawa</p>
        </div>
        <div className="report-header-actions">
          <span className="hindcast-badge">{evaluation.badge}</span>
          <button
            className="btn-order"
            onClick={onPublishOrder}
            disabled={!result || result.plan.length === 0}
            title="Susun perintah prapenempatan untuk dicetak atau disimpan sebagai PDF"
          >
            Tinjau &amp; terbitkan
          </button>
        </div>
      </header>

      <section className="command-brief" aria-labelledby="command-brief-title">
        <div className="command-brief-copy">
          <div className="command-brief-label">Ringkasan keputusan aktif</div>
          <h2 id="command-brief-title">
            {kpis.served > 0
              ? `${fmtInt(kpis.served)} kecamatan masuk rencana, sementara ${fmtInt(unservedMonitored.length)} prioritas pemantauan masih terbuka.`
              : "Belum ada kecamatan yang masuk rencana aktif."}
          </h2>
          <p>{situationSummary(kpis.aboveMonitoring, compound.length, kpis.served, kpis.proactiveAllocations)}</p>
        </div>
        <div className="command-brief-owner">
          <span>Otoritas keputusan</span>
          <strong>Pusdalops / BPBD</strong>
          <small>Validasi lapangan tetap wajib sebelum mobilisasi</small>
        </div>
        <div className="command-metric-rail" aria-label="Status rencana aktif">
          <CommandMetric label="Dalam rencana" value={fmtInt(kpis.served)} note={`${fmtInt(dispatchedUnits)} unit direkomendasikan`} tone="primary" />
          <CommandMetric label="Estimasi terlindungi" value={fmtCompact(expectedCovered)} note={`+${fmtCompact(deltaProtected)} vs terpisah`} tone="ready" />
          <CommandMetric label="Cakupan kebutuhan" value={expectedCoveragePct} note="estimasi kebutuhan tercakup" tone="warning" />
          <CommandMetric label="Perlu tindak lanjut" value={fmtInt(followUps.length)} note="siaga, radar, atau titik buta" tone="critical" />
        </div>
      </section>

      <nav className="command-jumpbar" aria-label="Bagian laporan">
        <a href="#rencana-aktif">Rencana aktif</a>
        <a href="#tindak-lanjut">Tindak lanjut <span>{fmtInt(followUps.length)}</span></a>
        <a href="#audit-operasi">Analisis &amp; audit</a>
      </nav>

      <div className="command-workspace">
        <section id="rencana-aktif" className="command-surface command-plan" aria-labelledby="command-plan-title">
          <header className="command-surface-head">
            <div>
              <h2 id="command-plan-title">Rencana prapenempatan</h2>
              <p>Setiap baris menunjukkan tujuan, sumber daya, depot penyumbang, dan status persetujuan.</p>
            </div>
            <span>{fmtInt(decisions.length)} tujuan utama</span>
          </header>
          <div className="report-allocation-table-wrap">
            <table className="report-allocation-table">
              <thead>
                <tr>
                  <th>Wilayah prioritas</th>
                  <th>Sumber daya</th>
                  <th>Asal & waktu tempuh</th>
                  <th>Estimasi paparan</th>
                  <th>Status</th>
                  <th><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((decision) => {
                  const lockedItems = decision.items.filter((item) => locks.has(planKey(item))).length;
                  return (
                    <tr key={decision.districtId}>
                      <td><strong>{decision.district}</strong><small>{decision.kabupaten}</small></td>
                      <td><div className="priority-resources">{decision.items.map((item) => <span className={`resource-chip ${item.resource === "pompa" ? "flood" : "drought"}`} key={item.resource}>{item.units} {item.resource_label}</span>)}</div></td>
                      <td><SourceSummary items={decision.items} /><small>{Math.min(...decision.items.flatMap((item) => sourcesOf(item).map((source) => source.minutes)))} menit tercepat</small></td>
                      <td><strong className="report-mono">{fmtInt(decision.peopleExposed)}</strong><small>jiwa</small></td>
                      <td><span className={`report-status ${lockedItems ? "locked" : "planned"}`}>{lockedItems ? `${lockedItems} dikunci` : "Rekomendasi"}</span></td>
                      <td><button type="button" className="priority-map-link" onClick={() => onSelect(decision.districtId)}>Lihat peta</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {decisions.length === 0 && <ReportEmpty text="Belum ada rekomendasi alokasi pada tanggal ini." />}
          </div>
        </section>

        <aside className="command-control-rail" aria-label="Kontrol validasi rencana">
          <section className="command-rail-section command-capacity">
            <div className="command-rail-head">
              <div><span>Kapasitas aktif</span><h2>{summary?.fleet_used_pct ?? 0}% armada digunakan</h2></div>
              <strong>{fmtInt(dispatchedUnits)}<small> unit</small></strong>
            </div>
            <ResourceBar label="Pompa banjir" used={disp.pompa} total={fleet.pompa} tone="flood" />
            <ResourceBar label="Truk tangki" used={disp.truk_tangki} total={fleet.truk_tangki} tone="drought" />
            <div className="command-validation-grid">
              <div><span>Dikunci</span><strong>{fmtInt(lockedInPlan)}</strong></div>
              <div><span>Dialihkan</span><strong>{fmtInt(rejects.size)}</strong></div>
              <div><span>Unit tersisa</span><strong>{fmtInt(Math.max(fleet.pompa + fleet.truk_tangki - dispatchedUnits, 0))}</strong></div>
            </div>
            <div className="command-gate">
              <span>Gerbang otorisasi</span>
              <strong>{reviewState}</strong>
              <p>Periksa kondisi jalan, kesiapan depot, regu, dan dukungan provinsi sebelum rencana menjadi perintah resmi.</p>
            </div>
          </section>

          <section className="command-rail-section command-next-actions">
            <header><h2>Yang perlu dilakukan sekarang</h2><span>{activeActionStep + 1} / {fmtInt(actions.length)}</span></header>
            <div className="handover-carousel" aria-live="polite">
              <HandoverItem item={actions[activeActionStep]} order={activeActionStep + 1} />
            </div>
            <div className="handover-carousel-controls" aria-label="Navigasi langkah tindakan">
              <button type="button" onClick={() => setActionStep((step) => Math.max(step - 1, 0))} disabled={activeActionStep === 0} aria-label="Langkah sebelumnya">←</button>
              <div aria-hidden="true">
                {actions.map((_, index) => <span className={index === activeActionStep ? "active" : ""} key={index} />)}
              </div>
              <button type="button" onClick={() => setActionStep((step) => Math.min(step + 1, actions.length - 1))} disabled={activeActionStep === actions.length - 1} aria-label="Langkah berikutnya">→</button>
            </div>
          </section>
        </aside>
      </div>

      <section id="tindak-lanjut" className="command-surface command-follow-up" aria-labelledby="follow-up-title">
        <header className="command-surface-head">
          <div>
            <h2 id="follow-up-title">Tindak lanjut operasional</h2>
            <p>Wilayah ini belum mengubah alokasi aktif, tetapi perlu diperiksa bila bukti atau kondisi lapangan berubah.</p>
          </div>
          <span>{fmtInt(followUps.length)} wilayah dalam antrean</span>
        </header>
          <div className="follow-up-summary">
            <p><strong>{fmtInt(unservedMonitored.length)} prioritas pemantauan</strong> belum masuk rencana.</p>
            <span>Cakupan pemantauan {monitoringCoveragePct}%</span>
          </div>
          <div className="follow-up-list">
            {followUpPreview.map((item) => (
              <button type="button" key={item.district.district_id} onClick={() => onSelect(item.district.district_id)}>
                <span className={`follow-up-kind ${item.kind}`}>{item.label}</span>
                <span className="follow-up-place">
                  <strong>{item.district.name}</strong>
                  <small>{item.district.kabupaten}</small>
                </span>
                <span className="follow-up-evidence">{item.evidence}</span>
                <span className="follow-up-reason">{item.reason}</span>
                <span className="follow-up-footer"><small>{item.travel}</small><b>Lihat peta →</b></span>
              </button>
            ))}
            {followUps.length === 0 && <ReportEmpty text="Tidak ada wilayah tambahan yang perlu masuk daftar siaga." />}
          </div>
      </section>

      <details id="audit-operasi" className="command-audit">
        <summary>
          <span><strong>Analisis &amp; jejak audit</strong><small>Kondisi bahaya, tahapan sistem, identitas, dan riwayat keputusan</small></span>
          <b>Buka detail</b>
        </summary>
        <div className="command-audit-body">
          <div className="command-audit-grid">
            <ReportSection index="hazard" title="Kondisi bahaya" className="report-hazards">
              <div className="hazard-summary-grid">
                <Metric label="Pemantauan banjir" value={fmtInt(kpis.floodMonitoring)} note="peluang ≥50%" tone="flood" />
                <Metric label="Pemantauan cekaman" value={fmtInt(kpis.droughtMonitoring)} note="peluang ≥50%" tone="drought" />
                <Metric label="Dua bahaya" value={fmtInt(compound.length)} note="ambang terlewati bersamaan" tone="compound" />
                <Metric label="Estimasi paparan" value={fmtCompact(kpis.exposed)} note="peluang × populasi" tone="neutral" />
              </div>
              <div className="report-subhead"><strong>Paparan tertinggi</strong><span>{monitored.length} melewati Ambang Pemantauan</span></div>
              <div className="hazard-watchlist">
                {monitored.slice(0, 5).map((district) => (
                  <button type="button" key={district.district_id} onClick={() => onSelect(district.district_id)}>
                    <span className="hazard-watch-place"><strong>{district.name}</strong><small>{district.kabupaten}</small></span>
                    <span className="hazard-prob flood">B {Math.round(district.flood_prob * 100)}%</span>
                    <span className="hazard-prob drought">C {Math.round(district.drought_prob * 100)}%</span>
                    <span className={`report-status ${plannedIds.has(district.district_id) ? "planned" : "open"}`}>{plannedIds.has(district.district_id) ? "Dalam rencana" : "Belum dipraposisikan"}</span>
                  </button>
                ))}
              </div>
            </ReportSection>

            <ReportSection index="timeline" title="Tahapan sesi aktif" className="report-timeline-panel">
              <p className="report-section-intro">Urutan proses sistem; bukan stempel waktu kejadian lapangan.</p>
              <ol className="operation-timeline">
                <TimelineItem phase="Tahap 01" title="Cuplikan risiko dimuat" detail={`${fmtInt(kpis.totalDistricts)} kecamatan dievaluasi untuk ${formatShortDate(date)}.`} state="complete" />
                <TimelineItem phase="Tahap 02" title="Bahaya melewati ambang" detail={`${fmtInt(kpis.aboveMonitoring)} wilayah ditandai untuk pemantauan visual.`} state={kpis.aboveMonitoring > 0 ? "attention" : "complete"} />
                <TimelineItem phase="Tahap 03" title="Rencana alokasi dibentuk" detail={`${fmtInt(kpis.served)} wilayah dipilih; ${fmtInt(dispatchedUnits)} unit direkomendasikan.`} state={result ? "complete" : "pending"} />
                <TimelineItem phase="Tahap 04" title="Intervensi operator dicatat" detail={locks.size || rejects.size ? `${fmtInt(locks.size)} keputusan dikunci dan ${fmtInt(rejects.size)} dialihkan.` : "Belum ada keputusan manual yang dikunci atau dialihkan."} state={locks.size || rejects.size ? "attention" : "pending"} />
              </ol>
            </ReportSection>
          </div>

          <ReportSection index="identity" title="Identitas operasi" className="operation-identity">
            <div className="operation-identity-grid">
              <IdentityField label="ID laporan" value={`SIAGA-${date.replaceAll("-", "")}`} />
              <IdentityField label="Tanggal analisis" value={formatShortDate(date)} />
              <IdentityField label="Wilayah operasi" value="Koridor pesisir utara Jawa" />
              <IdentityField label="Mode keputusan" value="Terpadu SIAGA" />
              <IdentityField label="Status pengoptimalan" value={summary?.status ?? "Menunggu hasil"} />
              <IdentityField label="Status data" value={evaluation.status} />
            </div>
          </ReportSection>

          <ContestedSection risk={risk} />
        </div>
      </details>

      <footer className="operation-report-footer">
        <span>Batas penggunaan</span>
        <p>Dampak adalah estimasi model, bukan bukti pengiriman atau jumlah korban terselamatkan. Validasi kondisi lapangan, kesiapan depot, regu, dan akses rute tetap diperlukan.</p>
      </footer>
    </main>
  );
}

function ReportSection({ index, title, className = "", children }: { index: string; title: string; className?: string; children: React.ReactNode }) {
  const id = `report-section-${index}`;
  return <section className={`report-section ${className}`} aria-labelledby={id}><ReportHeading index={index} title={title} id={id} />{children}</section>;
}

function ReportHeading({ index, title, id }: { index: string; title: string; id: string }) {
  void index;
  return <div className="report-section-heading"><h2 id={id}>{title}</h2></div>;
}

function IdentityField({ label, value }: { label: string; value: string }) {
  return <div className="identity-field"><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <div className={`report-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function CommandMetric({ label, value, note, tone }: { label: string; value: string; note: string; tone: "primary" | "ready" | "warning" | "critical" }) {
  return <div className={`command-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function TimelineItem({ phase, title, detail, state }: { phase: string; title: string; detail: string; state: "complete" | "attention" | "pending" }) {
  return <li className={state}><span className="timeline-node" aria-hidden="true" /><div><span>{phase}</span><strong>{title}</strong><p>{detail}</p></div></li>;
}

function HandoverItem({ item, order }: { item: ReportItem; order?: number }) {
  return <article className={`handover-item ${item.tone}`}>{order ? <span className="handover-order">{String(order).padStart(2, "0")}</span> : <span className="handover-indicator" aria-hidden="true" />}<div><strong>{item.title}</strong><p>{item.detail}</p></div></article>;
}

function ReportEmpty({ text }: { text: string }) {
  return <div className="report-empty">{text}</div>;
}

function ResourceBar({ label, used, total, tone }: { label: string; used: number; total: number; tone: "flood" | "drought" }) {
  const pct = total ? Math.min((used / total) * 100, 100) : 0;
  return <div className="briefing-resource"><div className="briefing-resource-head"><span>{label}</span><span><b>{used}</b> digunakan · {Math.max(total - used, 0)} tersedia</span></div><div className="briefing-resource-track" aria-label={`${label}, ${Math.round(pct)} persen digunakan`}><span className={`briefing-resource-fill ${tone}`} style={{ width: `${pct}%` }} /><i className="briefing-resource-limit" title="Batas perhatian 80%" /></div><div className="briefing-resource-scale"><span>0</span><span>{total} unit</span></div></div>;
}

function groupDecisions(plan: PlanItem[]): DistrictDecision[] {
  const groups = new Map<string, DistrictDecision>();
  for (const item of plan) {
    const current = groups.get(item.district_id);
    if (current) {
      current.items.push(item);
      current.peopleExposed = Math.max(current.peopleExposed, item.people_exposed);
    } else {
      groups.set(item.district_id, { districtId: item.district_id, district: item.district, kabupaten: item.kabupaten, peopleExposed: item.people_exposed, items: [item] });
    }
  }
  return [...groups.values()].sort((a, b) => b.peopleExposed - a.peopleExposed);
}

function buildFollowUps(
  districts: RiskDistrict[],
  plannedIds: Set<string>,
  result: AllocateResponse | null,
): FollowUpItem[] {
  const explanations = new Map((result?.unserved ?? []).map((item) => [item.district_id, item]));
  const rank = { blind: 0, radar: 1, forecast: 2 } as const;

  return districts
    .filter((district) => !plannedIds.has(district.district_id))
    .map((district): FollowUpItem | null => {
      const robAnomaly = district.rob?.anomaly;
      const radarElevated = robAnomaly !== null && robAnomaly !== undefined && robAnomaly >= ROB_WATCH;
      const forecastElevated = Math.max(district.flood_prob, district.drought_prob) >= MONITORING_THRESHOLD;
      const unserved = explanations.get(district.district_id);
      const travel = unserved?.nearest_depot_min === null
        ? "Di luar jangkauan depot aktif"
        : unserved?.nearest_depot_min !== undefined
          ? `Depot terdekat · ${Math.round(unserved.nearest_depot_min)} menit`
          : "Waktu tempuh perlu diperiksa";

      if (district.rob_blind_spot) {
        return {
          district,
          kind: "blind",
          label: "Titik buta model",
          evidence: `ROB +${formatPercentPoints(robAnomaly ?? 0)} pp · model banjir ${formatProbability(district.flood_prob)}`,
          reason: unserved?.text ?? "Radar melihat genangan ketika model sungai menyatakan tenang.",
          travel,
        };
      }
      if (radarElevated) {
        return {
          district,
          kind: "radar",
          label: "Eskalasi radar",
          evidence: `ROB +${formatPercentPoints(robAnomaly ?? 0)} pp · prakiraan ${formatProbability(Math.max(district.flood_prob, district.drought_prob))}`,
          reason: unserved?.text ?? (forecastElevated
            ? "Radar menguatkan kebutuhan pemeriksaan pada wilayah berprakiraan tinggi."
            : "Bukti radar meminta pemeriksaan meski prakiraan belum melewati ambang."),
          travel,
        };
      }
      if (forecastElevated) {
        const dominant = district.flood_prob >= district.drought_prob ? "Banjir" : "Cekaman";
        return {
          district,
          kind: "forecast",
          label: "Siaga prakiraan",
          evidence: `${dominant} ${formatProbability(Math.max(district.flood_prob, district.drought_prob))} · paparan ${fmtCompact(district.people_exposed)}`,
          reason: unserved?.text ?? "Belum terpilih pada rencana aktif; tinjau jika kondisi berubah.",
          travel,
        };
      }
      return null;
    })
    .filter((item): item is FollowUpItem => item !== null)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || exposureOf(b.district) - exposureOf(a.district));
}

function selectFollowUpPreview(items: FollowUpItem[], limit: number) {
  const selected = (["blind", "radar", "forecast"] as const)
    .flatMap((kind) => items.filter((item) => item.kind === kind).slice(0, 2));
  if (selected.length >= limit) return selected.slice(0, limit);
  const selectedIds = new Set(selected.map((item) => item.district.district_id));
  return [...selected, ...items.filter((item) => !selectedIds.has(item.district.district_id))].slice(0, limit);
}

function buildActions(unserved: RiskDistrict[], rejects: Set<string>, compound: number, fleetPct: number, risk: Map<string, RiskDistrict>): ReportItem[] {
  const actions: ReportItem[] = [];
  if (unserved.length > 0) actions.push({ tone: "action", title: "Tinjau wilayah dipantau yang belum terlayani", detail: `Konfirmasi kebutuhan lapangan di ${unserved.slice(0, 3).map((item) => item.name).join(", ")} sebelum penghitungan ulang.` });
  if (rejects.size > 0) actions.push({ tone: "action", title: "Konfirmasi rute dan tujuan pengalihan", detail: `Periksa akses alternatif untuk ${rejectedNames(rejects, risk).join(", ") || "keputusan yang dialihkan"}.` });
  if (compound > 0) actions.push({ tone: "action", title: "Koordinasikan respons dua bahaya", detail: `${fmtInt(compound)} wilayah membutuhkan pemantauan banjir dan cekaman air secara bersamaan.` });
  if (fleetPct >= 80) actions.push({ tone: "action", title: "Siapkan kapasitas cadangan", detail: "Koordinasikan depot pendukung dan ketersediaan regu sebelum menerima kebutuhan tambahan." });
  actions.push({ tone: "action", title: "Validasi rekomendasi sebelum mobilisasi", detail: "Cocokkan kondisi jalan, kesiapan armada, dan laporan petugas lapangan dengan rencana SIAGA." });
  return actions.slice(0, 4);
}

function rejectedNames(rejects: Set<string>, risk: Map<string, RiskDistrict>) {
  return [...new Set([...rejects].map((key) => risk.get(key.split(":")[0])?.name).filter((name): name is string => Boolean(name)))];
}

function exposureOf(district: RiskDistrict) {
  return district.people_exposed;
}

function situationSummary(monitored: number, compound: number, served: number, proactive: number) {
  if (monitored === 0) return served > 0 ? `Tidak ada wilayah yang melewati Ambang Pemantauan 50%. Sistem optimasi tetap memilih ${fmtInt(served)} wilayah berdasarkan Ambang Alokasi Kritis 5% dan kendala kapasitas.` : "Tidak ada wilayah yang melewati Ambang Pemantauan dan belum ada rekomendasi prapenempatan pada tanggal ini.";
  const compoundText = compound > 0 ? `${fmtInt(compound)} wilayah menghadapi dua bahaya` : "tidak ada wilayah yang melewati ambang untuk kedua bahaya";
  const proactiveText = proactive > 0 ? `, termasuk ${fmtInt(proactive)} alokasi preventif di bawah ambang visual 50%` : "";
  return `${fmtInt(monitored)} wilayah melewati Ambang Pemantauan 50%; ${compoundText}. Sistem optimasi memilih ${fmtInt(served)} wilayah${proactiveText}.`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatCoveragePercent(covered: number, demand: number) {
  if (demand <= 0 || covered <= 0) return "0%";
  const value = (covered / demand) * 100;
  if (value < 1) return "<1%";
  if (value < 10) return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  return `${Math.round(value)}%`;
}

function formatProbability(value: number) {
  const percentage = value * 100;
  return `${percentage < 10 ? percentage.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : Math.round(percentage)}%`;
}

function formatPercentPoints(value: number) {
  return (value * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function evaluationContext(date: string) {
  const outOfSample = Number(date.slice(0, 4)) >= 2023;
  return outOfSample
    ? { badge: "Demo ramalan · out-of-sample · bukan waktu nyata", status: "Evaluasi ramalan out-of-sample" }
    : { badge: "Stress test alokasi · in-sample · bukan waktu nyata", status: "Stress test alokasi in-sample" };
}

/** Kecamatan the operator overrules most, set against the kecamatan radar says
 *  the flood model is blind to. Agreement between the two is the finding: one
 *  is a person who knows the ground, the other is a satellite, and neither
 *  consulted the other. */
function ContestedSection({ risk }: { risk: Map<string, RiskDistrict> }) {
  const [summary, setSummary] = useState<DecisionSummary | null>(null);

  useEffect(() => {
    let live = true;
    getDecisions()
      .then((d) => { if (live) setSummary(d); })
      .catch(() => { /* logging is not load-bearing for this page */ });
    return () => { live = false; };
  }, []);

  if (!summary || summary.overrides === 0) return null;

  const blindNames = new Set(
    [...risk.values()].filter((d) => d.rob_blind_spot).map((d) => d.name),
  );
  const overlap = summary.contested.filter((c) => blindNames.has(c.district));

  return (
    <ReportSection index="history" title="Riwayat keputusan operator" className="report-contested">
      <p className="report-contested-lede">
        {fmtInt(summary.overrides)} penyesuaian tersimpan dari seluruh sesi dan
        demonstrasi, bukan hanya sesi aktif di atas. Wilayah yang sering
        dikunci atau dialihkan perlu ditinjau bersama operator lapangan.
      </p>
      <ul className="contested-list">
        {summary.contested.slice(0, 6).map((c) => (
          <li key={c.district} className={blindNames.has(c.district) ? "is-blind" : ""}>
            <b>{c.district}</b>
            <span>{c.count}×</span>
            {blindNames.has(c.district) && <em>juga titik buta radar</em>}
          </li>
        ))}
      </ul>
      {overlap.length > 0 && (
        <p className="report-contested-note">
          {overlap.length} dari {summary.contested.length} kecamatan terbanyak
          juga ditandai radar sebagai titik buta model banjir. Dua sumber yang
          tidak saling berhubungan menunjuk tempat yang sama.
        </p>
      )}
      <small className="report-contested-caveat">
        Catatan ini menjadi jejak audit dan tidak dipakai untuk melatih ulang model.
      </small>
    </ReportSection>
  );
}

