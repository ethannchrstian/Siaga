import { useEffect, useRef, useState } from "react";

import type { ViewMode } from "../hazard";
import { ClockIcon, ResetIcon } from "../icons";

export type CompareMode = "siaga" | "terpisah";

interface Props {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  compare: CompareMode;
  onCompare: (mode: CompareMode) => void;
  onReplay?: () => void;
  disabled?: boolean;
  replayLoading?: boolean;
  // Radar covers 2015-2024 monthly. Outside that window the mode is hidden
  // rather than shown empty, so the operator is never offered a blank layer.
  robAvailable?: boolean;
  // How many kecamatan each mode currently flags. Without these the only way
  // to know was to count shaded polygons across 324 of them by eye, and a
  // date where every hazard mode is empty while radar has 26 looks identical
  // to a date where there is nothing anywhere. Computed once in metrics.ts.
  counts?: Partial<Record<ViewMode, number>>;
  /** Only offered in the radar view: it plays radar, nothing else. */
  onTimelapse?: () => void;
  timelapseLoading?: boolean;
  timelapseRunning?: boolean;
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
  disabled = false,
  replayLoading = false,
  robAvailable = false,
  counts,
  onTimelapse,
  timelapseLoading = false,
  timelapseRunning = false,
}: Props) {
  const [openHint, setOpenHint] = useState(false);
  const robHintRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!openHint) return;
    const closeOutside = (event: PointerEvent) => {
      if (!robHintRef.current?.contains(event.target as Node)) setOpenHint(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenHint(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openHint]);

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
            <span
              className="seg-slot"
              key={item.key}
              ref={robHintRef}
            >
              {node}
              <button
                type="button"
                className={`seg-hint${openHint ? " is-open" : ""}`}
                onClick={() => setOpenHint(true)}
                onMouseEnter={() => setOpenHint(true)}
                onMouseLeave={() => setOpenHint(false)}
                onFocus={() => setOpenHint(true)}
                onBlur={() => setOpenHint(false)}
                aria-expanded={openHint}
                aria-controls="rob-layer-help"
                aria-label="Apa itu lapisan rob"
              >
                ?
              </button>
              {openHint && (
                <span className="seg-hint-pop" id="rob-layer-help" role="dialog" aria-label="Informasi lapisan Rob">
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
        {onTimelapse && (
          <button
            type="button"
            className={`map-feature-button${timelapseRunning ? " is-on" : ""}`}
            onClick={onTimelapse}
            disabled={disabled || timelapseLoading || timelapseRunning}
            title="Putar sepuluh tahun genangan terpantau radar, 2015 sampai 2024"
          >
            <ClockIcon size={13} />
            <span>
              {timelapseLoading
                ? "Memuat..."
                : timelapseRunning ? "Memutar 2015-2024" : "Putar 2015-2024"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
