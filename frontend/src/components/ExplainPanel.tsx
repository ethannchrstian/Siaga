import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  explainPlan,
  friendlyError,
  type AllocateResponse,
  type RiskDistrict,
} from "../api/client";

interface Props {
  date: string;
  result: AllocateResponse | null;
  risk: Map<string, RiskDistrict>;
  disabled?: boolean;
}

type Message = { id: number; question: string; answer?: string; error?: string; loading: boolean };

function prettyDate(value: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

/** A small spark glyph, so the assistant reads as an assistant without dragging
 *  in an icon set. */
function Spark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.6a4 4 0 0 0 2.6 2.6L22 12l-5.6 1.8a4 4 0 0 0-2.6 2.6L12 22l-1.8-5.6a4 4 0 0 0-2.6-2.6L2 12l5.6-1.8a4 4 0 0 0 2.6-2.6L12 2z" />
    </svg>
  );
}

/** Inline **bold** without a markdown library. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  );
}

/** Turns the model's short-line / bullet output into paragraphs and lists so it
 *  is scannable instead of one wall of text. */
function renderRich(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(<ul key={`u${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
      bullets = [];
    }
  };
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*•]\s+/.test(line)) bullets.push(line.replace(/^[-*•]\s+/, ""));
    else { flush(); blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>); }
  }
  flush();
  return blocks;
}

/** Grounded plain-language explanation of the current plan.
 *
 *  A compact trigger lives in the plan sidebar; the conversation itself opens in
 *  a roomy centred dialog, because a chat crammed into a 340px column is
 *  unreadable. Read-only over the optimizer either way: it phrases what the
 *  solver decided and never changes an allocation, which is why the badge says
 *  so and the numbers stay in the plan table beside it.
 */
export default function ExplainPanel({ date, result, risk, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const anyLoading = messages.some((m) => m.loading);
  const busy = anyLoading || disabled || !result;
  const topUnserved = result?.unserved?.[0]?.district;
  const chips = [
    "Wilayah paling terpapar yang belum terlayani?",
    topUnserved ? `Kenapa ${topUnserved} belum terlayani?` : "Kenapa sebagian wilayah tidak terlayani?",
    "Kenapa ada yang hanya dapat satu jenis armada?",
  ];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function ask(q?: string) {
    if (!result) return;
    const id = ++idRef.current;
    setMessages((m) => [...m, { id, question: q ?? "Ringkasan rencana", loading: true }]);
    try {
      const r = await explainPlan(date, result, risk, q);
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, answer: r.text, loading: false } : x)));
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : friendlyError(e);
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, error: msg, loading: false } : x)));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q) { ask(q); setQuestion(""); }
  }

  return (
    <>
      <button type="button" className="assistant-trigger" onClick={() => setOpen(true)}>
        <span className="assistant-mark" aria-hidden="true"><Spark size={13} /></span>
        <span className="assistant-trigger-copy">
          <span className="assistant-title">Tanya SIAGA</span>
          <small>Penjelasan AI</small>
        </span>
        <span className="assistant-open-hint" aria-hidden="true">Buka</span>
      </button>

      {open && createPortal(
        <div className="assistant-overlay" onMouseDown={() => setOpen(false)}>
          <div
            className="assistant-dialog"
            role="dialog"
            aria-label="Tanya SIAGA"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="assistant-dialog-head">
              <span className="assistant-mark lg" aria-hidden="true"><Spark size={16} /></span>
              <div className="assistant-dialog-id">
                <strong>Tanya SIAGA</strong>
                <small>Penjelasan AI</small>
              </div>
              {result && (
                <span className="assistant-ctx">
                  {result.summary.n_districts_served} kecamatan &middot; {prettyDate(date)}
                </span>
              )}
              <button type="button" className="assistant-close" onClick={() => setOpen(false)} aria-label="Tutup">×</button>
            </header>

            <div className="assistant-scroll" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="assistant-empty">
                  <span className="assistant-mark xl" aria-hidden="true"><Spark size={24} /></span>
                  <h3>Tanya apa saja tentang rencana ini</h3>
                  <p>Saya menjelaskan keputusan optimizer dalam bahasa biasa, langsung dari data rencana yang sedang tampil.</p>
                  <button type="button" className="assistant-brief" disabled={busy} onClick={() => ask()}>
                    <Spark size={14} /> Jelaskan rencana ini
                  </button>
                </div>
              ) : (
                messages.map((m) => (
                  <div className="assistant-exchange" key={m.id}>
                    <div className="assistant-q">{m.question}</div>
                    {m.loading && (
                      <div className="assistant-a is-loading">
                        <span className="assistant-avatar" aria-hidden="true"><Spark size={12} /></span>
                        <span className="assistant-typing"><i /><i /><i /></span>
                      </div>
                    )}
                    {m.error && (
                      <div className="assistant-a is-error" role="alert">
                        <span className="assistant-avatar" aria-hidden="true"><Spark size={12} /></span>
                        <div>{m.error}</div>
                      </div>
                    )}
                    {m.answer && (
                      <div className="assistant-a">
                        <span className="assistant-avatar" aria-hidden="true"><Spark size={12} /></span>
                        <div className="assistant-answer">{renderRich(m.answer)}</div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="assistant-dock">
              <div className="assistant-chips">
                {messages.length > 0 && (
                  <button type="button" disabled={busy} onClick={() => ask()}>Ringkas rencana</button>
                )}
                {chips.map((c) => (
                  <button key={c} type="button" disabled={busy} onClick={() => ask(c)}>{c}</button>
                ))}
              </div>
              <form className="assistant-ask" onSubmit={submit}>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Tanya tentang rencana ini..."
                  maxLength={300}
                  disabled={disabled}
                  autoFocus
                />
                <button type="submit" disabled={busy || !question.trim()} aria-label="Kirim pertanyaan">→</button>
              </form>
              <p className="assistant-note">Jawaban dibuat AI dari data rencana yang sedang tampil. Angka final tetap mengikuti tabel rencana.</p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
