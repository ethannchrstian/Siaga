---
title: SIAGA
emoji: 🌊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
license: mit
---

# SIAGA — purwarupa

Papan kendali Pusdalops untuk peringatan dini banjir dan kekeringan pesisir
sekaligus prapenempatan sumber daya, koridor Pantura. Purwarupa untuk RISTEK
Fasilkom UI Datathon 2026.

Banjir dan kekeringan dimodelkan sebagai dua mode kegagalan dari satu neraca air
yang sama, dan diperebutkan oleh satu kumpulan truk tangki, pompa, dan personel.

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
| Inventaris depot/armada | ditempatkan di lokasi BPBD nyata, jumlah placeholder | skenario |

Catatan kejujuran: catatan kejadian resmi BNPB (DIBI) tidak dapat diakses secara
programatik (Superset terkunci, ArcGIS error), sehingga label bahaya diambil dari
reanalisis fisik terbuka (debit + SPI) yang justru lebih ketat daripada daftar
kejadian berbasis berita.

## Metrik model (uji 2023-2024)

| Model | AUC | Average Precision | Brier |
|-------|-----|-------------------|-------|
| Banjir (0-72 jam) | 0.93 | 0.45 | 0.036 |
| Cekaman air (SPI, bulan depan) | 0.96 | 0.87 | 0.069 |

Pembagian waktu: latih+kalibrasi 2015-2022, uji 2023-2024. Kalibrasi Platt
tervalidasi silang dengan penjaga fallback ke skor mentah.

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
