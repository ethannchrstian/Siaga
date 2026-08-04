import { useEffect, useMemo, useRef, useState } from "react";
import type { DistrictProperties, PlanItem, RiskDistrict } from "../api/client";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  MoreIcon,
  ResetIcon,
  SearchIcon,
} from "../icons";
import { fmtInt, type Kpis } from "../metrics";
import KpiStrip from "./KpiStrip";

interface Props {
  risk: Map<string, RiskDistrict>;
  plan: PlanItem[];
  date: string;
  districtMeta: Map<string, DistrictProperties>;
  kpis: Kpis;
  onSelect: (districtId: string) => void;
}

type SortKey = "name" | "kabupaten" | "flood_prob" | "drought_prob" | "population" | "status";
type SortDirection = "asc" | "desc";

interface Filters {
  province: string;
  regency: string;
  riskLevel: string;
  status: string;
}

const EMPTY_FILTERS: Filters = { province: "", regency: "", riskLevel: "", status: "" };

export default function Insiden({ risk, plan, date, districtMeta, kpis, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "population", direction: "desc" });
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [actionFor, setActionFor] = useState<string | null>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const served = useMemo(() => new Set(plan.map((item) => item.district_id)), [plan]);

  const baseRows = useMemo(
    () => [...risk.values()].filter((district) => Math.max(district.flood_prob, district.drought_prob) >= 0.5),
    [risk],
  );

  const provinces = useMemo(
    () => [...new Set(baseRows.map((row) => districtMeta.get(row.district_id)?.provinsi).filter(Boolean) as string[])].sort(),
    [baseRows, districtMeta],
  );
  const regencies = useMemo(
    () => [...new Set(baseRows.filter((row) => !draftFilters.province || districtMeta.get(row.district_id)?.provinsi === draftFilters.province).map((row) => row.kabupaten))].sort(),
    [baseRows, districtMeta, draftFilters.province],
  );

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id");
    const filtered = baseRows.filter((row) => {
      const meta = districtMeta.get(row.district_id);
      const isServed = served.has(row.district_id);
      const both = row.flood_prob >= 0.5 && row.drought_prob >= 0.5;
      const level = both ? "compound" : row.flood_prob >= row.drought_prob ? "flood" : "drought";
      return (
        (!normalizedQuery || `${row.name} ${row.kabupaten} ${meta?.provinsi ?? ""}`.toLocaleLowerCase("id").includes(normalizedQuery)) &&
        (!filters.province || meta?.provinsi === filters.province) &&
        (!filters.regency || row.kabupaten === filters.regency) &&
        (!filters.riskLevel || level === filters.riskLevel) &&
        (!filters.status || (filters.status === "served" ? isServed : !isServed))
      );
    });
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sort.key === "status") comparison = Number(served.has(a.district_id)) - Number(served.has(b.district_id));
      else {
        const av = a[sort.key];
        const bv = b[sort.key];
        comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "id");
      }
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [baseRows, districtMeta, filters, query, served, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const visibleRows = rows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const start = rows.length ? (page - 1) * rowsPerPage + 1 : 0;
  const end = Math.min(page * rowsPerPage, rows.length);

  useEffect(() => setPage(1), [query, filters, rowsPerPage]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!actionRef.current?.contains(event.target as Node)) setActionFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const updateSort = (key: SortKey) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  };

  const resetFilters = () => {
    setQuery("");
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  };

  return (
    <div className="page incidents-page">
      <div className="page-heading">
        <div>
          <h1>Insiden Aktif</h1>
          <p>{baseRows.length} kecamatan berisiko tinggi <span>•</span> {formatDate(date)}</p>
        </div>
      </div>

      <KpiStrip kpis={kpis} />

      <section className="incident-panel">
        <div className="filter-toolbar">
          <label className="search-control">
            <span className="sr-only">Cari kecamatan atau kabupaten/kota</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kecamatan, kab/kota..." />
            <SearchIcon size={18} />
          </label>
          <div className="filter-fields">
            <SelectFilter label="Provinsi" value={draftFilters.province} onChange={(value) => setDraftFilters((current) => ({ ...current, province: value, regency: "" }))} options={provinces} />
            <SelectFilter label="Kab/Kota" value={draftFilters.regency} onChange={(value) => setDraftFilters((current) => ({ ...current, regency: value }))} options={regencies} />
            <SelectFilter label="Risiko" value={draftFilters.riskLevel} onChange={(value) => setDraftFilters((current) => ({ ...current, riskLevel: value }))} options={["compound", "flood", "drought"]} optionLabels={{ compound: "Majemuk", flood: "Banjir", drought: "Kekeringan" }} />
            <SelectFilter label="Status" value={draftFilters.status} onChange={(value) => setDraftFilters((current) => ({ ...current, status: value }))} options={["served", "unserved"]} optionLabels={{ served: "Dilayani", unserved: "Belum dilayani" }} />
          </div>
          <div className="filter-actions">
            <button type="button" className="toolbar-button reset-button" onClick={resetFilters}><ResetIcon size={17} /> Reset</button>
            <button type="button" className="toolbar-button filter-button" onClick={() => setFilters(draftFilters)}><FilterIcon size={17} /> Filter</button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table incident-table">
            <thead><tr>
              <SortableHead label="Kecamatan" sortKey="name" sort={sort} onSort={updateSort} />
              <SortableHead label="Kab/Kota" sortKey="kabupaten" sort={sort} onSort={updateSort} />
              <SortableHead label="Risiko Banjir" sortKey="flood_prob" sort={sort} onSort={updateSort} numeric />
              <SortableHead label="Risiko Kekeringan" sortKey="drought_prob" sort={sort} onSort={updateSort} numeric />
              <SortableHead label="Populasi" sortKey="population" sort={sort} onSort={updateSort} numeric />
              <SortableHead label="Status" sortKey="status" sort={sort} onSort={updateSort} />
              <th className="action-column">Aksi</th>
            </tr></thead>
            <tbody>
              {visibleRows.map((district) => {
                const both = district.flood_prob >= 0.5 && district.drought_prob >= 0.5;
                return (
                  <tr key={district.district_id} onClick={() => onSelect(district.district_id)}>
                    <td className="strong">{district.name}</td>
                    <td className="dim">{district.kabupaten}</td>
                    <td className="num"><RiskPct value={district.flood_prob} kind="flood" /></td>
                    <td className="num"><RiskPct value={district.drought_prob} kind="drought" /></td>
                    <td className="num dim">{fmtInt(district.population)}</td>
                    <td>
                      {both ? <span className="pill-tag both">Majemuk</span> : district.drought_prob >= district.flood_prob ? <span className="pill-tag dr">Kekeringan</span> : <span className="pill-tag fl">Banjir</span>}
                      {served.has(district.district_id) && <span className="pill-tag ok">Dilayani</span>}
                    </td>
                    <td className="action-column">
                      <div className="row-action" ref={actionFor === district.district_id ? actionRef : undefined}>
                        <button type="button" className="icon-button" aria-label={`Aksi untuk ${district.name}`} aria-expanded={actionFor === district.district_id} onClick={(event) => { event.stopPropagation(); setActionFor((current) => current === district.district_id ? null : district.district_id); }}><MoreIcon size={18} /></button>
                        {actionFor === district.district_id && <div className="row-menu" role="menu"><button type="button" onClick={(event) => { event.stopPropagation(); setActionFor(null); onSelect(district.district_id); }}>Lihat di peta</button></div>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && <tr><td colSpan={7} className="table-empty">Tidak ada insiden yang sesuai dengan filter.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>Menampilkan {start} - {end} dari {rows.length} data</span>
          <div className="pagination-controls">
            <label className="rows-select"><span className="sr-only">Baris per halaman</span><select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))}><option value={10}>10 per halaman</option><option value={20}>20 per halaman</option><option value={50}>50 per halaman</option></select><ChevronDownIcon size={15} /></label>
            <button type="button" className="page-button arrow" disabled={page === 1} onClick={() => setPage((value) => value - 1)} aria-label="Halaman sebelumnya"><ChevronLeftIcon size={16} /></button>
            {paginationItems(page, pageCount).map((item, index) => item === "ellipsis" ? <span className="page-ellipsis" key={`ellipsis-${index}`}>…</span> : <button type="button" className={`page-button${item === page ? " active" : ""}`} key={item} onClick={() => setPage(item)}>{item}</button>)}
            <button type="button" className="page-button arrow" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Halaman berikutnya"><ChevronRightIcon size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SelectFilter({ label, value, onChange, options, optionLabels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; optionLabels?: Record<string, string> }) {
  return <label className="select-filter"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Semua</option>{options.map((option) => <option key={option} value={option}>{optionLabels[option] ?? option}</option>)}</select><ChevronDownIcon size={15} /></label>;
}

function SortableHead({ label, sortKey, sort, onSort, numeric = false }: { label: string; sortKey: SortKey; sort: { key: SortKey; direction: SortDirection }; onSort: (key: SortKey) => void; numeric?: boolean }) {
  return <th className={numeric ? "num" : undefined}><button type="button" className="sort-button" onClick={() => onSort(sortKey)}>{label}<span className={`sort-mark${sort.key === sortKey ? " active" : ""}`}>{sort.key === sortKey && sort.direction === "asc" ? "↑" : "↓"}</span></button></th>;
}

function RiskPct({ value, kind }: { value: number; kind: "flood" | "drought" }) {
  const percent = Math.round(value * 100);
  return <span className={percent >= 50 ? `risk-value ${kind}` : "risk-value low"}>{percent}%</span>;
}

function paginationItems(page: number, count: number): Array<number | "ellipsis"> {
  if (count <= 5) return Array.from({ length: count }, (_, index) => index + 1);
  if (page <= 3) return [1, 2, 3, "ellipsis", count];
  if (page >= count - 2) return [1, "ellipsis", count - 2, count - 1, count];
  return [1, "ellipsis", page, "ellipsis", count];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}
