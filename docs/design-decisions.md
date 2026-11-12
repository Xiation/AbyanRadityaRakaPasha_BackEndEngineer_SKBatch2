# Design Decisions

Dokumen ini mencatat keputusan desain API applicant records beserta alasannya. Dasar untuk bagian "Design decisions" di README.

## 1. Domain

Applicant Tracking System (ATS) kecil untuk rekrutmen volunteer. Pengguna API: tim recruiter (dashboard internal) dan form pendaftaran. Skala: puluhan sampai ratusan pelamar per batch, segelintir pengguna internal.

Satu "applicant" di API = satu lamaran (application) beserta data orangnya. Resource tetap bernama `/v1/applicants`, meski tabelnya `applications`.

## 2. Data model

Empat tabel:

- `persons`: id, name, email (UNIQUE, dinormalisasi), phone (opsional), created_at. Hanya menyimpan informasi orang.
- `stages`: id, code (UNIQUE), name, sort_order, is_terminal. Di-seed di `migrate()` secara idempotent (`INSERT OR IGNORE` berdasarkan `code`).
- `applications`: id, person_id (FK), position, batch, current_stage_id (FK), created_at, updated_at. `UNIQUE(person_id, position, batch)`.
- `stage_history`: id, application_id (FK), from_stage_id (FK, nullable: kosong pada baris awal), to_stage_id (FK), changed_by_role, reason, notes, created_at.

Alasan:

- **Tabel `persons` terpisah.** Satu orang bisa melamar beberapa posisi tanpa menyimpan nama dan HP berulang.
- **`UNIQUE(person_id, position, batch)`.** Satu orang hanya boleh melamar satu kali per posisi per periode. Email unik berada di `persons`, jadi hasilnya setara dengan `UNIQUE(email, position, batch)`.
- **`batch` sebagai kolom.** Lowongan yang dibuka ulang berarti batch baru, jadi pelamar yang pernah ditolak bisa melamar lagi tanpa logika khusus.
- **Tanpa tabel `vacancies`.** `position` dan `batch` berupa teks tervalidasi. Brief meminta applicant records, bukan sistem manajemen lowongan.
- **Email dinormalisasi** (trim + lowercase) sebelum disimpan, karena SQLite membedakan huruf besar-kecil dan spasi.
- **`current_stage_id` di `applications`** menjawab "posisi terakhir kandidat" tanpa membaca history.
- **`stage_history` terpisah.** Kalau kolom stage hanya ditimpa, yang hilang: kapan pindah, siapa yang memindahkan, alasannya, dan stage sebelumnya (dibutuhkan untuk resume dari `on_hold`).
- **Stage di tabel, bukan konstanta.** Dipilih demi maintainability dan migrasi: urutan dan label hidup sebagai data. Aturan transisi tetap di kode, jadi ada test yang memastikan key peta transisi sama dengan `code` stage yang di-seed.
- **Timestamp** disimpan sebagai ISO-8601 UTC (teks), diisi default DB: `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`. `updated_at` tidak otomatis berubah saat UPDATE, jadi query update stage mengisinya sendiri.
- **`ON DELETE RESTRICT` di semua foreign key.** Berlaku untuk `applications.person_id`, `applications.current_stage_id`, `stage_history.application_id`, `stage_history.from_stage_id`, dan `stage_history.to_stage_id`. Alasan: `stage_history` adalah jejak audit (siapa, kapan, kenapa). Dengan `CASCADE`, menghapus lamaran atau person akan diam-diam menghapus riwayat, dan itu menghilangkan auditability. Dengan `RESTRICT`, penghapusan ditolak selama masih ada data turunan, jadi tidak ada yang hilang tanpa disengaja. Kebijakannya konsisten: data tidak dihapus lewat jalur normal. MVP tidak punya endpoint delete. Jika kelak diperlukan (misalnya permintaan penghapusan data), dibuat sebagai fitur eksplisit, bukan efek samping cascade. Perilaku ini sudah diuji: menghapus person yang punya lamaran ditolak dengan `FOREIGN KEY constraint failed`.

### Data person yang berbeda saat email sudah ada

Data lama dipertahankan, data baru di request diabaikan. Alasan: data person tidak boleh berubah lewat jalur lamaran, karena orang iseng atau salah ketik bisa merusak data orang lain. Menolak dengan 409 bertentangan dengan aturan "boleh melamar posisi berbeda". Mengubah profil adalah fitur terpisah (lihat Future work).

### Trade-off: create tanpa tabel person terpisah di API

`POST /v1/applicants` menerima data person inline (cari berdasarkan email, buat jika belum ada). Skema database sudah siap untuk alur person penuh, jadi upgrade nanti tidak membuang pekerjaan.

## 3. Stage dan aturan transisi

Stage aktif, berurutan:

`applied → screening → assessment → interview → offering → hired`

Stage khusus:

- `hired` (offer accepted), `rejected`, `withdrawn`: terminal. Tidak ada transisi keluar.
- `on_hold`: jeda, bukan terminal. Kandidat masih hidup di pipeline untuk lowongan dan batch yang sama. Use case: kandidat cadangan saat slot terbatas, menunggu pihak lain (budget, lowongan dibekukan), atau kandidat meminta jeda.

Aturan:

- Maju satu arah. Tidak ada pindah mundur. Kalau bisa mundur bebas, state machine kehilangan makna.
- `rejected`, `withdrawn`, dan `on_hold` dapat dicapai dari stage aktif mana saja.
- `rejected` dan `withdrawn` wajib `reason`. `reason` untuk `on_hold` opsional.
- `withdrawn` adalah keputusan pelamar (mengundurkan diri) dan harus meninggalkan pesan. Ini berbeda dari "pindah mundur", yang ditiadakan.

Aturan dari `on_hold`:

- Boleh ke `rejected` (recruiter) dan `withdrawn` (applicant), `reason` wajib. Tidak dipaksa resume dulu, supaya riwayat tidak berisi perpindahan palsu.
- Boleh resume, hanya ke stage sebelum di-hold. Stage itu dibaca dari `from_stage_id` pada baris `stage_history` terakhir yang `to_stage_id`-nya `on_hold`.
- Tidak boleh langsung ke `hired` atau stage lain.

Saat create, dicatat baris `stage_history` awal dengan `from_stage_id` kosong dan `to_stage_id` = `applied`. Dengan begitu timeline selalu lengkap dan tidak ada kasus khusus "belum ada history" saat membaca.

Penyederhanaan dari daftar awal: HR interview dan user interview digabung menjadi `interview`, `background check` dibuang (kurang relevan untuk volunteer), `talent pool` dibuang (cukup `on_hold`).

## 4. Role (`X-Role`)

Header `X-Role: applicant | recruiter` wajib di semua request `/v1/applicants`. Kosong atau nilai lain: 400.

- `PATCH` stage: applicant hanya boleh ke `withdrawn`. Recruiter boleh semua transisi kecuali `withdrawn`. Role yang tidak berhak: 403.
- `GET /v1/applicants` (list): hanya recruiter. Applicant mendapat 403, supaya tidak melihat data pelamar lain.
- `GET /v1/applicants/:id`: keduanya. Tampilan applicant tidak memuat `notes` internal.
- `stage_history` menyimpan `changed_by_role`.

Keterbatasan: ini simulasi, bukan keamanan. Header bisa dipalsukan, dan tanpa auth siapa pun yang tahu id dapat melihat lamaran itu. Tujuannya hanya membuat riwayat stage dan aturan hak aksi dapat divalidasi.

## 5. List, paginasi, filter

- Paginasi `limit/offset`. Alasan: data hanya ratusan dan dashboard butuh nomor halaman.
- `limit` default 20, maksimum 100. Melebihi maksimum: ditolak dengan error jelas, tidak dipotong diam-diam.
- Urutan default `created_at DESC, id DESC`. `id` sebagai tie-breaker.
- Filter: `stage`, `position`, `batch`.
- Respons: `{ "data": [...], "meta": { "total", "limit", "offset" } }`.
- Dipertimbangkan: keyset/cursor pagination pada `(created_at, id)`. Tidak dipilih karena skala. Urutan di atas sudah cocok untuk keyset, jadi upgrade tidak membuang pekerjaan.

## 6. Format error

Satu bentuk untuk semua error:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```

`code` adalah string mesin agar frontend tidak mem-parsing `message`.

- 400: JSON rusak, header `X-Role` hilang atau salah
- 403: role tidak berhak
- 404: tidak ditemukan
- 409: lamaran duplikat, transisi stage ilegal
- 413: body terlalu besar
- 422: validasi field gagal
- 429: rate limit terlampaui (dengan header `Retry-After`)

## 7. Rate limit

- Middleware tulis sendiri, fixed window per IP, state di `Map` in-memory.
- Read 60 request/menit, write (`POST`/`PATCH`) 20 request/menit. Angka sengaja longgar agar reviewer yang mencoba dengan curl tidak mudah terkena 429.
- Limit dapat diatur lewat opsi `createApp`, sehingga test tidak ikut terkena batas.
- Keterbatasan: fixed window mengizinkan burst di perbatasan window, dan state per proses sehingga tidak berlaku di multi-instance. Produksi memakai Redis.

## 8. Transaksi dan concurrency

- Driver `node:sqlite` sinkron, tidak ada `await` di antara baca stage, cek transisi, dan tulis. Pada satu proses tidak ada race condition, jadi tidak dibuat lock atau versioning.
- Transaksi tetap dipakai untuk atomicity, bukan race: (a) create = cari/buat person + buat application + baris history awal; (b) update stage = ubah `current_stage_id` + tulis `stage_history`.

## 9. Pertimbangan lain

- **Caching: tidak dibuat.** Data lokal SQLite dan query kecil. Cache menambah risiko data basi setelah update stage tanpa manfaat terukur. Jika beban baca naik: `ETag` atau cache di layer list.
- **Dokumentasi interaktif:** Swagger UI di `/docs`, membaca `docs/openapi.yaml`. Dipilih karena gratis, jalan lokal tanpa akun, dan satu sumber kontrak. Layanan eksternal (mis. Apidog) tidak dipakai karena menambah akun dan link yang harus dapat diakses reviewer. Risiko spec ditulis tangan menyimpang dari kode ditutup dengan test kesesuaian path/method. `/docs` dan `/health` dikecualikan dari `X-Role` dan rate limit.
- **Batas body:** `express.json({ limit: "10kb" })`.
- **Request ID dan log satu baris per request** (jika waktu cukup).
- **Idempotency key: tidak perlu.** `UNIQUE` sudah menutup duplikat.

## 10. Non-goals dan Future work

Non-goals MVP:

- Autentikasi dan otorisasi nyata
- Tabel `vacancies` dan status buka/tutup lowongan
- Cache, lock, versioning

Future work:

- Auth asli menggantikan `X-Role`. `changed_by` menjadi identitas pengguna.
- Satu paket: `POST /persons`, `PATCH /persons/:id`, dan melamar dengan `person_id`. Skema tidak berubah.
- Keyset pagination jika data tumbuh sampai puluhan ribu baris.
- Rate limit berbasis Redis untuk multi-instance.

## 11. Detail yang masih terbuka

Tidak ada. Semua keputusan desain sudah ditetapkan.
