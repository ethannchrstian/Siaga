import type { AllocateResponse } from "../api/client";
import { useCountUp } from "../hooks/useCountUp";
import { fmtInt } from "../metrics";

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
          <span className="compare-figure">+{fmtInt(delta)}</span>
          <span className="compare-copy">
            jiwa lebih terlindungi dengan koordinasi terpadu
            {pct > 0 && <b> (+{pct}%)</b>} dibanding penanganan terpisah
          </span>
        </>
      ) : (
        <span className="compare-copy">
          <b>Mode terpisah:</b> banjir dan cekaman air direncanakan sendiri-sendiri,
          sehingga regu depot habis dipakai bahaya pertama.{" "}
          {fmtInt(comparison.baseline.expected_covered)} jiwa terlindungi.
        </span>
      )}
    </div>
  );
}
