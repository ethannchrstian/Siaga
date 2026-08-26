import { useEffect, useMemo, useState } from "react";
import { sourcesOf, type DistrictProperties, type PlanItem, type RiskDistrict } from "../api/client";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "../icons";
import { fmtInt } from "../metrics";
import { MONITORING_THRESHOLD, MONITORING_THRESHOLD_HELP } from "../thresholds";
import SourceSummary from "./SourceSummary";

interface Props {
  risk: Map<string, RiskDistrict>;
  plan: PlanItem[];
  date: string;
  districtMeta: Map<string, DistrictProperties>;
  onSelect: (districtId: string) => void;
}

type RiskLevel = "" | "compound" | "flood" | "drought" | "blind" | "unmodeled";
// Radar is a separate axis from hazard dominance, not a fourth hazard, so it
// gets its own filter field rather than another RiskLevel the dropdown would
// have to carry.
type RadarFilter = "" | "blind" | "unmodeled";
type Coverage = "" | "planned" | "unplanned";
type SortKey = "name" | "kabupaten" | "flood" | "drought" | "exposure" | "coverage";
type SortDirection = "asc" | "desc";

interface Filters {
  province: string;
  regency: string;
  riskLevel: RiskLevel;
  coverage: Coverage;
  radar: RadarFilter;
}

interface PriorityRow extends RiskDistrict {
  province: string;
  exposure: number;
  level: Exclude<RiskLevel, "">;
  assignments: PlanItem[];
}

const EMPTY_FILTERS: Filters = { province: "", regency: "", riskLevel: "", coverage: "", radar: "" };

export default function Insiden({ risk, plan, date, districtMeta, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "exposure", direction: "desc" });
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const assignmentsByDistrict = useMemo(() => {
    const grouped = new Map<string, PlanItem[]>();
    for (const item of plan) grouped.set(item.district_id, [...(grouped.get(item.district_id) ?? []), item]);
    return grouped;
  }, [plan]);

  const baseRows = useMemo<PriorityRow[]>(() => [...risk.values()]
    .filter((district) => Math.max(district.flood_prob, district.drought_prob) >= MONITORING_THRESHOLD)
    .map((district) => {
      const compound = district.flood_prob >= MONITORING_THRESHOLD && district.drought_prob >= MONITORING_THRESHOLD;
      return {
        ...district,
        province: districtMeta.get(district.district_id)?.provinsi ?? "—",
        exposure: district.people_exposed,
        level: compound ? "compound" : district.flood_prob >= district.drought_prob ? "flood" : "drought",
        assignments: assignmentsByDistrict.get(district.district_id) ?? [],
      };
    }), [assignmentsByDistrict, districtMeta, risk]);

  // Kept separate from baseRows on purpose. A blind spot has flood_prob below
  // 5%, so it sits under the 50% monitoring threshold and is exactly what this
  // table filters out; measured over six dates, 49% of them never appeared
  // here at all. Merging them into the default unfiltered dataset would grow
  // it past the count in the header and nav badge, which both read
  // kpis.aboveMonitoring.
  const blindRows = useMemo<PriorityRow[]>(() => [...risk.values()]
    .filter((district) => district.rob_blind_spot)
    .map((district) => ({
      ...district,
      province: districtMeta.get(district.district_id)?.provinsi ?? "—",
      exposure: district.people_exposed,
      level: "blind" as const,
      assignments: assignmentsByDistrict.get(district.district_id) ?? [],
    })), [assignmentsByDistrict, districtMeta, risk]);

  // Never reach baseRows: their probabilities are zero, so they fail the
  // monitoring threshold by construction. Without a way in, the six kecamatan
  // the models do not cover are simply absent from the operator's world.
  const unmodeledRows = useMemo<PriorityRow[]>(() => [...risk.values()]
    .filter((district) => !district.modeled)
    .map((district) => ({
      ...district,
      province: districtMeta.get(district.district_id)?.provinsi ?? "—",
      exposure: district.people_exposed,
      level: "unmodeled" as const,
      assignments: assignmentsByDistrict.get(district.district_id) ?? [],
    })), [assignmentsByDistrict, districtMeta, risk]);

  const counts = useMemo(() => ({
    all: baseRows.length,
    compound: baseRows.filter((row) => row.level === "compound").length,
    flood: baseRows.filter((row) => row.level === "flood").length,
    drought: baseRows.filter((row) => row.level === "drought").length,
    unplanned: baseRows.filter((row) => row.assignments.length === 0).length,
    blind: blindRows.length,
    unmodeled: unmodeledRows.length,
  }), [baseRows, blindRows, unmodeledRows]);

  const provinces = useMemo(() => [...new Set(baseRows.map((row) => row.province).filter((value) => value !== "—"))].sort(), [baseRows]);
  const regencies = useMemo(() => [...new Set(baseRows.filter((row) => !filters.province || row.province === filters.province).map((row) => row.kabupaten))].sort(), [baseRows, filters.province]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id");
    const source = filters.radar === "blind"
      ? blindRows
      : filters.radar === "unmodeled" ? unmodeledRows : baseRows;
    return source.filter((row) => (
      (!normalized || `${row.name} ${row.kabupaten} ${row.province}`.toLocaleLowerCase("id").includes(normalized)) &&
      (!filters.province || row.province === filters.province) &&
      (!filters.regency || row.kabupaten === filters.regency) &&
      (!filters.riskLevel || row.level === filters.riskLevel) &&
      (!filters.coverage || (filters.coverage === "planned" ? row.assignments.length > 0 : row.assignments.length === 0))
    )).sort((a, b) => {
      let comparison = 0;
      if (sort.key === "flood") comparison = a.flood_prob - b.flood_prob;
      else if (sort.key === "drought") comparison = a.drought_prob - b.drought_prob;
      else if (sort.key === "coverage") comparison = Number(a.assignments.length > 0) - Number(b.assignments.length > 0);
      else if (sort.key === "exposure") comparison = a.exposure - b.exposure;
      else comparison = a[sort.key].localeCompare(b[sort.key], "id");
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [baseRows, blindRows, unmodeledRows, filters, query, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const visibleRows = rows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  // Looks in both sets: a blind-spot row is not in baseRows, and searching
  // only there left the detail panel blank on exactly the rows this segment
  // exists to surface.
  const selected = selectedId
    ? baseRows.find((row) => row.district_id === selectedId)
      ?? blindRows.find((row) => row.district_id === selectedId)
      ?? unmodeledRows.find((row) => row.district_id === selectedId)
      ?? null
    : null;
  const activeFilters = filterChips(filters);

  useEffect(() => setPage(1), [filters, query, rowsPerPage]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  useEffect(() => {
    if ((filters.radar === "blind" && counts.blind === 0) || (filters.radar === "unmodeled" && counts.unmodeled === 0)) {
      setFilters((current) => ({ ...current, radar: "" }));
    }
  }, [counts.blind, counts.unmodeled, filters.radar]);

  const selectSegment = (segment: "compound" | "flood" | "drought" | "unplanned" | "blind" | "unmodeled") => {
    if (segment === "blind" || segment === "unmodeled") {
      setFilters((current) => ({ ...current, radar: current.radar === segment ? "" : segment, riskLevel: "", coverage: "" }));
    } else if (segment === "unplanned") {
      setFilters((current) => ({ ...current, coverage: current.coverage === "unplanned" ? "" : "unplanned", riskLevel: "", radar: "" }));
    } else {
      setFilters((current) => ({ ...current, riskLevel: current.riskLevel === segment ? "" : segment, coverage: "", radar: "" }));
    }
  };
  const updateSort = (key: SortKey) => setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  return (
    <main className="page priority-page">
      <header className="operational-page-head">
        <div>
          <h1>Pemantauan wilayah</h1>
          <p>{formatDate(date)} · {filters.radar === "blind"
            ? "kecamatan tempat radar melihat genangan sementara model banjir menilai tenang"
            : filters.radar === "unmodeled"
              ? "kecamatan tanpa ruas sungai termodelkan; tidak ada prakiraan untuk wilayah ini"
              : "kecamatan yang melewati Ambang Pemantauan 50%"}</p>
        </div>
        <div className="terminology-note" title={MONITORING_THRESHOLD_HELP}><strong>Pemantauan · bukan pemicu alokasi</strong><span>50% menandai peringatan visual, bukan insiden terkonfirmasi. Optimizer memakai Ambang Alokasi Kritis 5% secara terpisah.</span></div>
      </header>

      <nav className="priority-segments" aria-label="Ringkasan prioritas">
        <Segment label="Risiko majemuk" value={counts.compound} tone="compound" active={filters.riskLevel === "compound"} onClick={() => selectSegment("compound")} />
        <Segment label="Banjir dominan" value={counts.flood} tone="flood" active={filters.riskLevel === "flood"} onClick={() => selectSegment("flood")} />
        <Segment label="Cekaman dominan" value={counts.drought} tone="drought" active={filters.riskLevel === "drought"} onClick={() => selectSegment("drought")} />
        <Segment label="Belum masuk prapenempatan" value={counts.unplanned} tone="gap" active={filters.coverage === "unplanned"} onClick={() => selectSegment("unplanned")} />
        <Segment label="Titik buta radar" value={counts.blind} tone="blind" active={filters.radar === "blind"} disabled={counts.blind === 0} onClick={() => selectSegment("blind")} />
        <Segment label="Di luar cakupan model" value={counts.unmodeled} tone="unmodeled" active={filters.radar === "unmodeled"} disabled={counts.unmodeled === 0} onClick={() => selectSegment("unmodeled")} />
      </nav>

      <section className="priority-toolbar">
        <label className="priority-search"><SearchIcon size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kecamatan, kabupaten/kota, atau provinsi..." /><span className="sr-only">Cari wilayah</span></label>
        <SelectFilter label="Provinsi" value={filters.province} onChange={(value) => setFilters((current) => ({ ...current, province: value, regency: "" }))} options={provinces} />
        <SelectFilter label="Kab/Kota" value={filters.regency} onChange={(value) => setFilters((current) => ({ ...current, regency: value }))} options={regencies} />
        <SelectFilter label="Bahaya" value={filters.riskLevel} onChange={(value) => setFilters((current) => ({ ...current, riskLevel: value as RiskLevel }))} options={["compound", "flood", "drought"]} labels={{ compound: "Majemuk", flood: "Banjir", drought: "Cekaman air" }} />
        <SelectFilter label="Cakupan" value={filters.coverage} onChange={(value) => setFilters((current) => ({ ...current, coverage: value as Coverage }))} options={["planned", "unplanned"]} labels={{ planned: "Masuk rencana", unplanned: "Belum masuk prapenempatan" }} />
      </section>

      {activeFilters.length > 0 && <div className="active-filter-row"><span>Filter aktif</span>{activeFilters.map((chip) => <button key={chip.key} type="button" onClick={() => setFilters((current) => ({ ...current, [chip.key]: "" }))}>{chip.label} ×</button>)}</div>}

      <div className={`priority-workspace${selected ? " has-detail" : ""}`}>
        <section className="priority-table-panel">
          <div className="table-scroll">
            <table className="data-table priority-table">
              <thead><tr>
                <SortableHead label="Wilayah" sortKey="name" sort={sort} onSort={updateSort} />
                <SortableHead label="Banjir · 0–72 jam" sortKey="flood" sort={sort} onSort={updateSort} />
                <SortableHead label="Cekaman · bulan depan" sortKey="drought" sort={sort} onSort={updateSort} />
                <SortableHead label="Estimasi paparan" sortKey="exposure" sort={sort} onSort={updateSort} numeric />
                <SortableHead label="Cakupan rencana" sortKey="coverage" sort={sort} onSort={updateSort} />
                <th><span className="sr-only">Aksi</span></th>
              </tr></thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.district_id} className={selectedId === row.district_id ? "selected" : ""} onClick={() => setSelectedId(row.district_id)}>
                    <td><div className="priority-region"><strong>{row.name}</strong><span>{row.kabupaten} · {row.province}</span><em className={`hazard-kind ${row.level}`}>{riskLabel(row.level)}</em></div></td>
                    {/* A bar at 0% would read as "assessed, and quiet". */}
                    <td>{row.modeled ? <RiskBar value={row.flood_prob} tone="flood" /> : <span className="priority-unmodeled">tak dimodelkan</span>}</td>
                    <td>{row.modeled ? <RiskBar value={row.drought_prob} tone="drought" /> : <span className="priority-unmodeled">—</span>}</td>
                    <td className="num"><strong>{fmtInt(row.exposure)}</strong><small className="table-unit">jiwa</small></td>
                    <td>{row.assignments.length > 0 ? <div className="coverage-cell"><span className="coverage-status planned">Masuk rencana</span>{row.assignments.map((item) => <small key={item.resource}>{item.units} {item.resource_label}</small>)}</div> : <span className="coverage-status unplanned">Belum dipraposisikan</span>}</td>
                    <td><button type="button" className="row-detail-button" onClick={(event) => { event.stopPropagation(); setSelectedId(row.district_id); }}>Detail</button></td>
                  </tr>
                ))}
                {visibleRows.length === 0 && <tr><td colSpan={6} className="table-empty">Tidak ada wilayah yang sesuai. Hapus beberapa filter untuk memperluas hasil.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Menampilkan {rows.length ? (page - 1) * rowsPerPage + 1 : 0}–{Math.min(page * rowsPerPage, rows.length)} dari {rows.length} wilayah</span>
            <div className="pagination-controls">
              <label className="rows-select"><select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))}><option value={10}>10 per halaman</option><option value={20}>20 per halaman</option><option value={50}>50 per halaman</option></select><ChevronDownIcon size={15} /><span className="sr-only">Baris per halaman</span></label>
              <button type="button" className="page-button arrow" disabled={page === 1} onClick={() => setPage((value) => value - 1)} aria-label="Halaman sebelumnya"><ChevronLeftIcon size={16} /></button>
              <span className="page-position">{page} / {pageCount}</span>
              <button type="button" className="page-button arrow" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Halaman berikutnya"><ChevronRightIcon size={16} /></button>
            </div>
          </div>
        </section>
        {selected && <PriorityDetail row={selected} onClose={() => setSelectedId(null)} onMap={() => onSelect(selected.district_id)} />}
      </div>
    </main>
  );
}

function Segment({ label, value, tone = "", active, disabled = false, onClick }: { label: string; value: number; tone?: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`priority-segment ${tone}${active ? " active" : ""}`} disabled={disabled} aria-disabled={disabled} onClick={onClick}><span>{label}</span><b>{fmtInt(value)}</b></button>;
}

function RiskBar({ value, tone }: { value: number; tone: "flood" | "drought" }) {
  const percent = Math.round(value * 100);
  return <div className={`table-risk ${tone}`}><div><span style={{ width: `${percent}%` }} /></div><b>{percent}%</b></div>;
}

function PriorityDetail({ row, onClose, onMap }: { row: PriorityRow; onClose: () => void; onMap: () => void }) {
  return <aside className="priority-detail">
    <header><div><span>Detail pemantauan</span><h2>{row.name}</h2><p>{row.kabupaten} · {row.province}</p></div><button type="button" onClick={onClose} aria-label="Tutup detail">×</button></header>
    {row.modeled ? (
      <div className="detail-risk-pair"><div><span>Banjir · 0–72 jam</span><b>{Math.round(row.flood_prob * 100)}%</b></div><div><span>Cekaman · bulan depan</span><b>{Math.round(row.drought_prob * 100)}%</b></div></div>
    ) : (
      <div className="drawer-unmodeled"><b>Belum dimodelkan</b><span>Tidak ada ruas sungai yang dimodelkan GloFAS untuk kecamatan ini, sehingga tidak ada prakiraan banjir maupun cekaman air.</span></div>
    )}
    <div className="detail-exposure"><span>Estimasi paparan</span><strong>{fmtInt(row.exposure)} jiwa</strong><small>Peluang bahaya tertinggi × populasi wilayah.</small></div>
    <div className="detail-section-title">Alokasi saat ini</div>
    {row.assignments.length ? row.assignments.map((item) => <div className="detail-assignment" key={item.resource}><strong>{item.units} {item.resource_label}</strong><SourceSummary item={item} /><small>{Math.min(...sourcesOf(item).map((source) => source.minutes))}–{Math.max(...sourcesOf(item).map((source) => source.minutes))} menit perjalanan · peluang {Math.round(item.hazard_prob * 100)}%</small></div>) : <div className="detail-gap">Wilayah ini belum masuk rencana alokasi saat ini.</div>}
    <button type="button" className="detail-map-button" onClick={onMap}>Lihat wilayah di peta</button>
  </aside>;
}

function SelectFilter({ label, value, onChange, options, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return <label className="priority-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Semua</option>{options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select><ChevronDownIcon size={14} /></label>;
}

function SortableHead({ label, sortKey, sort, onSort, numeric = false }: { label: string; sortKey: SortKey; sort: { key: SortKey; direction: SortDirection }; onSort: (key: SortKey) => void; numeric?: boolean }) {
  return <th className={numeric ? "num" : undefined}><button type="button" className="sort-button" onClick={() => onSort(sortKey)}>{label}<span className={`sort-mark${sort.key === sortKey ? " active" : ""}`}>{sort.key === sortKey && sort.direction === "asc" ? "↑" : "↓"}</span></button></th>;
}

function filterChips(filters: Filters) {
  const labels: Record<string, Record<string, string>> = {
    riskLevel: { compound: "Risiko majemuk", flood: "Banjir", drought: "Cekaman air" },
    coverage: { planned: "Masuk rencana", unplanned: "Belum masuk prapenempatan" },
    radar: { blind: "Titik buta radar", unmodeled: "Di luar cakupan model" },
  };
  return (Object.entries(filters) as [keyof Filters, string][]).filter(([, value]) => value).map(([key, value]) => ({ key, label: labels[key]?.[value] ?? value }));
}

function riskLabel(level: PriorityRow["level"]) {
  if (level === "compound") return "Majemuk";
  if (level === "blind") return "Titik buta";
  if (level === "unmodeled") return "Tak dimodelkan";
  return level === "flood" ? "Banjir" : "Cekaman air";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}
