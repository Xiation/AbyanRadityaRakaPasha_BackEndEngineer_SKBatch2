# Coretan

Catatan mentah, belum keputusan. Yang sudah diputuskan pindah ke [design-decisions.md](design-decisions.md).

## Nomor telepon: `UNIQUE` atau tidak?

Status: **diputuskan, `UNIQUE` dihapus** (`persons.phone` sekarang `TEXT` nullable, sama dengan [erd.md](erd.md)). Alasan: identitas person sudah dijamin email, dan satu nomor boleh dipakai bersama (keluarga, kantor); menolaknya malah menghasilkan error SQLite mentah. Normalisasi nomor ditunda (lihat batasan di README). Catatan di bawah dipertahankan sebagai jejak pertimbangan.

(Status awal: saat itu `persons.phone` di `src/db.ts` bertipe `TEXT UNIQUE` (nullable), sedangkan [erd.md](erd.md) menulisnya tanpa `UNIQUE`.)

Perilaku `UNIQUE` di SQLite: kalau diisi, satu nomor hanya bisa dipakai satu person. Nilai `NULL` tidak dianggap duplikat, jadi banyak person tanpa nomor tetap boleh.

Kalau `UNIQUE` dipertahankan:
- Pelamar dengan email baru tapi nomor yang sudah dipakai person lain gagal dengan error SQLite mentah. Harus ditangkap dan dipetakan ke error sendiri, misalnya 409 `DUPLICATE_PHONE`. Kode itu belum ada di [openapi.yaml](openapi.yaml) dan [PRD.md](PRD.md).
- Interaksi dengan keputusan "email lama mempertahankan data lama": nomor baru di request diabaikan, tapi nomor yang bertabrakan dengan person lain bisa menggagalkan lamaran.
- Uniknya bolong kalau nomor tidak dinormalisasi: `0812...`, `+62812...`, dan `0812 ...` dianggap tiga nomor berbeda.
- Kasus tepi: satu nomor dipakai bersama (keluarga, kantor).

Kalau `UNIQUE` dihapus:
- Lebih sederhana, tidak ada error code baru.
- Deteksi orang yang sama tetap lewat email, yang memang umum di ATS.
- Duplikat nomor antar person tidak tercegah (mungkin tidak masalah untuk skala ini).

Kecenderungan: hapus `UNIQUE` (KISS). Kalau dipertahankan, wajib bersama normalisasi, error `DUPLICATE_PHONE`, update OpenAPI dan PRD, dan test.

## Normalisasi nomor telepon

Ide: simpan satu format baku supaya cek duplikat dan pencarian konsisten, seperti email yang di-trim dan di-lowercase.

Usulan aturan (asumsi default negara Indonesia, karena konteksnya Sekolah Karir):
1. Buang spasi, strip, titik, dan tanda kurung.
2. Awalan `0` diganti `+62` (`0812...` jadi `+62812...`).
3. Awalan `62` tanpa plus jadi `+62`.
4. Awalan `+` dibiarkan (nomor internasional).
5. Validasi hasil akhir mirip E.164: `+`, lalu 8 sampai 15 digit, digit pertama bukan 0. Regex: `^\+[1-9][0-9]{7,14}$`.
6. Simpan versi ternormalisasi.

Pertanyaan terbuka:
- Pakai fungsi sendiri (sekitar 10 baris, mudah dijelaskan) atau library gratis `libphonenumber-js` (akurat untuk semua negara, tapi satu dependency lagi)? Kecenderungan: fungsi sendiri, karena skala kecil dan asumsi Indonesia.
- Kalau input tidak bisa dinormalisasi, tolak dengan 422 atau simpan apa adanya? Kecenderungan: tolak, supaya data bersih.
- Tempatnya: satu fungsi `normalizePhone` di schema Zod (transform), sejajar dengan normalisasi email. Satu tempat, dipakai di create.
- Kasus tepi: `+62 (0)812`, ekstensi (`ext. 12`), nomor luar negeri. Cukup ditolak atau dibiarkan di luar scope?

Dampak ke dokumen jika diputuskan masuk:
- `openapi.yaml`: pola `phone` saat ini `^\+?[0-9]{8,15}$` (menerima input mentah). Perlu deskripsi bahwa nilai dinormalisasi, dan pola input disesuaikan.
- `PRD.md` bagian 8 (validasi): baris `phone`.
- `design-decisions.md`: tambah keputusan dan alasannya.
