import { useEffect, useRef, useState } from "react";

import {
  AlertIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FleetIcon,
  GridIcon,
  InfoIcon,
  LogoutIcon,
  MapIcon,
} from "../icons";

export type View = "peta" | "insiden" | "inventaris" | "ringkasan" | "tentang";

// Two groups: what you do during an operation, and how to check the system's
// reasoning. Metode & Data is reference material, not an operational screen.
const SECTIONS: { label: string; items: { key: View; label: string; Icon: typeof MapIcon }[] }[] = [
  {
    label: "Operasi",
    items: [
      { key: "peta", label: "Peta & Alokasi", Icon: MapIcon },
      { key: "insiden", label: "Pemantauan Wilayah", Icon: AlertIcon },
      { key: "inventaris", label: "Inventaris & Alokasi", Icon: FleetIcon },
      { key: "ringkasan", label: "Laporan Operasional", Icon: GridIcon },
    ],
  },
  {
    label: "Analisis",
    items: [{ key: "tentang", label: "Metode & Data", Icon: InfoIcon }],
  },
];

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const WEEKDAYS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const pad2 = (value: number) => String(value).padStart(2, "0");

export default function NavRail({
  view,
  onView,
  monitoringCount,
  date,
  dateMin,
  dateMax,
  presets,
  onDate,
  disabled = false,
  collapsed = false,
  onToggleCollapsed,
  operator,
  onSignOut,
}: {
  view: View;
  onView: (v: View) => void;
  /** Display name from the session, stamped on every decision this operator
   *  makes, so the console can say who decided what. */
  operator?: string;
  onSignOut?: () => void;
  monitoringCount: number;
  date: string;
  dateMin: string;
  dateMax: string;
  presets: { label: string; date: string; note: string }[];
  onDate: (date: string) => void;
  disabled?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const activePreset = presets.find((preset) => preset.date === date);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(date.slice(0, 7));
  const calendarRef = useRef<HTMLDivElement>(null);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const scenarioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scenarioOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!scenarioRef.current?.contains(event.target as Node)) setScenarioOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScenarioOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [scenarioOpen]);

  useEffect(() => setCalendarMonth(date.slice(0, 7)), [date]);
  useEffect(() => {
    if (!calendarOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!calendarRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [calendarOpen]);

  const [calendarYear, calendarMonthIndex] = calendarMonth.split("-").map(Number);
  const firstWeekday = new Date(calendarYear, calendarMonthIndex - 1, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonthIndex, 0).getDate();
  const moveCalendar = (offset: number) => {
    const next = new Date(calendarYear, calendarMonthIndex - 1 + offset, 1);
    setCalendarMonth(`${next.getFullYear()}-${pad2(next.getMonth() + 1)}`);
  };
  const minMonth = dateMin.slice(0, 7);
  const maxMonth = dateMax.slice(0, 7);

  return (
    <>
    {/* Rendered outside the <nav>, not inside it: the rail scrolls, so a
        handle straddling its border would be clipped. It rides the border
        line and mirrors the plan panel's tab on the far side. */}
    {onToggleCollapsed && (
      <button
        type="button"
        className="rail-handle"
        onClick={onToggleCollapsed}
        title={collapsed ? "Perlebar navigasi" : "Perkecil navigasi"}
        aria-label={collapsed ? "Perlebar navigasi" : "Perkecil navigasi"}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </button>
    )}
    <nav
      className={`navrail navrail-${view}${collapsed ? " is-collapsed" : ""}`}
      aria-label="Navigasi utama"
    >
      <div className="navrail-brand">
        <div className="navrail-logo">
          <img src="/siaga-logo.png" alt="" aria-hidden="true" />
          <div>
            <div className="navrail-brand-name">SIAGA</div>
            <div className="navrail-brand-sub">Pusat kendali ketahanan air</div>
          </div>
        </div>
      </div>
      {/* Filters only. The tagline that used to sit here said nothing the brand
          block does not, and the monitoring count is already the nav badge. */}
      {/* Each control carries its label above the box rather than inside it,
          so the white face holds only the value the operator is reading. */}
      <div className="navrail-context">
        <div className="navrail-field navrail-calendar-field" ref={calendarRef}>
          <span className="navrail-field-label">Hindcast · tanggal aktif</span>
          <button
            type="button"
            className={`navrail-date${calendarOpen ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
            onClick={() => !disabled && setCalendarOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={calendarOpen}
            disabled={disabled}
          >
            <strong>{formatDate(date)}</strong>
            <ChevronDownIcon size={13} />
          </button>
          {calendarOpen && (
            <div className="navrail-calendar" role="dialog" aria-label="Pilih tanggal hindcast">
              <div className="navrail-calendar-head">
                <button type="button" onClick={() => moveCalendar(-1)} disabled={calendarMonth <= minMonth} aria-label="Bulan sebelumnya">‹</button>
                <strong>{MONTHS_ID[calendarMonthIndex - 1]} {calendarYear}</strong>
                <button type="button" onClick={() => moveCalendar(1)} disabled={calendarMonth >= maxMonth} aria-label="Bulan berikutnya">›</button>
              </div>
              <div className="navrail-calendar-grid">
                {WEEKDAYS_ID.map((day) => <span className="weekday" key={day}>{day}</span>)}
                {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                  const value = `${calendarMonth}-${pad2(index + 1)}`;
                  const unavailable = value < dateMin || value > dateMax;
                  return (
                    <button
                      type="button"
                      key={value}
                      className={value === date ? "is-selected" : ""}
                      disabled={unavailable}
                      aria-label={value}
                      aria-pressed={value === date}
                      onClick={() => { onDate(value); setCalendarOpen(false); }}
                    >{index + 1}</button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="navrail-field navrail-scenario-field" ref={scenarioRef}>
          <span className="navrail-field-label" id="navrail-scenario-label">Skenario contoh</span>
          <button
            type="button"
            className={`navrail-scenario${scenarioOpen ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
            onClick={() => !disabled && setScenarioOpen((open) => !open)}
            aria-labelledby="navrail-scenario-label"
            aria-haspopup="listbox"
            aria-expanded={scenarioOpen}
            disabled={disabled}
          >
            <strong>{activePreset?.label ?? "Pilih skenario"}</strong>
            <ChevronDownIcon size={13} />
          </button>
          {scenarioOpen && (
            <div className="navrail-scenario-menu" role="listbox" aria-label="Pilih skenario contoh">
              {presets.map((preset) => {
                const selected = preset.date === date;
                return (
                  <button
                    type="button"
                    key={preset.date}
                    className={selected ? "is-selected" : ""}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onDate(preset.date);
                      setScenarioOpen(false);
                    }}
                  >
                    <span><strong>{preset.label}</strong><small>{preset.note}</small></span>
                  </button>
                );
              })}
            </div>
          )}
          {activePreset && <small className="navrail-scenario-note">{activePreset.note}</small>}
        </div>
      </div>
      {SECTIONS.map((section) => (
        <div className="navrail-group" key={section.label}>
          <div className="navrail-section">{section.label}</div>
          {section.items.map((it) => (
            <button
              key={it.key}
              className={`navrail-btn${view === it.key ? " active" : ""}`}
              onClick={() => onView(it.key)}
              aria-current={view === it.key ? "page" : undefined}
              /* Collapsed, the icon is all that is left to identify the item. */
              title={it.label}
            >
              <it.Icon size={18} />
              <span>{it.label}</span>
              {it.key === "insiden" && monitoringCount > 0 && (
                <span className="nav-badge">{monitoringCount}</span>
              )}
            </button>
          ))}
        </div>
      ))}
      <div className="navrail-foot">
        <div className="navrail-operator">
          <span className="account-avatar" aria-hidden="true">{initials(operator)}</span>
          {/* Its own class rather than :last-child: the sign-out button now
              sits after it, which silently cost this block its column layout
              and ran the name into the role. */}
          <span className="navrail-operator-id">
            <strong title={operator ?? "Operator SIAGA"}>{operator ?? "Operator SIAGA"}</strong>
            <small>PUSDALOPS</small>
          </span>
          {onSignOut && (
            <button
              type="button"
              className="navrail-signout"
              onClick={onSignOut}
              title="Keluar dari sesi"
              aria-label="Keluar dari sesi"
            >
              <LogoutIcon size={15} />
            </button>
          )}
        </div>
      </div>
    </nav>
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

/** Initials from word starts, so "Operator SIAGA" reads OS rather than OP. */
function initials(name?: string): string {
  const words = (name ?? "Operator SIAGA").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "OS";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
