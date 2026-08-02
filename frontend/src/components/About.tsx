const LOOP = [
  "Kelangkaan air",
  "Ekstraksi air tanah",
  "Penurunan muka tanah",
  "Banjir rob",
  "Intrusi air laut",
];

const SOURCES = [
  ["Batas kecamatan", "GADM v4.1 level 3", "nyata"],
  ["Curah hujan 2015–2024", "ERA5 (Open-Meteo)", "nyata"],
  ["Debit sungai 2015–2024", "GloFAS (Open-Meteo)", "nyata"],
  ["Populasi", "WorldPop 2020", "nyata"],
  ["Label banjir", "ambang debit GloFAS", "nyata"],
  ["Label kekeringan", "SPI (Perka BMKG 9/2019)", "nyata"],
  ["Inventaris depot/armada", "penempatan BPBD nyata, jumlah placeholder", "skenario"],
];

export default function About() {
  return (
    <div className="about">
      <div className="ov-head">
        <h2>Tentang SIAGA</h2>
      </div>

      <section className="panel">
        <div className="panel-title">Mengapa satu sistem</div>
        <div className="loop big">
          {LOOP.map((s, i) => (
            <span key={s} className="loop-step">
              {s}
              {i < LOOP.length - 1 && <span className="loop-arr">→</span>}
            </span>
          ))}
          <span className="loop-return">↺ memperkuat diri sendiri</span>
        </div>
        <p>
          Di pesisir utara Jawa banjir dan kekeringan bukan dua masalah
          terpisah. Keduanya adalah dua mode kegagalan dari satu neraca air yang
          saling menyebabkan: kelangkaan air mendorong ekstraksi air tanah,
          ekstraksi memicu penurunan muka tanah, penurunan tanah memperparah
          banjir rob, dan rob mendorong intrusi air laut yang mengasinkan sumur
          sehingga kelangkaan air kembali memburuk. Satu kecamatan bisa
          membutuhkan pompa banjir dan truk air bersih pada hari yang sama, dari
          satu kumpulan sumber daya yang sama.
        </p>
      </section>

      <section className="panel">
        <div className="panel-title">Sumber data</div>
        <table className="src-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Sumber</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((r) => (
              <tr key={r[0]}>
                <td>{r[0]}</td>
                <td>{r[1]}</td>
                <td>
                  <span className={`status ${r[2]}`}>{r[2]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          Catatan kejadian resmi BNPB (DIBI) tidak dapat diakses secara
          programatik, sehingga label bahaya diambil dari reanalisis fisik
          terbuka (debit dan SPI). Model diuji pada 2023–2024: AUC banjir 0,93
          dan cekaman air 0,96.
        </p>
      </section>
    </div>
  );
}
