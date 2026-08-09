import { useEffect, useState } from "react";

/** Below this, the splash would flash rather than read as a deliberate boot. */
const MIN_MS = 1500;
/** Matches the fade-out transition in redesign.css. */
const FADE_MS = 420;

interface Props {
  /** Initial scenario, boundaries and risk are all in. */
  ready: boolean;
}

// Cold start pulls the scenario, 324 boundaries, a day of risk and the first
// MILP solve. That is a second or two of blank chrome otherwise. The logo fills
// like a rising water level, which is what the system actually watches.
export default function BootSplash({ ready }: Props) {
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const elapsed = performance.now();
    const wait = Math.max(0, MIN_MS - elapsed);
    const start = window.setTimeout(() => setLeaving(true), wait);
    const end = window.setTimeout(() => setGone(true), wait + FADE_MS);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [ready]);

  if (gone) return null;

  return (
    <div
      className={`boot${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Memuat SIAGA"
    >
      <div className="boot-inner">
        <div className="boot-logo" aria-hidden="true">
          <span className="boot-logo-ghost" />
          <span className="boot-logo-fill" />
        </div>
        <div className="boot-word">SIAGA</div>
        <div className="boot-sub">Pusat kendali ketahanan air</div>
        <div className="boot-bar" aria-hidden="true"><i /></div>
        <div className="boot-status">
          {ready ? "Siap" : "Memuat data risiko dan rencana"}
        </div>
      </div>
    </div>
  );
}
