/** Append-only record of what the operator decided, and when.
 *
 * The paper argues a MILP is preferable to a learned policy partly because it
 * can be audited. That argument only holds if the decisions themselves are
 * recorded: which recommendation was accepted, which was refused, by whom, at
 * what time, against which plan. Without this the system can explain what it
 * proposed but not what was actually done with the proposal.
 *
 * Written twice: to localStorage, which is what this session reads back, and
 * to the server, which is what makes the record outlive one browser. The local
 * copy stays authoritative for the interface so a dead API can never cost the
 * operator a decision -- the POST is fire-and-forget and its failure is
 * invisible here by design.
 */

import { recordDecision } from "./api/client";

// Versioned so pre-context logs from older builds cannot be printed beside a
// new plan and contradict its active locks/rejections.
const KEY = "siaga_decision_log_v2";
const OPERATOR_KEY = "siaga_operator";
/** Keep the file bounded. A busy shift produces tens of entries, not thousands. */
const MAX_ENTRIES = 500;

export type DecisionKind =
  | "lock"
  | "unlock"
  | "reject"
  | "clear_reject"
  | "clear_all_locks"
  | "date_change"
  | "supply_scope_change"
  | "provincial_support_requested"
  | "provincial_support_confirmed"
  | "provincial_support_cancelled"
  | "operational_assumption_change";

export interface DecisionEntry {
  at: string; // ISO 8601, always UTC
  kind: DecisionKind;
  /** Operating date being planned, which is not the wall clock in a hindcast. */
  planDate: string;
  district?: string;
  districtId?: string;
  resourceLabel?: string;
  units?: number;
  peopleExposed?: number;
  operator: string;
}

export const KIND_LABEL: Record<DecisionKind, string> = {
  lock: "Dikunci",
  unlock: "Kunci dilepas",
  reject: "Dikeluarkan dari rencana",
  clear_reject: "Pengalihan dibatalkan",
  clear_all_locks: "Semua kunci dilepas",
  date_change: "Ganti tanggal",
  supply_scope_change: "Cakupan pasokan diubah",
  provincial_support_requested: "Dukungan provinsi diajukan",
  provincial_support_confirmed: "Dukungan provinsi dikonfirmasi",
  provincial_support_cancelled: "Dukungan provinsi dikeluarkan",
  operational_assumption_change: "Asumsi operasi diubah",
};

export function operatorName(): string {
  try {
    return localStorage.getItem(OPERATOR_KEY) || "Operator Pusdalops";
  } catch {
    return "Operator Pusdalops";
  }
}

export function setOperatorName(name: string): void {
  try {
    localStorage.setItem(OPERATOR_KEY, name.trim() || "Operator Pusdalops");
  } catch {
    // storage disabled; the name simply stays at its default
  }
}

export function readLog(): DecisionEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DecisionEntry[]) : [];
  } catch {
    return [];
  }
}

/** Records one decision and returns the updated log, newest last. */
export function appendDecision(
  entry: Omit<DecisionEntry, "at" | "operator">,
): DecisionEntry[] {
  const full: DecisionEntry = {
    ...entry,
    at: new Date().toISOString(),
    operator: operatorName(),
  };
  const next = [...readLog(), full].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage disabled; the entry is still returned for this session
  }
  void postDecision(full);
  return next;
}

/** Mirrors the entry to the server. Never awaited, never surfaced: an operator
 *  pressing Kunci during an incident must not be told about a logging fault. */
async function postDecision(entry: DecisionEntry): Promise<void> {
  try {
    await recordDecision({
      kind: entry.kind,
      date: entry.planDate,
      district_id: entry.districtId,
      district: entry.district,
      resource: entry.resourceLabel,
      units: entry.units,
      operator: entry.operator,
    });
  } catch {
    // Offline, or the API is down. The local copy above already holds it.
  }
}

export function clearLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** "14.32 WIB" style, for reading inside a control room. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}.${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}, ${formatTime(iso)}`;
}
