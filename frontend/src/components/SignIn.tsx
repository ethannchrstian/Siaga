import { useEffect, useRef, useState } from "react";

import { login } from "../api/client";
import { setOperatorName } from "../decisionLog";

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
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => { userRef.current?.focus(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await login(username, password);
      setOperatorName(session.display);
      onSignedIn();
    } catch {
      // The server does not say which half was wrong, and neither does this.
      setError("Nama pengguna atau kata sandi salah.");
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      {/* Four soft washes drifting on unrelated schedules. Blurred past the
          point where any edge is trackable, so the page is never still and
          never asks to be looked at -- the previous particle field filled the
          whole screen with motion while somebody was trying to type. */}
      <div className="signin-aura" aria-hidden="true">
        <i className="aura a1" />
        <i className="aura a2" />
        <i className="aura a3" />
        <i className="aura a4" />
      </div>
      <div className="signin-grid" aria-hidden="true" />

      <form className="signin-card" onSubmit={submit}>
        <div className="signin-brand">
          <img className="signin-logo" src="/siaga-logo.png" alt="" aria-hidden="true" />
          <span>
            <b>SIAGA</b>
            <small>Pusat kendali ketahanan air</small>
          </span>
        </div>

        <h1>Masuk ke konsol</h1>

        <label className="signin-field">
          <span>Nama pengguna</span>
          <input
            ref={userRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            spellCheck={false}
            required
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
          />
        </label>

        {error && <p className="signin-error" role="alert">{error}</p>}

        <button type="submit" className="signin-submit" disabled={busy}>
          {busy ? "Memeriksa…" : "Masuk"}
        </button>

        <p className="signin-foot">Pusdalops · BPBD</p>
      </form>
    </div>
  );
}
