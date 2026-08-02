import { useState } from "react";

// The differentiator: flood and drought as one self-reinforcing loop.
const STEPS = [
  "Kelangkaan air",
  "Ekstraksi air tanah",
  "Penurunan muka tanah",
  "Banjir rob",
  "Intrusi air laut",
];

export default function CausalLoop() {
  const [open, setOpen] = useState(true);
  return (
    <div className="causal">
      <button className="causal-head" onClick={() => setOpen(!open)}>
        <span>Mengapa satu sistem</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="causal-body">
          <div className="loop">
            {STEPS.map((s, i) => (
              <span key={s} className="loop-step">
                {s}
                {i < STEPS.length - 1 && <span className="loop-arr">→</span>}
              </span>
            ))}
            <span className="loop-return">
              ↺ memperkuat diri sendiri
            </span>
          </div>
          <p>
            Di pesisir utara Jawa banjir dan kekeringan bukan dua masalah
            terpisah. Keduanya adalah dua mode kegagalan dari satu neraca air
            yang saling menyebabkan, dan memperebutkan satu kumpulan truk, pompa,
            dan personel yang sama. SIAGA memodelkan keduanya bersama dan
            mengalokasikannya dari satu pusat.
          </p>
        </div>
      )}
    </div>
  );
}
