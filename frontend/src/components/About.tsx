import { useEffect, useState } from "react";

import { getModelInfo, type ModelInfo } from "../api/client";
import {
  CRITICAL_ALLOCATION_THRESHOLD_HELP,
  CRITICAL_ALLOCATION_THRESHOLD_PERCENT,
  MONITORING_THRESHOLD_HELP,
  MONITORING_THRESHOLD_PERCENT,
} from "../thresholds";

interface Props {
  dateMin?: string;
  dateMax?: string;
  scenarioNote?: string;
}

const SOURCES = [
  { data: "Batas kecamatan", source: "GADM v4.1 level 3", status: "observasi", note: "Geometri administratif" },
  { data: "Curah hujan 2015–2024", source: "ERA5 melalui Open-Meteo", status: "observasi", note: "Reanalisis cuaca harian" },
  { data: "Debit sungai 2015–2024", source: "GloFAS melalui Open-Meteo", status: "observasi", note: "Reanalisis hidrologi harian" },
  { data: "Populasi", source: "WorldPop 2020", status: "observasi", note: "Estimasi populasi grid 1 km" },
  { data: "Label banjir", source: "Ambang debit GloFAS", status: "turunan", note: "Dibentuk dari ambang fisik" },
  { data: "Label cekaman air", source: "SPI · Perka BMKG 9/2019", status: "turunan", note: "Dibentuk dari indeks presipitasi" },
  { data: "Inventaris pompa dan truk", source: "BNPB InaLogpal", status: "observasi", note: "Jumlah terdaftar; kesiapan wajib dikonfirmasi" },
  { data: "Lokasi depot", source: "Centroid administratif GADM", status: "turunan", note: "Proxy perencanaan, bukan koordinat gudang" },
  { data: "Regu dan kesiapan operasional", source: "Parameter operator", status: "skenario", note: "Tidak diterbitkan InaLogpal" },
];

const LOOP = ["Kelangkaan air", "Ekstraksi air tanah", "Penurunan muka tanah", "Banjir rob", "Intrusi air laut"];

export default function About({ dateMin, dateMax, scenarioNote }: Props) {
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    let live = true;
    getModelInfo()
      .then((d) => { if (live) setInfo(d); })
      .catch(() => { /* the page is still readable without the comparison */ });
    return () => { live = false; };
  }, []);

  return (
    <main className="about methodology-page">
      <header className="operational-page-head methodology-head">
        <div>
          <h1>Metode &amp; data</h1>
          <p>Definisi, alur perhitungan, dan batas penggunaan SIAGA.</p>
        </div>
        <div className="method-coverage"><span>Cakupan model</span><strong>{formatRange(dateMin, dateMax)}</strong><small>Hindcast · bukan kondisi real-time</small></div>
      </header>

      <section className="method-thesis">
        <div><span>Mengapa satu sistem?</span><h2>Banjir dan cekaman air adalah dua keluaran dari satu neraca air pesisir.</h2></div>
        <p>SIAGA menyatukan kedua bahaya karena satu kecamatan dapat membutuhkan pompa banjir dan truk air bersih pada waktu yang sama, sementara keduanya menggunakan kumpulan regu yang sama.</p>
      </section>

      <section className="method-section threshold-definition-section">
        <div className="method-section-head"><span>Definisi ambang</span><h2>Dua angka, dua fungsi yang berbeda</h2><p>Keduanya mengukur peluang bahaya model, bukan persentase stok armada.</p></div>
        <div className="threshold-definition-grid">
          <article className="threshold-definition-card monitoring" title={MONITORING_THRESHOLD_HELP}>
            <div className="threshold-definition-value">{MONITORING_THRESHOLD_PERCENT}%</div>
            <div><strong>Ambang Pemantauan</strong><p>Peluang bahaya pada atau di atas 50% ditandai untuk peringatan dini dan kesadaran situasi. Ambang ini hanya mengatur visualisasi dan tidak memicu alokasi otomatis.</p></div>
            <span>OUTPUT · WARNA PETA &amp; DAFTAR PEMANTAUAN</span>
          </article>
          <article className="threshold-definition-card allocation" title={CRITICAL_ALLOCATION_THRESHOLD_HELP}>
            <div className="threshold-definition-value">{CRITICAL_ALLOCATION_THRESHOLD_PERCENT}%</div>
            <div><strong>Ambang Alokasi Kritis</strong><p>Peluang bahaya pada atau di atas 5% membuat kebutuhan layak dipertimbangkan optimizer. Keputusan akhir juga mempertimbangkan paparan, kapasitas, waktu tempuh, dan risiko kekurangan.</p></div>
            <span>OUTPUT · KANDIDAT OPTIMASI ALOKASI</span>
          </article>
        </div>
      </section>

      <section className="method-section">
        <div className="method-section-head"><span>Alur keputusan</span><h2>Apa yang dihitung SIAGA</h2><p>Urutan ini menunjukkan perubahan data menjadi rekomendasi yang dapat ditinjau operator.</p></div>
        <ol className="method-flow">
          <li><span>01</span><div><strong>Prediksi bahaya</strong><p>Peluang banjir 0–72 jam dan peluang cekaman air untuk bulan berikutnya.</p></div></li>
          <li><span>02</span><div><strong>Estimasi paparan</strong><p>Peluang bahaya dikalikan populasi untuk membantu menentukan skala prioritas.</p></div></li>
          <li><span>03</span><div><strong>Optimasi alokasi</strong><p>Mulai peluang 5%, model memilih depot, jenis armada, jumlah unit, dan waktu tempuh dengan kapasitas terbatas.</p></div></li>
          <li><span>04</span><div><strong>Keputusan operator</strong><p>Operator dapat mengajukan dukungan provinsi, mengunci, atau mengalihkan rekomendasi; rencana kemudian dihitung ulang. Kesiapan aktual tetap diverifikasi di luar prototipe.</p></div></li>
        </ol>
      </section>

      <section className="method-two-column">
        <article className="method-card reading-card">
          <div className="method-section-head"><span>Cara membaca</span><h2>Arti angka operasional</h2></div>
          <dl className="method-glossary">
            <div><dt>Peluang bahaya</dt><dd>Kemungkinan menurut model, bukan kepastian kejadian.</dd></div>
            <div><dt>Estimasi paparan</dt><dd>Ukuran prioritas berbasis peluang × populasi, bukan jumlah korban.</dd></div>
            <div><dt>Masuk rencana</dt><dd>Wilayah tercakup oleh hasil optimasi, bukan berarti pengiriman telah selesai.</dd></div>
            <div><dt>Ambang Pemantauan</dt><dd>Peluang minimal 50% untuk warna peta dan peringatan visual; tidak memicu alokasi.</dd></div>
            <div><dt>Ambang Alokasi Kritis</dt><dd>Peluang minimal 5% agar kebutuhan masuk kandidat optimizer; bukan jaminan menerima alokasi.</dd></div>
          </dl>
        </article>

        <article className="method-card loop-card">
          <div className="method-section-head"><span>Hubungan sebab-akibat</span><h2>Siklus kerentanan pesisir</h2></div>
          <div className="causal-cycle" aria-label={`${LOOP.join(" menuju ")}, lalu kembali memperkuat kelangkaan air`}>
            {LOOP.map((item, index) => <div key={item} className={`cycle-node cycle-${index + 1}`}><span>{item}</span>{index < LOOP.length - 1 && <i aria-hidden="true">→</i>}</div>)}
            <div className="cycle-return" aria-hidden="true">↺ memperkuat siklus</div>
          </div>
        </article>
      </section>

      <MethodExplorer info={info} scenarioNote={scenarioNote} />
    </main>
  );
}

/** The heavy technical evidence, tabbed instead of stacked. One focused screen
 *  at a time (performance / model choice / calibration / data), navigable by tab,
 *  arrow, or dot, so a judge can jump straight to what they came to check
 *  rather than scroll past three dense tables. */
function MethodExplorer({ info, scenarioNote }: { info: ModelInfo | null; scenarioNote?: string }) {
  const [i, setI] = useState(0);
  const slides = [
    { key: "kinerja", label: "Kinerja model", node: <KinerjaSlide info={info} /> },
    { key: "pemilihan", label: "Pemilihan model", node: <PemilihanSlide info={info} /> },
    { key: "kalibrasi", label: "Kalibrasi", node: <KalibrasiSlide info={info} /> },
    { key: "data", label: "Sumber data", node: <DataSlide scenarioNote={scenarioNote} /> },
  ];
  const n = slides.length;
  const go = (d: number) => setI((p) => (p + d + n) % n);

  return (
    <section className="method-section method-explorer-section">
      <div className="method-section-head">
        <span>Bukti &amp; data</span>
        <h2>Kinerja, pemilihan model, dan sumber data</h2>
        <p>Telusuri pengujian, perbandingan model, dan asal data lewat tab atau panah.</p>
      </div>

      <div
        className="method-explorer"
        onKeyDown={(e) => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); }}
      >
        <div className="method-explorer-tabs" role="tablist">
          {slides.map((s, idx) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={idx === i}
              className={idx === i ? "is-active" : ""}
              onClick={() => setI(idx)}
            >
              <span className="tab-index">{String(idx + 1).padStart(2, "0")}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div className="method-explorer-stage" role="tabpanel">
          {slides[i].node}
        </div>

        <div className="method-explorer-nav">
          <button type="button" onClick={() => go(-1)} aria-label="Slide sebelumnya">&lsaquo;</button>
          <div className="method-explorer-dots">
            {slides.map((s, idx) => (
              <button
                key={s.key}
                type="button"
                className={idx === i ? "on" : ""}
                aria-label={s.label}
                aria-current={idx === i}
                onClick={() => setI(idx)}
              />
            ))}
          </div>
          <button type="button" onClick={() => go(1)} aria-label="Slide berikutnya">&rsaquo;</button>
        </div>
      </div>
    </section>
  );
}

function KinerjaSlide({ info }: { info: ModelInfo | null }) {
  return (
    <div className="explorer-slide">
      <div className="explorer-slide-head">
        <h3>Pengujian 2023–2024</h3>
        <p>Dilatih dan dikalibrasi pada 2015–2022, diuji pada dua tahun yang belum pernah dilihat.</p>
      </div>
      <div className="model-metrics">
        <MetricCard
          hazard="Banjir · 0–72 jam"
          auc={num(info?.headline.flood?.auc, "0,93")}
          precision={num(info?.headline.flood?.average_precision, "0,45")}
          brier={num(info?.headline.flood?.brier, "0,036", 3)}
          tone="flood"
        />
        <MetricCard
          hazard="Cekaman air · bulan depan"
          auc={num(info?.headline.drought?.auc, "0,96")}
          precision={num(info?.headline.drought?.average_precision, "0,87")}
          brier={num(info?.headline.drought?.brier, "0,069", 3)}
          tone="drought"
        />
      </div>
      <details className="metric-explainer"><summary>Cara membaca metrik model</summary><p>AUC dan Average Precision yang lebih tinggi menunjukkan kemampuan pemisahan kejadian yang lebih baik. Brier yang lebih rendah menunjukkan probabilitas yang lebih terkalibrasi. Metrik tetap harus dibaca bersama keterbatasan label dan cakupan geografis.</p></details>
    </div>
  );
}

function PemilihanSlide({ info }: { info: ModelInfo | null }) {
  if (!info || info.families.length === 0) return <ExplorerLoading />;
  const { families, rob, protocol } = info;
  return (
    <div className="explorer-slide">
      <div className="explorer-slide-head">
        <h3>Lima keluarga model, satu protokol</h3>
        <p>{protocol.split ?? "Latih 2015–2022, uji 2023–2024"}. Kalibrasi isotonik yang sama pada seluruh kandidat.</p>
      </div>
      <table className="model-ladder">
        <thead><tr><th>Model</th><th>AUC banjir</th><th>AUC cekaman air</th></tr></thead>
        <tbody>
          {families.map((f) => (
            <tr key={f.key} className={f.deployed ? "is-deployed" : ""}>
              <td>{f.label}{f.deployed && <em> · dipakai</em>}</td>
              <td>{f.flood_auc?.toFixed(3).replace(".", ",") ?? "—"}</td>
              <td>{f.drought_auc?.toFixed(3).replace(".", ",") ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="model-ladder-note">
        Jaringan graf mengungguli LSTM pada banjir, sehingga struktur spasial memang membawa sinyal.
        XGBoost tetap menang, sesuai perkiraan di paper: fitur debit GloFAS sudah mengandung
        penelusuran aliran dari hulu, sehingga sebagian keuntungan graf telah terserap.
      </p>
      {rob.model_ap !== undefined && (
        <div className="model-negative">
          <b>Kepala ketiga yang tidak dipakai</b>
          <span>
            Model genangan berlabel radar diuji terhadap patokan naif &ldquo;bulan depan sama seperti
            bulan ini&rdquo;. Patokan itu menang pada average precision,{" "}
            {rob.baseline_ap?.toFixed(3).replace(".", ",")} lawan {rob.model_ap?.toFixed(3).replace(".", ",")},
            sehingga kepala ini dilatih dan dilaporkan tetapi tidak disajikan ke operator.
          </span>
        </div>
      )}
    </div>
  );
}

function KalibrasiSlide({ info }: { info: ModelInfo | null }) {
  const cal = info?.calibrators.flood;
  if (!cal) return <ExplorerLoading />;
  return (
    <div className="explorer-slide">
      <div className="explorer-slide-head">
        <h3>Mengapa kalibratornya isotonik</h3>
        <p>Kandidat dinilai pada suku reliability Murphy, bukan pada Brier, yang mencampur reliability dengan resolution.</p>
      </div>
      <table className="calibrator-table">
        <thead><tr><th>Kandidat</th><th>Reliability</th><th>Selisih terburuk</th><th>Brier</th></tr></thead>
        <tbody>
          {cal.candidates.map((c) => (
            <tr key={c.name} className={c.name === cal.chosen ? "is-chosen" : ""}>
              <td>{c.name}{c.name === cal.chosen && <em> · dipilih</em>}</td>
              <td>{c.reliability.toFixed(5).replace(".", ",")}</td>
              <td>{c.worst_gap.toFixed(3).replace(".", ",")}</td>
              <td>{c.brier.toFixed(4).replace(".", ",")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="model-ladder-note">
        Sebuah model dapat memenangkan Brier sambil probabilitasnya tetap menyatakan hal yang keliru,
        jadi pemilihan mengutamakan reliability agar peluang 80% benar-benar berarti ~80%.
      </p>
    </div>
  );
}

function DataSlide({ scenarioNote }: { scenarioNote?: string }) {
  return (
    <div className="explorer-slide">
      <div className="explorer-slide-head">
        <h3>Sumber dan status data</h3>
        <p>Status membedakan data sumber, data turunan, dan data yang sengaja dibuat untuk skenario.</p>
      </div>
      <div className="provenance-legend"><span><i className="observasi" />Observasi/reanalisis</span><span><i className="turunan" />Data turunan</span><span><i className="skenario" />Data skenario</span></div>
      <div className="table-scroll"><table className="data-table provenance-table"><thead><tr><th>Data</th><th>Sumber</th><th>Penggunaan</th><th>Status</th></tr></thead><tbody>{SOURCES.map((row) => <tr key={row.data}><td className="strong">{row.data}</td><td>{row.source}</td><td>{row.note}</td><td><span className={`data-status ${row.status}`}>{row.status}</span></td></tr>)}</tbody></table></div>
      <div className="provenance-note"><strong>Keterbatasan label kejadian</strong><p>Catatan BNPB DIBI tidak dapat diakses secara programatik. Label bahaya karena itu dibentuk dari reanalisis fisik terbuka—debit GloFAS untuk banjir dan SPI untuk cekaman air.</p></div>
      {scenarioNote && <details className="scenario-note"><summary>Catatan lengkap inventaris dan asumsi operasi</summary><p>{scenarioNote}</p></details>}
    </div>
  );
}

function ExplorerLoading() {
  return <div className="explorer-loading">Memuat data model…</div>;
}

function MetricCard({ hazard, auc, precision, brier, tone }: { hazard: string; auc: string; precision: string; brier: string; tone: string }) {
  return <article className={`metric-card ${tone}`}><h3>{hazard}</h3><div><span><small>AUC</small><b>{auc}</b></span><span><small>Avg. precision</small><b>{precision}</b></span><span><small>Brier</small><b>{brier}</b></span></div></article>;
}

function formatRange(min?: string, max?: string) {
  if (!min || !max) return "2015–2024";
  return `${min.slice(0, 4)}–${max.slice(0, 4)}`;
}

/** Indonesian decimal comma, falling back to the previously hard-coded string
 *  if the endpoint is unavailable so the cards never render blank. */
function num(value: number | undefined, fallback: string, places = 2): string {
  if (value === undefined) return fallback;
  return value.toFixed(places).replace(".", ",");
}

