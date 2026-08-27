# SIAGA: prototipe

Papan kendali Pusdalops untuk peringatan dini banjir dan kekeringan pesisir
sekaligus prapenempatan sumber daya, koridor Pantura. Prototipe untuk RISTEK
Fasilkom UI Datathon 2026.

Banjir dan kekeringan dimodelkan sebagai dua mode kegagalan dari satu neraca air
yang sama, dan diperebutkan oleh satu kumpulan truk tangki, pompa, dan personel.

**Demo langsung:** <https://siaga-production-6909.up.railway.app/>

## Arsitektur

```
frontend/  React + TypeScript + MapLibre  (papan kendali)
backend/   FastAPI + XGBoost + PuLP        (model bahaya + optimizer alokasi)
```

Tiga lapis:
1. **Prediksi** dua model XGBoost terkalibrasi (banjir 0-72 jam, cekaman air
   berbasis SPI untuk bulan depan).
2. **Dampak** risiko x populasi terpapar (WorldPop).
3. **Keputusan** program stokastik dua tahap dengan objektif CVaR yang
   memprapenempatkan armada terbatas; pompa dan truk berebut satu kumpulan regu.

## Dua ambang yang berbeda

Kedua angka berikut adalah **peluang bahaya model**, bukan persentase stok:

| Ambang | Fungsi | Dampak |
|---|---|---|
| **Ambang Pemantauan (50%)** | Peringatan dini dan kesadaran situasi | Mengatur warna peta dan daftar pemantauan. Tidak memicu alokasi otomatis. |
| **Ambang Alokasi Kritis (5%)** | Batas kelayakan kebutuhan bagi optimizer | Peluang mulai 5% dapat dipertimbangkan optimizer. Alokasi akhir tetap ditentukan paparan, kapasitas, waktu tempuh, dan objektif CVaR. |

Karena fungsinya berbeda, sebuah kecamatan di bawah Ambang Pemantauan 50% dapat
tetap menerima alokasi preventif jika melewati Ambang Alokasi Kritis 5% dan
dipilih oleh hasil optimasi.

## Menjalankan

Butuh Python 3.11+ dan Node 18+.

**Windows, cara termudah:** klik dua kali `START_SIAGA.cmd` di folder proyek.
Peluncur akan menyalakan backend dan antarmuka bila belum berjalan, menunggu
keduanya siap, lalu membuka `http://localhost:5173` secara otomatis.

**Backend**
```bash
cd backend
python -m venv venv
venv/Scripts/pip install -r requirements.txt      # Windows
# source venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
venv/Scripts/uvicorn app.main:app --port 8000
```

**Frontend** (terminal lain)
```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Model dan tabel risiko sudah ter-precompute di `backend/app/artifacts/` dan
`backend/data/`, jadi aplikasi langsung jalan tanpa mengunduh ulang data.

## Membangun ulang dari data mentah (opsional)

```bash
cd backend
venv/Scripts/python ml/build_districts.py     # butuh GADM zip di data-raw/
venv/Scripts/python ml/fetch_rainfall.py      # ERA5 via Open-Meteo
venv/Scripts/python ml/fetch_discharge.py     # GloFAS via Open-Meteo
venv/Scripts/python ml/fetch_population.py     # WorldPop
venv/Scripts/python ml/build_features.py
venv/Scripts/python ml/train.py
venv/Scripts/python ml/predict_history.py
```

## Data: nyata vs skenario

Rincian di `backend/ml/DATA_PROVENANCE.md`. Ringkas:

| Data | Sumber | Status |
|------|--------|--------|
| Batas kecamatan | GADM v4.1 level 3 | nyata |
| Curah hujan harian 2015-2024 | ERA5 (Open-Meteo) | nyata |
| Debit sungai harian 2015-2024 | GloFAS (Open-Meteo) | nyata |
| Populasi | WorldPop 2020 1km | nyata |
| Label banjir | ambang debit GloFAS (gaya peringatan return-period) | nyata |
| Label kekeringan | SPI <= -1 (McKee 1993; Perka BMKG 9/2019) | nyata |
| Inventaris pompa/truk | BNPB InaLogpal, jumlah per wilayah | nyata (terdaftar, bukan kesiapan real-time) |
| Lokasi depot | centroid administratif kabupaten/kota | proxy perencanaan |
| Regu/kesiapan | parameter operasional | skenario, wajib dikonfirmasi |

## Profil pasokan

Mode bawaan tetap memakai 14 depot koridor yang digunakan pada evaluasi
historis. Operator dapat memperluas cakupan ke depot kabupaten/kota lain yang
masih berada dalam estimasi jangkauan, sedangkan inventaris provinsi baru masuk
rencana setelah dukungannya dicatat dan dikonfirmasi. Profil regional dan
provinsi bersifat eksploratif sampai hindcast dijalankan ulang untuk profil itu.

Waktu tempuh saat ini adalah estimasi garis lurus pada 40 km/jam, bukan rute
jalan. InaLogpal menjadi titik awal inventaris; status operasi, gudang keberangkatan,
bahan bakar, dan personel tetap memerlukan konfirmasi BPBD pemilik aset.

Catatan kejujuran: catatan kejadian resmi BNPB (DIBI) tidak dapat diakses secara
programatik (Superset terkunci, ArcGIS error), sehingga label bahaya diambil dari
reanalisis fisik terbuka (debit + SPI) yang justru lebih ketat daripada daftar
kejadian berbasis berita.

## Metrik model (uji 2023-2024)

| Model | AUC | Average Precision | Brier | Reliabilitas |
|-------|-----|-------------------|-------|--------------|
| Banjir (0-72 jam) | 0.93 | 0.44 | 0.036 | 0.0005 |
| Cekaman air (SPI, bulan depan) | 0.96 | 0.86 | 0.065 | 0.0035 |

Pembagian waktu: latih+kalibrasi 2015-2022, uji 2023-2024.

Kalibrator dipilih dengan **suku reliabilitas Murphy**, bukan Brier score.
Brier didominasi baris berpeluang rendah, sehingga kalibrator dapat
membiarkan wilayah berpeluang tinggi rusak dan tetap terlihat baik. Wilayah
itu justru yang dipakai optimizer. Dengan kriteria ini regresi isotonik
terpilih untuk kedua bahaya, dan selisih terbesar di atas peluang 0.5 pada
kepala cekaman air turun dari 0.329 menjadi 0.190.

## Mereproduksi angka pada makalah

```bash
cd backend
venv/Scripts/python -m pytest tests/ -q          # 74 tes
PYTHONPATH=. venv/Scripts/python ml/run_hindcast.py     # B0/B1/B2/B3, ~4 menit
PYTHONPATH=. venv/Scripts/python ml/run_reliability.py  # diagram reliabilitas
python "../New folder/make_figures.py"                  # gambar untuk makalah
```

Hasil ditulis ke `backend/results/`:

| Berkas | Isi |
|--------|-----|
| `hindcast.csv` | 147 tanggal 2023-2024, empat konfigurasi, di luar sampel |
| `hindcast_contested.csv` | 123 hari ketika kedua bahaya berebut armada |
| `hindcast_summary.json` | agregat dan rekam jejak menang/seri/kalah |
| `reliability.csv`, `.json` | kurva reliabilitas dan dekomposisi Brier |
| `hazard_mix.csv` | permintaan unit tiap bahaya per hari (cache) |

Semua penarikan acak memakai benih 42, jadi angkanya identik antar-jalankan.
Melatih ulang model (`ml/train.py` lalu `ml/predict_history.py`) akan
mengubah angka; jalankan ulang kedua skrip evaluasi setelahnya.

Butuh `requirements-dev.txt`; layanan produksi tidak memuat xgboost maupun
scikit-learn.

## Skenario demo

- **Dua bahaya Feb 2015** (bawaan): peralihan musim, banjir pesisir dan cekaman
  air terjadi bersamaan. Cilincing membutuhkan truk tangki dan pompa pada hari
  yang sama. Pompa dan truk berebut regu yang sama.
- **Kemarau Sep 2023**: puncak El Nino, hampir seluruhnya truk tangki.
- **Musim hujan Jan 2024**: didominasi risiko banjir.

Geser tanggal untuk memutar ulang tanggal mana pun 2015-2024 (hindcast).
Kunci / Tolak sebuah rekomendasi untuk memaksa optimasi ulang.

## Uji

```bash
cd backend && venv/Scripts/python -m pytest -q
```
