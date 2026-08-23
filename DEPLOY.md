# Menyebarkan SIAGA (deployment)

Satu kontainer menyajikan API **dan** antarmuka sekaligus. Tidak ada CORS yang
perlu diatur dan tidak ada alamat API yang perlu ditulis di frontend.

> **Untuk presentasi langsung, jalankan dari laptop.** Kontainer gratis butuh
> waktu untuk bangun setelah lama menganggur. URL hasil deploy berguna sebagai
> tautan yang bisa dibuka juri setelah presentasi, dan sebagai cadangan bila
> laptop bermasalah.

---

## Langkah deploy (Hugging Face Spaces)

Gratis tanpa kartu kredit. Pilihan SDK (Gradio, Streamlit, Docker, Static) tidak
dipungut biaya; yang berbayar hanya perangkat kerasnya. **CPU basic, 2 vCPU dan
16 GB, gratis**, dan itu sudah cukup untuk SIAGA.

1. Pastikan semua perubahan sudah ada di GitHub:

   ```bash
   git add -A
   git commit -m "..."
   git push
   ```

2. Buka <https://huggingface.co/new-space>. Isi:

   | Kolom | Nilai |
   |---|---|
   | Space name | `siaga` |
   | License | MIT |
   | SDK | **Docker** (pilih *Blank*, bukan templat) |
   | Hardware | **CPU basic** (gratis) |
   | Visibility | Public |

3. Tambahkan remote `hf` lalu dorong isinya:

   ```bash
   git remote add hf https://huggingface.co/spaces/<username>/siaga
   git push hf main
   ```

   Bila diminta kata sandi, isi dengan **access token** dari
   <https://huggingface.co/settings/tokens> (perlu izin *write*), bukan kata
   sandi akun.

4. Tunggu build pertama, sekitar 3 sampai 5 menit. Tab **Logs** di halaman Space
   menampilkan prosesnya: tahap Node membangun frontend, lalu tahap Python
   memasang tujuh paket penyaji.

5. Buka URL Space. Peta, rencana, dan tombol Kunci/Alihkan harus langsung
   bekerja.

Space membaca blok YAML di awal `README.md`. `sdk: docker` dan `app_port: 8000`
sudah ada di sana, jadi tidak ada yang perlu diubah.

### Memperbarui Space

Dorong manual saat memang ingin URL publiknya ikut berubah:

```bash
git push hf main
```

Sengaja tidak otomatis. Space ini tautan demo untuk juri, bukan continuous
deployment, jadi commit yang masih setengah jadi tidak ikut tayang. Bila nanti
ingin otomatis, tambahkan GitHub Action yang mencerminkan `origin/main` ke Space
dengan token HF sebagai repository secret.

### Alternatif lain

| Layanan | Catatan |
|---|---|
| Render | `render.yaml` sudah ada, tetapi paket gratisnya kini meminta kartu kredit |
| Railway | Mendeteksi `Dockerfile` sendiri, juga meminta kartu |
| Cloudflare Tunnel | `cloudflared` memberi URL publik ke laptop, tanpa kartu dan tanpa akun berbayar. Berguna sebagai cadangan saat presentasi |

---

## Yang perlu diperiksa setelah deploy

| Periksa | Harapan |
|---|---|
| `<url>/health` | `{"status":"ok","service":"siaga-api","ui":true}` |
| `<url>/risk?date=2015-02-19` | Mengembalikan data, bukan 404 atau 500 |
| Halaman utama | Peta tampil, 13 kecamatan di panel kanan |
| Tombol Kunci | Unit bergerak dari depot ke kecamatan, median 0,26 detik |
| Terpadu / Terpisah | Angka koordinasi berubah lalu kembali |
| Terbitkan perintah | Dokumen terbuka, pratinjau cetak muat di A4 |

`"ui":true` menandakan antarmuka ikut terpasang. Bila `false`, build frontend
gagal dan yang tersaji hanya API.

---

## Kalau ada yang salah

**Build gagal saat `npm ci`.** Dua sebab yang mungkin. Pertama,
`package-lock.json` tidak sinkron dengan `package.json`: jalankan `npm install`
di lokal lalu commit lockfile-nya. Kedua, lockfile terlanjur menunjuk ke mirror
registry. `frontend/.npmrc` mengunci `registry.npmjs.org` justru untuk mencegah
`~/.npmrc` tingkat mesin bocor ke lockfile. Periksa log: URL yang diunduh harus
`registry.npmjs.org`.

**Build lama sekali atau gagal memasang paket Python.** Berarti
`requirements.txt` ikut menarik geopandas/rasterio. File itu sengaja hanya
berisi tujuh paket. Yang berat ada di `requirements-dev.txt` dan tidak dipakai
saat menyajikan.

**Permission denied saat solver dijalankan.** Space menjalankan kontainer
sebagai uid 1000, bukan root. `Dockerfile` sudah membuat pengguna itu dan
memberi hak eksekusi pada binari CBC. Bila pesan ini muncul, periksa bahwa
`useradd -m -u 1000 user` dan baris `chmod` pada `pulp/solverdir` masih ada.

**Halaman terbuka tetapi data kosong.** Cek `<url>/risk?date=2015-02-19`. Bila
404 atau 500, `backend/data/` tidak ikut ter-commit; pastikan
`risk_history.parquet`, `districts.geojson`, `district_centroids.csv`, dan
`population.csv` ada di Git.

**Klik pertama terasa lambat.** Wajar pada kontainer yang baru bangun: parquet
dimuat saat start (sudah dihangatkan otomatis), lalu solver CBC berjalan sekitar
1,5 detik untuk permintaan `/allocate` pertama. Bila mendekati 25 detik, solver
menyentuh `timeLimit`-nya dan demo sebaiknya dijalankan dari laptop.

---

## Catatan teknis

- **Data yang disajikan** kecil: `risk_history.parquet` 1,7 MB,
  `districts.geojson` 429 KB. Tabel latih 17 MB sengaja tidak ikut (lihat
  `.gitignore` dan `.dockerignore`). Seluruh repo hanya 4,6 MB, jadi Git LFS
  tidak diperlukan.
- **Sentroid kecamatan** dihitung sekali oleh `ml/build_centroids.py` ke
  `data/district_centroids.csv`. Karena itu geopandas (dan GDAL) tidak perlu ada
  di kontainer. Jalankan ulang skrip itu hanya bila `districts.geojson` berubah.
- **Solver** CBC ikut terbawa paket PuLP, tidak perlu paket sistem tambahan.
- **Satu worker** disengaja: solver memakai CPU penuh, dan paket gratis hanya
  punya satu sampai dua inti.
- **Tidak ada yang disimpan permanen.** Space menghapus tulisan ke disk setiap
  kali restart. Aplikasi ini hanya membaca, jadi tidak ada dampaknya.
- **Memisahkan frontend dan backend** (misalnya Vercel + Render) tetap bisa:
  set `VITE_API_BASE` saat build frontend, dan `SIAGA_ALLOWED_ORIGINS` di
  backend berisi asal frontend.

## Menjalankan di lokal

Tidak berubah:

```bash
# terminal 1
cd backend && ./venv/Scripts/python.exe -m uvicorn app.main:app --port 8000

# terminal 2
cd frontend && npm run dev      # http://localhost:5173
```

Untuk mencoba mode produksi (satu layanan) tanpa Docker:

```bash
cd frontend && npm run build
cp -r dist ../backend/app/static
cd ../backend && ./venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
# buka http://localhost:8000
```

`backend/app/static/` diabaikan Git; isinya dihasilkan ulang oleh Docker build.

Untuk menguji kontainer persis seperti yang dijalankan Space:

```bash
docker build -t siaga .
docker run --rm -p 8000:8000 --user 1000:1000 siaga
# buka http://localhost:8000/health
```

`--user 1000:1000` meniru cara Space menjalankan kontainer.
