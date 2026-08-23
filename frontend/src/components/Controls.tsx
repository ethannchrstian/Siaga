import { useState } from "react";

import type { ViewMode } from "../hazard";
import { AlertIcon, ResetIcon } from "../icons";

export type CompareMode = "siaga" | "terpisah";

interface Props {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  compare: CompareMode;
  onCompare: (mode: CompareMode) => void;
  onReplay?: () => void;
  onDisrupt?: () => void;
  disabled?: boolean;
  replayLoading?: boolean;
  disrupting?: boolean;
  canDisrupt?: boolean;
  // Radar covers 2015-2024 monthly. Outside that window the mode is hidden
  // rather than shown empty, so the operator is never offered a blank layer.
  robAvailable?: boolean;
  // How many kecamatan each mode currently flags. Without these the only way
  // to know was to count shaded polygons across 324 of them by eye, and a
  // date where every hazard mode is empty while radar has 26 looks identical
  // to a date where there is nothing anywhere. Computed once in metrics.ts.
  counts?: Partial<Record<ViewMode, number>>;
}

const MODES: { key: ViewMode; label: string; title?: string; hint?: boolean }[] = [
  { key: "gabungan", label: "Gabungan" },
  { key: "banjir", label: "Banjir" },
  { key: "cekaman", label: "Cekaman air" },
  {
    key: "rob",
    label: "Rob",
    // Carried by a ? affordance rather than the label: "(radar)" told nobody
    // what the layer does and cost the button a third of its width.
    title:
      "Genangan yang benar-benar terpantau satelit radar Sentinel-1 bulan ini, "
      + "dibandingkan kondisi normal kecamatan itu sendiri. Bukan prediksi model.",
    hint: true,
  },
];

const COMPARE_MODES: { key: CompareMode; label: string; note: string }[] = [
  { key: "siaga", label: "Terpadu", note: "SIAGA" },
  { key: "terpisah", label: "Terpisah", note: "Baseline" },
];

export default function Controls({
  mode,
  onMode,
  compare,
  onCompare,
  onReplay,
  onDisrupt,
  disabled = false,
  replayLoading = false,
  disrupting = false,
  canDisrupt = false,
  robAvailable = false,
  counts,
}: Props) {
  const [openHint, setOpenHint] = useState(false);
  return (
    <div className={`controls map-mode-control${disabled ? " controls-disabled" : ""}`}>
      <div className="seg map-risk-seg">
        {MODES.map((item) => {
          // The radar layer is kept visible even when it has no data for the
          // selected month. Hiding it made the feature look like it did not
          // exist, which is a worse failure than a disabled button that says
          // why. Only the reason changes, never the row of controls.
          const noRadar = item.key === "rob" && !robAvailable;
          const count = noRadar ? undefined : counts?.[item.key];
          const node = (
          <button
            type="button"
            key={item.key}
            className={`seg-btn${mode === item.key ? " active" : ""}`}
            onClick={() => onMode(item.key)}
            disabled={disabled || noRadar}
            title={noRadar
              ? "Tidak ada citra radar untuk bulan ini. Cakupan Sentinel-1: 2015-2024."
              : item.title}
          >
            <span>{item.label}</span>
            {count !== undefined && (
              <b className={`seg-count seg-count-${item.key}${count > 0 ? " has" : ""}`}>{count}</b>
            )}
          </button>
          );

          // The hint is its own button, so it needs to sit beside the mode
          // button rather than inside it: nesting one button in another is
          // invalid, and it was why the marker looked clickable and was not.
          if (!item.hint) return node;
          return (
            <span className="seg-slot" key={item.key}>
              {node}
              <button
                type="button"
                className={`seg-hint${openHint ? " is-open" : ""}`}
                onClick={() => setOpenHint((v) => !v)}
                aria-expanded={openHint}
                aria-label="Apa itu lapisan rob"
              >
                ?
              </button>
              {openHint && (
                <span className="seg-hint-pop" role="tooltip">
                  <b>Rob · lapisan radar</b>
                  <span>{item.title}</span>
                  <small>Sentinel-1 VV, median bulanan, ambang &minus;16 dB.</small>
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className="map-feature-row">
        <div
          className="seg seg-compare"
          aria-label="Bandingkan rencana terpadu dan terpisah"
          title="Bandingkan koordinasi SIAGA dengan penanganan dua bahaya secara terpisah"
        >
          {COMPARE_MODES.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`seg-btn${compare === item.key ? " active" : ""}`}
              onClick={() => onCompare(item.key)}
              disabled={disabled}
            >
              <span>{item.label}</span>
              <small>{item.note}</small>
            </button>
          ))}
        </div>

        {onReplay && (
          <button
            type="button"
            className={`map-feature-button${replayLoading ? " is-loading" : ""}`}
            onClick={onReplay}
            disabled={disabled || replayLoading}
            title="Putar ulang 3 minggu risiko menuju tanggal terpilih"
          >
            <ResetIcon size={13} />
            <span>{replayLoading ? "Menyiapkan..." : "Putar ulang"}</span>
          </button>
        )}
        {onDisrupt && (
          <button
            type="button"
            className={`map-feature-button disrupt${disrupting ? " is-loading" : ""}`}
            onClick={onDisrupt}
            disabled={disabled || disrupting || !canDisrupt}
            title={canDisrupt
              ? "Simulasikan rute ke alokasi banjir teratas yang terputus"
              : compare === "terpisah"
                ? "Kembali ke mode Terpadu untuk menjalankan simulasi jalur putus"
                : "Tunggu sampai rencana alokasi tersedia"}
          >
            <AlertIcon size={13} />
            <span>{disrupting ? "Mengalihkan..." : "Jalur putus"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
