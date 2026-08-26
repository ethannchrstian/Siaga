import { useEffect, useRef, useState } from "react";

import { login } from "../api/client";
import { setOperatorName } from "../decisionLog";
import Constellation from "./Constellation";

/** Operator sign-in.
 *
 *  The server holds the credential as a scrypt hash and issues the session, so
 *  nothing secret ships in this bundle. What it gates is the interface; the
 *  data routes are still open, which is documented in
 *  backend/app/routers/auth.py rather than announced on the screen.
 *
 *  The signed-in name is what decisionLog stamps on every Kunci and Alihkan
 *  and what the dispatch order prints, so the console can say who decided
 *  what. That is the reason this screen exists rather than looking the part.
 */
export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [clock, setClock] = useState(wib);
  const userRef = useRef<HTMLInputElement>(null);
  const openTimerRef = useRef<number | null>(null);

  useEffect(() => { userRef.current?.focus(); }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(wib()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await login(username, password);
      setOperatorName(session.display);
      setVerified(true);
      // Hold the verified network moment long enough to read, then hand off to
      // the water-level boot sequence that loads the operating context.
      openTimerRef.current = window.setTimeout(onSignedIn, 1250);
    } catch {
      // The server does not say which half was wrong, and neither does this.
      setError("Nama pengguna atau kata sandi salah.");
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <div className={`signin${verified ? " is-verified" : ""}`}>
      <Constellation verified={verified} />
      <div className="signin-wash" aria-hidden="true" />
      {/* A clock, because it is the one thing on a shift login that an operator
          actually reads. No tagline: whoever opens this every morning already
          knows what the console is for. */}
      <div className="signin-clock" aria-hidden="true">{clock}</div>

      <form className={`signin-card${verified ? " is-verified" : ""}`} onSubmit={submit} aria-busy={busy}>
        <div className="signin-brand">
          <img className="signin-logo" src="/siaga-logo.png" alt="" aria-hidden="true" />
          <b>SIAGA</b>
        </div>

        <h1>{verified ? "Akses terverifikasi" : "Masuk ke konsol"}</h1>

        <div className={`signin-fields${verified ? " is-hidden" : ""}`} aria-hidden={verified}>
        <label className="signin-field">
          <span>Nama pengguna</span>
          <input
            ref={userRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            spellCheck={false}
            required
            disabled={busy}
          />
        </label>

        <label className="signin-field">
          <span>Kata sandi</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>

        {error && <p className="signin-error" role="alert">{error}</p>}

        <button type="submit" className="signin-submit" disabled={busy}>
          {busy ? "Memeriksa…" : "Masuk"}
        </button>
        </div>

        {verified && (
          <div className="signin-verified" role="status" aria-live="polite">
            <span className="signin-verified-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.7-8" /></svg>
            </span>
            <div><strong>Identitas operator diterima</strong><small>Menyiapkan jaringan risiko dan rencana operasi…</small></div>
            <i aria-hidden="true" />
          </div>
        )}

      </form>
    </div>
  );
}

/** Jakarta wall clock. The corridor is WIB and the label says so, because a
 *  bare time on a national system is ambiguous. */
function wib(): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date()) + " WIB";
}
