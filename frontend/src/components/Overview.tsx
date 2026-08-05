import type { AllocateResponse, PlanItem, RiskDistrict } from "../api/client";
import { computeKpis, fmtCompact, fmtInt } from "../metrics";
import { MONITORING_THRESHOLD } from "../thresholds";

interface Props {
  risk: Map<string, RiskDistrict>;
  result: AllocateResponse | null;
  date: string;
  onSelect: (districtId: string) => void;
}

interface DistrictDecision {
  districtId: string;
  district: string;
  kabupaten: string;
  peopleExposed: number;
  items: PlanItem[];
}

export default function Overview({ risk, result, date, onSelect }: Props) {
  const kpis = computeKpis(risk, result);
  const districts = [...risk.values()];
  const plannedIds = new Set((result?.plan ?? []).map((item) => item.district_id));
  const compound = districts.filter(
    (district) => district.flood_prob >= MONITORING_THRESHOLD && district.drought_prob >= MONITORING_THRESHOLD,
  ).length;
  const decisions = groupDecisions(result?.plan ?? []).slice(0, 5);
  const disp = result?.summary.total_dispatched ?? { pompa: 0, truk_tangki: 0 };
  const fleet = result?.summary.total_fleet ?? { pompa: 0, truk_tangki: 0 };

  return (
    <main className="overview overview-briefing">
      <header className="briefing-page-head">
        <div>
          <div className="briefing-page-kicker">
            <span className="briefing-page-dot" /> Briefing pergantian shift
          </div>
          <h1>Ringkasan operasi</h1>
          <p className="briefing-page-date">{formatDate(date)} · mode hindcast operasional</p>
        </div>
        <span className="hindcast-badge">Bukan kondisi real-time</span>
      </header>

      <section className="situation-thesis" aria-label="Kesimpulan situasi">
        <div className="situation-thesis-label">Kesimpulan situasi</div>
        <p>{situationSummary(kpis.aboveMonitoring, compound, kpis.served, kpis.proactiveAllocations)}</p>
        <div className="situation-thesis-meta">
          <span><b>{fmtInt(compound)}</b> dua bahaya dipantau</span>
          <span><b>{fmtInt(kpis.served)}</b> dipilih optimizer</span>
          <span><b>{fmtInt(kpis.proactiveAllocations)}</b> alokasi preventif</span>
        </div>
      </section>

      <section className="briefing-primary-grid">
        <HazardQuadrant districts={districts} plannedIds={plannedIds} />

        <section className="briefing-panel decision-panel">
          <div className="briefing-panel-head">
            <div>
              <span className="briefing-panel-kicker">Jejak keputusan</span>
              <h2>Dari bahaya menuju alokasi</h2>
            </div>
          </div>
          <div className="decision-trail">
            <TrailStep
              label="Ambang Pemantauan"
              value={fmtInt(kpis.aboveMonitoring)}
              note="peluang ≥50% · visualisasi"
              tone="risk"
            />
            <TrailStep
              label="Estimasi paparan"
              value={fmtCompact(kpis.exposed)}
              note="peluang bahaya × populasi"
              tone="exposure"
            />
            <TrailStep
              label="Dipilih optimizer"
              value={fmtInt(kpis.served)}
              note="mulai peluang 5% + kendala kapasitas"
              tone="planned"
            />
            <TrailStep
              label="Alokasi preventif"
              value={fmtInt(kpis.proactiveAllocations)}
              note="dipilih meski di bawah pemantauan 50%"
              tone="planned"
              last
            />
          </div>
          <p className="briefing-method-note">
            Ambang Pemantauan 50% hanya mengatur tampilan peringatan. Ambang Alokasi
            Kritis 5% menentukan kelayakan optimizer; masuk rencana bukan berarti pengiriman selesai.
          </p>
        </section>
      </section>

      <section className="briefing-secondary-grid">
        <section className="briefing-panel priorities-panel">
          <div className="briefing-panel-head">
            <div>
              <span className="briefing-panel-kicker">Keputusan utama</span>
              <h2>Alokasi dengan paparan terbesar</h2>
            </div>
            <span className="briefing-panel-count">{result?.plan.length ?? 0} alokasi</span>
          </div>

          <div className="priority-list">
            {decisions.map((decision, index) => (
              <article className="priority-row" key={decision.districtId}>
                <span className="priority-rank">{String(index + 1).padStart(2, "0")}</span>
                <div className="priority-place">
                  <strong>{decision.district}</strong>
                  <span>{decision.kabupaten}</span>
                </div>
                <div className="priority-resources">
                  {decision.items.map((item) => (
                    <span
                      className={`resource-chip ${item.resource === "pompa" ? "flood" : "drought"}`}
                      key={item.resource}
                    >
                      {item.units} {item.resource_label}
                    </span>
                  ))}
                </div>
                <div className="priority-exposure">
                  <span>Estimasi paparan</span>
                  <b>{fmtInt(decision.peopleExposed)} jiwa</b>
                </div>
                <button type="button" className="priority-map-link" onClick={() => onSelect(decision.districtId)}>
                  Lihat di peta
                </button>
              </article>
            ))}
            {decisions.length === 0 && (
              <div className="briefing-empty">
                Tidak ada kebutuhan prapenempatan pada tanggal ini. Pilih tanggal lain
                untuk melihat keputusan operasi.
              </div>
            )}
          </div>
        </section>

        <section className="briefing-panel fleet-briefing-panel">
          <div className="briefing-panel-head">
            <div>
              <span className="briefing-panel-kicker">Kapasitas bersama</span>
              <h2>Pemakaian armada</h2>
            </div>
          </div>
          <ResourceBar label="Pompa banjir" used={disp.pompa} total={fleet.pompa} tone="flood" />
          <ResourceBar
            label="Truk tangki air"
            used={disp.truk_tangki}
            total={fleet.truk_tangki}
            tone="drought"
          />
          <div className="fleet-briefing-callout">
            <strong>{result?.summary.fleet_used_pct ?? 0}% armada digunakan</strong>
            <span>
              Pompa dan truk berbagi kapasitas regu, sehingga keputusan untuk satu bahaya
              dapat membatasi respons terhadap bahaya lainnya.
            </span>
          </div>
        </section>
      </section>
    </main>
  );
}

function HazardQuadrant({
  districts,
  plannedIds,
}: {
  districts: RiskDistrict[];
  plannedIds: Set<string>;
}) {
  const width = 560;
  const height = 320;
  const plot = { left: 56, top: 20, width: 482, height: 246 };
  const maxPopulation = Math.max(...districts.map((district) => district.population), 1);

  return (
    <section className="briefing-panel quadrant-panel">
      <div className="briefing-panel-head">
        <div>
          <span className="briefing-panel-kicker">Peta posisi risiko</span>
          <h2>Kuadran dua bahaya</h2>
        </div>
        <div className="quadrant-legend" aria-label="Legenda kuadran">
          <span><i className="legend-dot flood" /> Banjir</span>
          <span><i className="legend-dot drought" /> Cekaman air</span>
          <span><i className="legend-dot compound" /> Majemuk</span>
        </div>
      </div>
      <p className="briefing-panel-intro">
        Setiap titik adalah kecamatan. Ukuran menunjukkan populasi; lingkar luar menandai
        wilayah yang sudah masuk rencana alokasi.
      </p>
      <div className="quadrant-chart-wrap">
        <svg className="quadrant-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="quadrant-title quadrant-desc">
          <title id="quadrant-title">Kuadran peluang banjir dan cekaman air</title>
          <desc id="quadrant-desc">Kecamatan di kanan atas melewati Ambang Pemantauan 50% untuk kedua bahaya.</desc>

          <rect x={plot.left} y={plot.top} width={plot.width / 2} height={plot.height / 2} className="quadrant-zone drought-zone" />
          <rect x={plot.left + plot.width / 2} y={plot.top} width={plot.width / 2} height={plot.height / 2} className="quadrant-zone compound-zone" />
          <rect x={plot.left} y={plot.top + plot.height / 2} width={plot.width / 2} height={plot.height / 2} className="quadrant-zone low-zone" />
          <rect x={plot.left + plot.width / 2} y={plot.top + plot.height / 2} width={plot.width / 2} height={plot.height / 2} className="quadrant-zone flood-zone" />

          <line x1={plot.left + plot.width / 2} x2={plot.left + plot.width / 2} y1={plot.top} y2={plot.top + plot.height} className="quadrant-threshold" />
          <line x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height / 2} y2={plot.top + plot.height / 2} className="quadrant-threshold" />
          <line x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} className="quadrant-axis" />
          <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + plot.height} className="quadrant-axis" />

          <text x={plot.left + 9} y={plot.top + 18} className="quadrant-zone-label">PEMANTAUAN CEKAMAN</text>
          <text x={plot.left + plot.width - 9} y={plot.top + 18} textAnchor="end" className="quadrant-zone-label compound">DUA BAHAYA DIPANTAU</text>
          <text x={plot.left + plot.width - 9} y={plot.top + plot.height - 10} textAnchor="end" className="quadrant-zone-label">PEMANTAUAN BANJIR</text>

          {districts.map((district) => {
            const compound = district.flood_prob >= MONITORING_THRESHOLD && district.drought_prob >= MONITORING_THRESHOLD;
            const dominant = compound
              ? "compound"
              : district.flood_prob >= district.drought_prob
                ? "flood"
                : "drought";
            const radius = 1.6 + Math.sqrt(district.population / maxPopulation) * 4.4;
            const x = plot.left + district.flood_prob * plot.width;
            const y = plot.top + (1 - district.drought_prob) * plot.height;
            return (
              <circle
                key={district.district_id}
                cx={x}
                cy={y}
                r={radius}
                className={`district-dot ${dominant}${plannedIds.has(district.district_id) ? " planned" : ""}`}
              >
                <title>{`${district.name} · Banjir ${Math.round(district.flood_prob * 100)}% · Cekaman air ${Math.round(district.drought_prob * 100)}%`}</title>
              </circle>
            );
          })}

          <text x={plot.left} y={plot.top + plot.height + 20} className="quadrant-tick">0%</text>
          <text x={plot.left + plot.width / 2} y={plot.top + plot.height + 20} textAnchor="middle" className="quadrant-tick">50%</text>
          <text x={plot.left + plot.width} y={plot.top + plot.height + 20} textAnchor="end" className="quadrant-tick">100%</text>
          <text x={plot.left + plot.width / 2} y={height - 7} textAnchor="middle" className="quadrant-axis-label">Peluang banjir · 0–72 jam</text>
          <text x="15" y={plot.top + plot.height / 2} textAnchor="middle" transform={`rotate(-90 15 ${plot.top + plot.height / 2})`} className="quadrant-axis-label">Peluang cekaman air · bulan depan</text>
        </svg>
      </div>
    </section>
  );
}

function TrailStep({
  label,
  value,
  note,
  tone,
  last = false,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  last?: boolean;
}) {
  return (
    <div className={`trail-step trail-${tone}`}>
      <span className="trail-marker" aria-hidden="true" />
      <div>
        <span className="trail-label">{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
      {!last && <span className="trail-line" aria-hidden="true" />}
    </div>
  );
}

function ResourceBar({
  label,
  used,
  total,
  tone,
}: {
  label: string;
  used: number;
  total: number;
  tone: "flood" | "drought";
}) {
  const pct = total ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="briefing-resource">
      <div className="briefing-resource-head">
        <span>{label}</span>
        <span><b>{used}</b> digunakan · {Math.max(total - used, 0)} tersedia</span>
      </div>
      <div className="briefing-resource-track" aria-label={`${label}, ${Math.round(pct)} persen digunakan`}>
        <span className={`briefing-resource-fill ${tone}`} style={{ width: `${pct}%` }} />
        <i className="briefing-resource-limit" title="Batas perhatian 80%" />
      </div>
      <div className="briefing-resource-scale"><span>0</span><span>{total} unit</span></div>
    </div>
  );
}

function groupDecisions(plan: PlanItem[]): DistrictDecision[] {
  const groups = new Map<string, DistrictDecision>();
  for (const item of plan) {
    const current = groups.get(item.district_id);
    if (current) {
      current.items.push(item);
      current.peopleExposed = Math.max(current.peopleExposed, item.people_exposed);
    } else {
      groups.set(item.district_id, {
        districtId: item.district_id,
        district: item.district,
        kabupaten: item.kabupaten,
        peopleExposed: item.people_exposed,
        items: [item],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.peopleExposed - a.peopleExposed);
}

function situationSummary(monitored: number, compound: number, served: number, proactive: number) {
  if (monitored === 0) {
    return served > 0
      ? `Tidak ada kecamatan yang melewati Ambang Pemantauan 50%; optimizer tetap memilih ${fmtInt(served)} kecamatan berdasarkan Ambang Alokasi Kritis 5% dan kendala kapasitas.`
      : "Tidak ada kecamatan yang melewati Ambang Pemantauan 50% dan optimizer tidak merekomendasikan prapenempatan pada tanggal ini.";
  }
  const compoundText = compound > 0
    ? `${fmtInt(compound)} melewati ambang untuk kedua bahaya`
    : "tidak ada yang melewati ambang untuk kedua bahaya";
  const proactiveText = proactive > 0
    ? `, termasuk ${fmtInt(proactive)} alokasi preventif di bawah ambang visual 50%`
    : "";
  return `${fmtInt(monitored)} kecamatan melewati Ambang Pemantauan 50% dan ${compoundText}. Secara terpisah, optimizer memilih ${fmtInt(served)} kecamatan${proactiveText}.`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
