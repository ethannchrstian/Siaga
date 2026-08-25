import { useEffect, useRef, useState } from "react";

import type { Depot, SupplyProfile, SupplyScope } from "../api/client";

export type ReserveStatus = "not_requested" | "pending" | "confirmed";

export interface SupplyImpact {
  fromLabel: string;
  toLabel: string;
  districtsDelta: number;
  peopleDelta: number;
  unitsDelta: number;
}

interface Props {
  scope: SupplyScope;
  baseScope: Exclude<SupplyScope, "provincial">;
  profile?: SupplyProfile;
  depots?: Depot[];
  provincialReserves?: Depot[];
  maxTravelMin: number;
  reserveStatuses: Record<string, ReserveStatus>;
  impact?: SupplyImpact | null;
  disabled?: boolean;
  onScope: (scope: Exclude<SupplyScope, "provincial">) => void;
  onMaxTravel: (value: number) => void;
  onRequestReserve: (depotId: string) => void;
  onConfirmReserve: (depotId: string) => void;
  onCancelReserve: (depotId: string) => void;
}

const LABEL: Record<SupplyScope, string> = {
  corridor: "Koridor Pantura",
  regional: "Koridor + sekitar",
  provincial: "Termasuk BPBD provinsi",
};

export default function SupplyControls({
  scope,
  baseScope,
  profile,
  depots = [],
  provincialReserves = [],
  maxTravelMin,
  reserveStatuses,
  impact,
  disabled = false,
  onScope,
  onMaxTravel,
  onRequestReserve,
  onConfirmReserve,
  onCancelReserve,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const registeredUnits = depots.reduce(
    (total, depot) => total + depot.registered_fleet.pompa + depot.registered_fleet.truk_tangki,
    0,
  );

  const confirmedCount = Object.values(reserveStatuses).filter((status) => status === "confirmed").length;
  const activeExplanation = scope === "corridor"
    ? "SIAGA hanya mencari armada dari depot utama di koridor Pantura."
    : scope === "regional"
      ? `SIAGA juga boleh mengambil armada milik BPBD kabupaten/kota sekitar yang dapat tiba dalam ${maxTravelMin} menit.`
      : `SIAGA boleh memakai depot koridor, BPBD kabupaten/kota sekitar, dan ${confirmedCount} BPBD provinsi yang dikonfirmasi dalam ${maxTravelMin} menit.`;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="supply-control" ref={root}>
      <button
        type="button"
        className={`map-feature-button supply-trigger${open ? " is-on" : ""}`}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span className="supply-trigger-dot" />
        <span>Sumber armada · {scope === "provincial" ? `${confirmedCount} provinsi aktif` : LABEL[scope]}</span>
      </button>

      {open && (
        <section className="supply-popover" aria-label="Pengaturan cakupan pasokan">
          <header>
            <div>
              <small>Sumber armada yang boleh dipakai</small>
              <strong>{LABEL[scope]}</strong>
            </div>
            <div className="supply-header-actions">
              <span className={`supply-evaluation ${profile?.evaluation_status === "historically_evaluated" ? "validated" : "exploratory"}`}>
                {profile?.evaluation_status === "historically_evaluated" ? "Sudah diuji" : "Belum diuji"}
              </span>
              <button type="button" className="supply-close" onClick={() => setOpen(false)} aria-label="Kembali ke rencana">×</button>
            </div>
          </header>

          <div className="supply-current" aria-live="polite">
            <div>
              <small>Yang dihitung sekarang</small>
              <strong>{depots.length || "—"} depot kandidat · {registeredUnits} unit terdaftar</strong>
            </div>
            <p>{activeExplanation}</p>
          </div>

          {impact && (
            <div className="supply-impact" aria-live="polite">
              <small>Dampak perubahan terakhir</small>
              <strong>{impact.fromLabel} → {impact.toLabel}</strong>
              <div>
                <span><b>{impact.districtsDelta >= 0 ? "+" : ""}{impact.districtsDelta}</b> wilayah</span>
                <span><b>{impact.peopleDelta >= 0 ? "+" : ""}{impact.peopleDelta.toLocaleString("id-ID")}</b> jiwa terlindungi</span>
                <span><b>{impact.unitsDelta >= 0 ? "+" : ""}{impact.unitsDelta}</b> unit</span>
              </div>
            </div>
          )}

          <div className="supply-section">
            <label><b>1</b> Dari mana armada boleh diambil?</label>
            <div className="supply-scope-buttons">
              <button type="button" className={baseScope === "corridor" && scope !== "provincial" ? "active" : ""} onClick={() => onScope("corridor")} disabled={confirmedCount > 0}>
                <strong>Koridor Pantura</strong>
                <small>Hanya depot utama dalam wilayah studi</small>
              </button>
              <button type="button" className={baseScope === "regional" && scope !== "provincial" ? "active" : ""} onClick={() => onScope("regional")} disabled={confirmedCount > 0}>
                <strong>Koridor + depot sekitar</strong>
                <small>Menambah inventaris BPBD kabupaten/kota terdekat</small>
              </button>
            </div>
          </div>

          <div className="supply-section-label"><b>2</b><span>Seberapa jauh armada boleh diambil?</span></div>
          <div className="supply-grid">
            <label>
              <span>Maksimal waktu tiba</span>
              <select value={maxTravelMin} onChange={(event) => onMaxTravel(Number(event.target.value))}>
                {[90, 120, 180].map((value) => <option key={value} value={value}>{value} menit</option>)}
              </select>
            </label>
          </div>

          <div className="supply-rule" aria-label="Cara sistem menyaring armada">
            <span>Terdaftar di InaLogpal</span><i>+</i><span>Masuk cakupan</span><i>+</i><span>Tiba tepat waktu</span><i>=</i><strong>Kandidat alokasi</strong>
          </div>

          <div className="reserve-list">
            <div className="reserve-list-head"><b>3</b><div><strong>Dukungan BPBD provinsi · opsional</strong><small>Aktifkan setiap provinsi secara terpisah</small></div></div>
            <p className="reserve-list-note">Ini adalah aset yang tercatat langsung atas nama BPBD provinsi, bukan penjumlahan seluruh kabupaten/kota.</p>
            {provincialReserves.map((reserve) => {
              const status = reserveStatuses[reserve.depot_id] ?? "not_requested";
              const units = reserve.registered_fleet.pompa + reserve.registered_fleet.truk_tangki;
              return (
                <div className={`reserve-workflow ${status}`} key={reserve.depot_id}>
                  <div>
                    <small>{status === "confirmed" ? "Aktif" : status === "pending" ? "Menunggu konfirmasi" : "Belum diminta"}</small>
                    <strong>{reserve.name}</strong>
                    <p>{reserve.registered_fleet.pompa} pompa · {reserve.registered_fleet.truk_tangki} truk · {units} unit terdaftar</p>
                  </div>
                  {status === "not_requested" && <button type="button" className="reserve-primary" onClick={() => onRequestReserve(reserve.depot_id)}>Minta dukungan</button>}
                  {status === "pending" && <div className="reserve-actions"><button type="button" className="reserve-primary" onClick={() => onConfirmReserve(reserve.depot_id)}>Konfirmasi & gunakan</button><button type="button" onClick={() => onCancelReserve(reserve.depot_id)}>Batalkan</button></div>}
                  {status === "confirmed" && <button type="button" onClick={() => onCancelReserve(reserve.depot_id)}>Nonaktifkan dukungan</button>}
                </div>
              );
            })}
          </div>

          <footer>
            <b>Catatan:</b> jumlah InaLogpal adalah inventaris terdaftar, bukan jaminan unit sedang siap. Kesiapan dan regu tetap dikonfirmasi BPBD.
          </footer>
        </section>
      )}
    </div>
  );
}
