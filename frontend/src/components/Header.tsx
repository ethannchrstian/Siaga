import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ShieldIcon } from "../icons";

export default function Header() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true"><ShieldIcon size={24} /></div>
        <div className="brand-name">SIAGA</div>
        <div className="brand-divider" />
        <div className="brand-subtitle">Peringatan Dini Banjir, Kekeringan &amp;<br />Prapenempatan Sumber Daya</div>
      </div>
      <div className="account-wrap" ref={wrapRef}>
        <button type="button" className="account-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span className="account-avatar" aria-hidden="true">OS</span>
          <span className="account-copy"><strong>Operator SIAGA</strong><span>PUSDALOPS</span></span>
          <ChevronDownIcon size={14} />
        </button>
        {open && <div className="account-menu" role="menu"><div className="account-menu-label">Akun aktif</div><strong>Operator SIAGA</strong><span>Pusat Kendali Operasi</span></div>}
      </div>
    </header>
  );
}
