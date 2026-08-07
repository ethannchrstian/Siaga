# Menyebarkan SIAGA (deployment)

Satu kontainer menyajikan API **dan** antarmuka sekaligus. Tidak ada CORS yang
perlu diatur dan tidak ada alamat API yang perlu ditulis di frontend.

> **Untuk presentasi langsung, jalankan dari laptop.** Paket gratis "tidur"
> setelah belasan menit dan butuh 30-60 detik untuk bangun. URL hasil deploy
> berguna sebagai tautan yang bisa dibuka juri setelah presentasi, dan sebagai
> cadangan bila laptop bermasalah.

---

## Langkah deploy (Render, paling sederhana)

1. Pastikan semua perubahan sudah ada di GitHub:

   ```bash
   git add -A
   git commit -m "Add deployment configuration"
   git push
   ```

2. Buka <https://render.com>, daftar dengan akun GitHub.

3. **New → Blueprint**, pilih repositori `Siaga`. Render membaca `render.yaml`
   dan mengisi semua pengaturan sendiri. Klik **Apply**.

4. Tunggu build pertama (sekitar 3-5 menit). Setelah selesai, URL-nya seperti
   `https://siaga.onrender.com`.

5. Buka URL itu. Peta, rencana, dan tombol Kunci/Alihkan harus langsung bekerja.

### Alternatif: Railway (tidak tidur)

<https://railway.app> → **New Project → Deploy from GitHub repo**. Railway
mendeteksi `Dockerfile` sendiri. Kredit percobaannya membuat layanan tetap
menyala, jadi tautannya selalu siap dibuka.

---

## Yang perlu diperiksa setelah deploy

| Periksa | Harapan |
|---|---|
| `<url>/health` | `{"status":"ok","service":"siaga-api","ui":true}` |
| Halaman utama | Peta tampil, 9 kecamatan di panel kanan |
| Tombol Kunci | Unit bergerak dari depot ke kecamatan |
| Terpadu / Terpisah | Angka berubah ke +46.060 dan kembali |

`"ui":true` menandakan antarmuka ikut terpasang. Bila `false`, build frontend
gagal dan yang tersaji hanya API.

---

## Kalau ada yang salah

**Build gagal saat `npm ci`.** `package-lock.json` tidak sinkron dengan
`package.json`. Jalankan `npm install` di lokal, commit `package-lock.json`.

**Build lama sekali atau gagal memasang paket Python.** Berarti
`requirements.txt` ikut menarik geopandas/rasterio. File itu sengaja hanya
berisi tujuh paket. Yang berat ada di `requirements-dev.txt` dan tidak dipakai
saat menyajikan.

**Halaman terbuka tetapi data kosong.** Cek `<url>/risk?date=2015-02-19`. Bila
404 atau 500, `backend/data/` tidak ikut ter-commit; pastikan
`risk_history.parquet`, `districts.geojson`, `district_centroids.csv`, dan
`population.csv` ada di Git.

**Klik pertama terasa lambat.** Wajar pada kontainer yang baru bangun: parquet
dimuat saat start (sudah dihangatkan otomatis), lalu solver CBC berjalan sekitar
1,5 detik untuk permintaan `/allocate` pertama.

---

## Catatan teknis

- **Data yang disajikan** kecil: `risk_history.parquet` 5,5 MB,
  `districts.geojson` 419 KB, model ~2 MB. Tabel latih 17 MB sengaja tidak
  ikut (lihat `.gitignore` dan `.dockerignore`).
- **Sentroid kecamatan** dihitung sekali oleh `ml/build_centroids.py` ke
  `data/district_centroids.csv`. Karena itu geopandas (dan GDAL) tidak perlu ada
  di kontainer. Jalankan ulang skrip itu hanya bila `districts.geojson` berubah.
- **Solver** CBC ikut terbawa paket PuLP, tidak perlu paket sistem tambahan.
- **Satu worker** disengaja: solver memakai CPU penuh, dan paket gratis hanya
  punya satu inti.
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
