import MapView from "./components/MapView";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-name">SIAGA</span>
          <span className="topbar-sub">
            Peringatan Dini Banjir–Kekeringan &amp; Prapenempatan Sumber Daya
          </span>
        </div>
        <div className="topbar-right">Koridor Pantura · Purwarupa</div>
      </header>
      <main className="content">
        <div className="map-wrap">
          <MapView />
        </div>
      </main>
    </div>
  );
}
