/** Turning a model probability into something an operator can act on.
 *
 * Two problems with showing a bare percentage in a control room.
 *
 * People read a single probability as a statement about this one place on this
 * one day, which is not what it is. A frequency framing ("about 7 of every 10
 * days like this") is understood far more reliably than the same number
 * expressed as a percentage.
 *
 * And the number is not exact. On the held-out years the drought head predicted
 * 0.88 where 0.69 was observed. An operator deciding whether to commit trucks
 * deserves to see that gap rather than infer it. `verifiedAt` looks the value
 * up in the measured reliability curve served by /scenario.
 */

import type { HazardCalibration } from "./api/client";

/** Gap above which the difference is worth interrupting the operator over. */
const NOTABLE_GAP = 0.08;
/** Bins thinner than this were noisy enough to mislead; the API already
 *  filters them, this is a second guard for safety. */
const MIN_BIN_N = 20;

/** "sekitar 7 dari 10 hari serupa" */
export function frequencyPhrase(p: number): string {
  if (p <= 0) return "hampir tidak pernah pada hari serupa";
  // Never say "10 dari 10". Rounding 0.96 to a full ten reads as certainty,
  // and no calibrated forecast here earns that: the top drought bin averages
  // 0.98 and verifies at 0.88.
  if (p >= 0.95) return "hampir selalu pada hari serupa";
  if (p < 0.1) {
    const perHundred = Math.max(1, Math.round(p * 100));
    return `sekitar ${perHundred} dari 100 hari serupa`;
  }
  return `sekitar ${Math.round(p * 10)} dari 10 hari serupa`;
}

export interface Verification {
  /** Mean predicted probability in this bin. */
  predicted: number;
  /** Observed frequency in this bin, on the held-out years. */
  observed: number;
  /** observed - predicted. Negative means the model was overconfident. */
  gap: number;
  n: number;
  /** True when the gap is large enough to be worth surfacing. */
  notable: boolean;
}

/** What probabilities near `p` actually verified at, or null if unknown. */
export function verifiedAt(
  p: number,
  cal: HazardCalibration | undefined,
): Verification | null {
  if (!cal?.curve?.length) return null;
  const bin = cal.curve.find((b) => p >= b.lo && p < b.hi)
    // The top bin is closed at 1.0, so an exact 1.0 needs the last bin.
    ?? (p >= 1 ? cal.curve[cal.curve.length - 1] : undefined);
  if (!bin || bin.n < MIN_BIN_N) return null;
  const gap = bin.observed - bin.predicted;
  return {
    predicted: bin.predicted,
    observed: bin.observed,
    gap,
    n: bin.n,
    notable: Math.abs(gap) >= NOTABLE_GAP,
  };
}

/** Short sentence for a tooltip or caption. Empty when nothing to say. */
export function verificationNote(v: Verification | null): string {
  if (!v) return "";
  const pred = Math.round(v.predicted * 100);
  const obs = Math.round(v.observed * 100);
  const direction = v.gap < 0 ? "lebih jarang" : "lebih sering";
  return (
    `Pada uji 2023-2024, peluang sekitar ${pred}% terjadi ${obs}% dari waktu, ` +
    `yaitu ${direction} daripada yang diprakirakan (${v.n.toLocaleString("id-ID")} pengamatan).`
  );
}
