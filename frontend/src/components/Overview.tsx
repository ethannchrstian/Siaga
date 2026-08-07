import type { AllocateResponse, PlanItem, RiskDistrict } from "../api/client";
import { computeKpis, fmtCompact, fmtInt } from "../metrics";
import { MONITORING_THRESHOLD } from "../thresholds";

interface Props {
  risk: Map<string, RiskDistrict>;
  result: AllocateResponse | null;
  date: string;
  locks: Set<string>;
  rejects: Set<string>;
  onSelect: (districtId: string) => void;
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

const planKey = (item: PlanItem) => `${item.district_id}:${item.resource}`;

export default function Overview({ risk, result, date, locks, rejects, onSelect }: Props) {
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
  const activeUnserved = Math.max((summary?.n_active_districts ?? 0) - (summary?.n_districts_served ?? 0), 0);
  const decisions = groupDecisions(plan).slice(0, 7);
  const disp = summary?.total_dispatched ?? { pompa: 0, truk_tangki: 0 };
  const fleet = summary?.total_fleet ?? { pompa: 0, truk_tangki: 0 };
  const expectedCovered = result?.comparison?.siaga.expected_covered ?? 0;
  const expectedDemand = result?.comparison?.siaga.expected_demand ?? 0;
  const expectedCoveragePct = expectedDemand > 0 ? Math.round((expectedCovered / expectedDemand) * 100) : 0;
  const deltaProtected = Math.max(result?.comparison?.delta_protected ?? 0, 0);
  const monitoringCoveragePct = kpis.aboveMonitoring > 0
    ? Math.round((kpis.coveredMonitoring / kpis.aboveMonitoring) * 100)
    : 100;
  const issues = buildIssues(unservedMonitored, activeUnserved, rejects, kpis.fleetPct, risk);
  const actions = buildActions(unservedMonitored, rejects, compound.length, kpis.fleetPct, risk);
  const lockedInPlan = plan.filter((item) => locks.has(planKey(item))).length;

  return (
    <main className="overview overview-briefing operation-report">
      <header className="briefing-page-head">
        <div>
          <div className="briefing-page-kicker">
            <span className="briefing-page-dot" /> Ringkasan hasil operasi
          </div>
          <h1>Laporan Operasional</h1>
          <p className="briefing-page-date">Rekap pelaksanaan · {formatDate(date)}</p>
        </div>
        <span className="hindcast-badge">Simulasi historis · bukan kondisi waktu nyata</span>
      </header>

      <ReportSection index="01" title="Identitas operasi" className="operation-identity">
        <div className="operation-identity-grid">
          <IdentityField label="ID laporan" value={`SIAGA-${date.replaceAll("-", "")}`} />
          <IdentityField label="Tanggal analisis" value={formatShortDate(date)} />
          <IdentityField label="Wilayah operasi" value="Koridor pesisir utara Jawa" />
          <IdentityField label="Mode keputusan" value="Terpadu SIAGA" />
          <IdentityField label="Status pengoptimalan" value={summary?.status ?? "Menunggu hasil"} />
          <IdentityField label="Status data" value="Simulasi historis operasional" />
        </div>
      </ReportSection>

      <section className="report-executive" aria-labelledby="executive-summary-title">
        <ReportHeading index="02" title="Ringkasan eksekutif" id="executive-summary-title" inverse />
        <div className="report-executive-body">
          <p>{situationSummary(kpis.aboveMonitoring, compound.length, kpis.served, kpis.proactiveAllocations)}</p>
          <div className="report-executive-metrics">
            <span><b>{fmtInt(kpis.aboveMonitoring)}</b> wilayah dipantau</span>
            <span><b>{fmtInt(kpis.served)}</b> wilayah dalam rencana</span>
            <span><b>{fmtCompact(expectedCovered)}</b> estimasi terlindungi</span>
          </div>
        </div>
      </section>

      <div className="report-two-column report-hazard-timeline-grid">
        <ReportSection index="03" title="Kondisi bahaya" className="report-hazards">
          <div className="hazard-summary-grid">
            <Metric label="Pemantauan banjir" value={fmtInt(kpis.floodMonitoring)} note="peluang ≥50%" tone="flood" />
            <Metric label="Pemantauan cekaman" value={fmtInt(kpis.droughtMonitoring)} note="peluang ≥50%" tone="drought" />
            <Metric label="Dua bahaya" value={fmtInt(compound.length)} note="ambang terlewati bersamaan" tone="compound" />
            <Metric label="Estimasi paparan" value={fmtCompact(kpis.exposed)} note="peluang × populasi" tone="neutral" />
          </div>
          <div className="report-subhead">
            <strong>Wilayah dengan paparan tertinggi</strong>
            <span>{monitored.length} melewati Ambang Pemantauan</span>
          </div>
          <div className="hazard-watchlist">
            {monitored.slice(0, 5).map((district) => (
              <button type="button" key={district.district_id} onClick={() => onSelect(district.district_id)}>
                <span className="hazard-watch-place"><strong>{district.name}</strong><small>{district.kabupaten}</small></span>
                <span className="hazard-prob flood">B {Math.round(district.flood_prob * 100)}%</span>
                <span className="hazard-prob drought">C {Math.round(district.drought_prob * 100)}%</span>
                <span className={`report-status ${plannedIds.has(district.district_id) ? "planned" : "open"}`}>
                  {plannedIds.has(district.district_id) ? "Dalam rencana" : "Di luar kapasitas"}
                </span>
              </button>
            ))}
            {monitored.length === 0 && <ReportEmpty text="Tidak ada wilayah yang melewati Ambang Pemantauan 50%." />}
          </div>
        </ReportSection>

        <ReportSection index="04" title="Linimasa kejadian" className="report-timeline-panel">
          <p className="report-section-intro">Urutan tahapan pada sesi aktif; bukan stempel waktu kejadian lapangan.</p>
          <ol className="operation-timeline">
            <TimelineItem phase="Tahap 01" title="Cuplikan risiko dimuat" detail={`${fmtInt(kpis.totalDistricts)} kecamatan dievaluasi untuk ${formatShortDate(date)}.`} state="complete" />
            <TimelineItem phase="Tahap 02" title="Bahaya melewati ambang" detail={`${fmtInt(kpis.aboveMonitoring)} wilayah ditandai untuk pemantauan visual.`} state={kpis.aboveMonitoring > 0 ? "attention" : "complete"} />
            <TimelineItem phase="Tahap 03" title="Rencana alokasi dibentuk" detail={`${fmtInt(kpis.served)} wilayah dipilih; ${fmtInt(disp.pompa + disp.truk_tangki)} unit direkomendasikan.`} state={result ? "complete" : "pending"} />
            <TimelineItem phase="Tahap 04" title="Intervensi operator dicatat" detail={locks.size || rejects.size ? `${fmtInt(locks.size)} keputusan dikunci dan ${fmtInt(rejects.size)} dialihkan.` : "Belum ada keputusan manual yang dikunci atau dialihkan."} state={locks.size || rejects.size ? "attention" : "pending"} />
          </ol>
        </ReportSection>
      </div>

      <ReportSection index="05" title="Keputusan & alokasi sumber daya" className="report-decisions">
        <div className="report-decision-layout">
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
                  const lead = decision.items[0];
                  return (
                    <tr key={decision.districtId}>
                      <td><strong>{decision.district}</strong><small>{decision.kabupaten}</small></td>
                      <td><div className="priority-resources">{decision.items.map((item) => <span className={`resource-chip ${item.resource === "pompa" ? "flood" : "drought"}`} key={item.resource}>{item.units} {item.resource_label}</span>)}</div></td>
                      <td><strong>{lead.from_depot}</strong><small>{Math.min(...decision.items.map((item) => item.minutes))} menit</small></td>
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

          <aside className="report-resource-summary" aria-label="Ringkasan sumber daya">
            <div className="report-subhead"><strong>Kapasitas armada</strong><span>{summary?.fleet_used_pct ?? 0}% digunakan</span></div>
            <ResourceBar label="Pompa banjir" used={disp.pompa} total={fleet.pompa} tone="flood" />
            <ResourceBar label="Truk tangki" used={disp.truk_tangki} total={fleet.truk_tangki} tone="drought" />
            <div className="resource-decision-note">
              <strong>{fmtInt(lockedInPlan)} alokasi aktif dikunci</strong>
              <span>{fmtInt(rejects.size)} keputusan dialihkan dan menunggu konfirmasi hasil lapangan.</span>
            </div>
          </aside>
        </div>
      </ReportSection>

      <ReportSection index="06" title="Dampak operasi" className="report-impact">
        <div className="impact-grid">
          <ImpactMetric label="Estimasi jiwa terlindungi" value={fmtInt(expectedCovered)} note="hasil ekspektasi skenario SIAGA" />
          <ImpactMetric label="Keunggulan koordinasi" value={`+${fmtInt(deltaProtected)}`} note="dibanding penanganan terpisah" />
          <ImpactMetric label="Cakupan kebutuhan" value={`${expectedCoveragePct}%`} note="estimasi kebutuhan yang tercakup" />
          <ImpactMetric label="Cakupan pemantauan" value={`${monitoringCoveragePct}%`} note={`${kpis.coveredMonitoring}/${kpis.aboveMonitoring || 0} wilayah dipantau masuk rencana`} />
        </div>
        <p className="impact-disclaimer">Dampak merupakan estimasi model, bukan jumlah korban terselamatkan atau bukti pengiriman aktual.</p>
      </ReportSection>

      <div className="report-two-column report-handover-grid">
        <ReportSection index="07" title="Masalah yang belum selesai" className="report-issues">
          <div className="handover-list">
            {issues.map((issue, index) => <HandoverItem item={issue} key={`${issue.title}-${index}`} />)}
          </div>
        </ReportSection>

        <ReportSection index="08" title="Langkah berikutnya yang disarankan" className="report-actions">
          <div className="handover-list">
            {actions.map((action, index) => <HandoverItem item={action} order={index + 1} key={`${action.title}-${index}`} />)}
          </div>
        </ReportSection>
      </div>

      <footer className="operation-report-footer">
        <span>Catatan tindak lanjut</span>
        <p>Validasi kondisi lapangan, kesiapan depot, dan akses rute tetap diperlukan sebelum mobilisasi aktual.</p>
      </footer>
    </main>
  );
}

function ReportSection({ index, title, className = "", children }: { index: string; title: string; className?: string; children: React.ReactNode }) {
  const id = `report-section-${index}`;
  return <section className={`report-section ${className}`} aria-labelledby={id}><ReportHeading index={index} title={title} id={id} />{children}</section>;
}

function ReportHeading({ index, title, id, inverse = false }: { index: string; title: string; id: string; inverse?: boolean }) {
  return <div className={`report-section-heading${inverse ? " inverse" : ""}`}><span>{index}</span><h2 id={id}>{title}</h2></div>;
}

function IdentityField({ label, value }: { label: string; value: string }) {
  return <div className="identity-field"><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <div className={`report-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function TimelineItem({ phase, title, detail, state }: { phase: string; title: string; detail: string; state: "complete" | "attention" | "pending" }) {
  return <li className={state}><span className="timeline-node" aria-hidden="true" /><div><span>{phase}</span><strong>{title}</strong><p>{detail}</p></div></li>;
}

function ImpactMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="impact-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
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

function buildIssues(unserved: RiskDistrict[], activeUnserved: number, rejects: Set<string>, fleetPct: number, risk: Map<string, RiskDistrict>): ReportItem[] {
  const issues: ReportItem[] = [];
  if (unserved.length > 0) issues.push({ tone: "critical", title: `${fmtInt(unserved.length)} wilayah dipantau belum masuk rencana`, detail: `Prioritas awal: ${unserved.slice(0, 3).map((item) => item.name).join(", ")}.` });
  if (activeUnserved > 0) issues.push({ tone: "watch", title: `${fmtInt(activeUnserved)} kandidat pengoptimalan belum dilayani`, detail: "Kebutuhan melewati ambang 5%, tetapi belum terpilih karena kapasitas, paparan, atau waktu tempuh." });
  if (rejects.size > 0) issues.push({ tone: "watch", title: `${fmtInt(rejects.size)} pengalihan membutuhkan konfirmasi`, detail: `Wilayah terkait: ${rejectedNames(rejects, risk).join(", ") || "lihat daftar keputusan dialihkan"}.` });
  if (fleetPct >= 80) issues.push({ tone: "critical", title: "Kapasitas armada mendekati batas perhatian", detail: `${fleetPct}% armada telah digunakan; ruang untuk respons tambahan terbatas.` });
  if (issues.length === 0) issues.push({ tone: "stable", title: "Tidak ada masalah kritis yang teridentifikasi", detail: "Rencana tetap memerlukan validasi akses rute, kesiapan regu, dan kondisi lapangan." });
  return issues;
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
