import type { AllocateResponse } from "../api/client";
import { useCountUp } from "../hooks/useCountUp";
import { fmtInt } from "../metrics";
import { PeopleIcon } from "../icons";

interface Props {
  comparison: AllocateResponse["comparison"];
  compare: "siaga" | "terpisah";
}

// The paper's B2-vs-B3 experiment as one headline number: how many more
// people the coordinated plan protects versus two agencies planning apart.
export default function CompareBanner({ comparison, compare }: Props) {
  const delta = useCountUp(Math.max(0, comparison.delta_protected), 700);
  const pct =
    comparison.baseline.expected_covered > 0
      ? Math.round(
          (100 * comparison.delta_protected) /
            comparison.baseline.expected_covered,
        )
      : 0;

  return (
    <div className={`compare-banner${compare === "terpisah" ? " off" : ""}`}>
      {compare === "siaga" ? (
        <>
          <span className="strip-icon gain" aria-hidden="true"><PeopleIcon size={15} /></span>
          {/* Compressed to fit the one-row strip. "Koordinasi terpadu" is
              dropped because the Terpadu/Terpisah toggle names it directly
              below, and the off-state copy spells the mechanism out. */}
          <span className="compare-body">
            <span className="compare-figure">+{fmtInt(delta)}</span>
            <span className="compare-copy">
              jiwa lebih terlindungi{pct > 0 && <b> (+{pct}%)</b>} vs penanganan terpisah
            </span>
          </span>
        </>
      ) : (
        <span className="compare-copy compare-copy-separated">
          <b>Mode terpisah</b>
          <span>Dua bahaya menyusun rencana sendiri.</span>
          <span><strong>{fmtInt(comparison.baseline.expected_covered)}</strong> jiwa terlindungi.</span>
        </span>
      )}
    </div>
  );
}
