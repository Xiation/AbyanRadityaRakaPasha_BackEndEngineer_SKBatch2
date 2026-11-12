# PRD: Applicant Records API

Status: MVP, siap diimplementasi
Konteks: Mini assignment Back-End Engineer, Sekolah Karir (volunteer, divisi Product and Technology)
Dokumen terkait: [design-decisions.md](design-decisions.md), [erd.md](erd.md), [openapi.yaml](openapi.yaml)

## 1. Ringkasan

API kecil untuk mencatat pelamar dan memindahkan mereka antar tahap rekrutmen (Applicant Tracking System sederhana). Brief meminta tiga operasi: create applicant, list applicants, update stage, dengan basic validation. Penilaian ada pada API design, validation, data modeling, dan clarity. Bukan pada kompleksitas.

## 2. Masalah

Tim rekrutmen perlu satu tempat untuk menjawab: siapa saja yang melamar, sedang di tahap mana, dan bagaimana riwayat perpindahannya. Tanpa catatan terstruktur, status pelamar tersebar dan riwayat keputusan (kapan, siapa, kenapa) hilang.

## 3. Tujuan dan non-tujuan

### Tujuan
- Mencatat lamaran dengan validasi yang jelas dan mencegah lamaran ganda.
- Memindahkan lamaran antar stage dengan aturan transisi yang eksplisit.
- Menyimpan riwayat lengkap setiap perpindahan (siapa, kapan, alasan).
- Menyediakan list dengan filter dan paginasi untuk dashboard.
- Dokumentasi yang bisa dijalankan reviewer tanpa bertanya.

### Non-tujuan (MVP)
- Autentikasi dan otorisasi nyata
- Manajemen lowongan (tabel `vacancies`, status buka/tutup)
- Cache, lock, versioning, multi-instance
- UI atau frontend
- Upload CV, notifikasi email

## 4. Pengguna

Asumsi skala: puluhan sampai ratusan pelamar per batch, segelintir pengguna internal.

| Role | Siapa | Hak |
|---|---|---|
| `applicant` | Pelamar (lewat form pendaftaran) | Membuat lamaran, melihat detail lamaran (tanpa `notes`), mengundurkan diri (`withdrawn`) |
| `recruiter` | Tim rekrutmen | Melihat list dan detail penuh, memindahkan stage kecuali `withdrawn` |

Role dikirim lewat header `X-Role`. Ini simulasi untuk memvalidasi aturan dan riwayat, bukan keamanan.

## 5. Scope MVP

### 5.1 Endpoint

| Method | Path | Fungsi | Role |
|---|---|---|---|
| GET | `/health` | Health check | semua |
| POST | `/applicants` | Buat lamaran | applicant, recruiter |
| GET | `/applicants` | List + filter + paginasi | recruiter |
| GET | `/applicants/:id` | Detail + riwayat stage | applicant, recruiter |
| PATCH | `/applicants/:id/stage` | Ubah stage | sesuai aturan transisi dan role |
| GET | `/docs` | Dokumentasi interaktif (Swagger UI) | semua, tanpa `X-Role` |

Kontrak lengkap: [openapi.yaml](openapi.yaml). `/health` dan `/docs` tidak termasuk dalam kontrak `/applicants`; keduanya dikecualikan dari `X-Role` dan rate limit.

### 5.2 Kebutuhan fungsional

**Create**
- FR-1. Menerima `name`, `email`, `position`, `batch` (wajib) dan `phone` (opsional).
- FR-2. Email dinormalisasi (trim + lowercase) sebelum dicari atau disimpan.
- FR-3. Jika person dengan email itu sudah ada, data person lama dipertahankan dan `name`/`phone` baru diabaikan.
- FR-4. Satu person hanya boleh satu lamaran per `(position, batch)`. Duplikat: 409 `DUPLICATE_APPLICATION`.
- FR-5. Lamaran baru berstage `applied` dan mencatat baris riwayat awal (`from` kosong, `to` = `applied`).
- FR-6. Cari/buat person, buat application, dan tulis riwayat awal dalam satu transaksi.
- FR-7. Respons 201 dengan header `Location`.

**List**
- FR-8. Filter opsional: `stage` (code), `position`, `batch`.
- FR-9. Paginasi `limit/offset`. `limit` default 20, maksimum 100. Di atas 100: 422.
- FR-10. Urutan `created_at DESC, id DESC`.
- FR-11. Respons `{ data, meta: { total, limit, offset } }`.
- FR-12. Hanya `recruiter`. `applicant` mendapat 403.

**Detail**
- FR-13. Mengembalikan lamaran, data person, stage saat ini, dan riwayat (urut lama ke baru).
- FR-14. Untuk `applicant`, `notes` pada riwayat tidak ditampilkan.

**Update stage**
- FR-15. Menerima `to_stage` (wajib), `reason`, `notes`.
- FR-16. Transisi diperiksa terhadap peta transisi (bagian 6). Tidak sah: 409 `INVALID_TRANSITION`.
- FR-17. `reason` wajib untuk `rejected` dan `withdrawn`. Kurang: 422.
- FR-18. `applicant` hanya boleh ke `withdrawn`. `recruiter` boleh semua transisi sah kecuali `withdrawn`. Selain itu: 403.
- FR-19. Perubahan `current_stage_id`, `updated_at`, dan baris `stage_history` ditulis dalam satu transaksi.
- FR-20. Resume dari `on_hold` hanya ke stage sebelum hold, dibaca dari riwayat.

**Dokumentasi interaktif**
- FR-21. `GET /docs` menyajikan Swagger UI yang membaca `docs/openapi.yaml`. File itu satu-satunya sumber kontrak API.
- FR-22. Reviewer dapat memakai "Try it out" dan mengisi `X-Role` lewat tombol Authorize.
- FR-23. `/docs` dan `/health` tidak memerlukan `X-Role` dan tidak terkena rate limit.

## 6. Aturan bisnis: stage

Stage: `applied`, `screening`, `assessment`, `interview`, `offering`, `hired`, `rejected`, `withdrawn`, `on_hold`.

- Pipeline maju satu arah dan satu langkah: `applied → screening → assessment → interview → offering → hired`.
- Tidak ada pindah mundur.
- `rejected`, `withdrawn`, `on_hold` dapat dicapai dari stage aktif mana saja.
- `hired`, `rejected`, `withdrawn` terminal.
- `on_hold` bukan terminal. Dari sana: `rejected`, `withdrawn`, atau resume ke stage sebelum hold. Tidak boleh langsung ke `hired` atau stage lain.
- Use case `on_hold`: kandidat cadangan saat slot terbatas, menunggu pihak lain, atau kandidat meminta jeda.

Diagram: [erd.md](erd.md#diagram-transisi). Alasan tiap keputusan: [design-decisions.md](design-decisions.md).

## 7. Data model

Empat tabel: `persons`, `stages`, `applications`, `stage_history`. Diagram dan constraint: [erd.md](erd.md).

Poin penting:
- `UNIQUE(person_id, position, batch)` menegakkan satu lamaran per posisi per periode.
- `batch` sebagai kolom membuat lowongan yang dibuka ulang (batch baru) bisa dilamar lagi tanpa logika khusus.
- `stage_history` adalah sumber kebenaran untuk timeline dan resume dari `on_hold`.
- Stage disimpan sebagai tabel yang di-seed idempotent. Aturan transisi tetap di kode, dijaga sinkron oleh satu test.

## 8. Validasi

Nilai batas berikut adalah usulan awal. Ubah jika perlu, lalu samakan dengan [openapi.yaml](openapi.yaml).

| Field | Aturan |
|---|---|
| `name` | wajib, 1 sampai 100 karakter setelah trim |
| `email` | wajib, format email, maks 254, dinormalisasi |
| `phone` | opsional, `+` opsional lalu 8 sampai 15 digit |
| `position` | wajib, 1 sampai 100 karakter |
| `batch` | wajib, 1 sampai 50 karakter |
| `to_stage` | wajib, salah satu code stage |
| `reason` | maks 500; wajib untuk `rejected` dan `withdrawn` |
| `notes` | maks 1000 |
| `:id` | integer positif |
| `limit` | integer 1 sampai 100 |
| `offset` | integer >= 0 |

Validasi dilakukan di batas request (Zod). Field tak dikenal diabaikan.

## 9. Format error dan status

Satu bentuk: `{ "error": { "code", "message", "details" } }`.

| Status | Code | Kapan |
|---|---|---|
| 400 | `INVALID_JSON` | Body bukan JSON valid |
| 400 | `INVALID_ROLE` | `X-Role` hilang atau bukan applicant/recruiter |
| 403 | `FORBIDDEN` | Role tidak berhak |
| 404 | `NOT_FOUND` | Lamaran tidak ada |
| 409 | `DUPLICATE_APPLICATION` | Person sudah melamar posisi + batch yang sama |
| 409 | `INVALID_TRANSITION` | Transisi tidak sah dari stage saat ini |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 10 KB |
| 422 | `VALIDATION_ERROR` | Field tidak valid atau `reason` kurang |
| 429 | `RATE_LIMITED` | Rate limit terlampaui (dengan `Retry-After`) |

Route yang tidak ada mengembalikan 404 `NOT_FOUND`. Error tak terduga mengembalikan 500 tanpa membocorkan detail internal.

## 10. Kebutuhan non-fungsional

**Rate limiting**
- Middleware tulis sendiri, fixed window 1 menit per IP, state in-memory (`Map`).
- Read 60 request/menit, write (`POST`/`PATCH`) 20 request/menit.
- Limit bisa diatur lewat opsi `createApp` agar test tidak terkena batas.
- Keterbatasan: burst di perbatasan window, dan state per proses (tidak berlaku multi-instance).

**Batas body:** 10 KB (`express.json({ limit: "10kb" })`).

**Concurrency:** driver `node:sqlite` sinkron, tidak ada `await` antara baca-cek-tulis, jadi tidak ada race pada satu proses. Transaksi dipakai untuk atomicity, bukan untuk race.

**Caching:** tidak dibuat. Data lokal, query kecil, cache hanya menambah risiko data basi. Jika beban baca naik: `ETag` atau cache di layer list.

**Persistensi:** file SQLite lokal (`applicants.db`, di `.gitignore`). `:memory:` untuk test.

**Observability:** log satu baris per request dengan request ID (jika waktu cukup).

**Portabilitas:** Node >= 24 (memakai `node:sqlite`), tanpa tool berbayar, hanya mock data.

## 11. Testing

Memakai `node:test` dan `fetch` terhadap app dengan DB `:memory:`.

Minimal:
- Create valid, create invalid (tiap field wajib), email dinormalisasi, duplikat 409, person lama dipertahankan.
- Transisi sah dan tidak sah, `reason` wajib, resume dari `on_hold` hanya ke stage sebelum hold, `hired` tidak bisa keluar.
- Hak role: applicant ke stage selain `withdrawn` = 403, applicant `GET /applicants` = 403, `notes` tersembunyi untuk applicant.
- List: filter, default dan maksimum `limit`, `total`.
- Rate limit mengembalikan 429 dengan `Retry-After`.
- Peta transisi sinkron dengan stage hasil seed.
- Setiap path dan method di `openapi.yaml` ada di app (bukan 404), agar spec dan kode tidak menyimpang.
- `/docs` dan `/health` dapat diakses tanpa `X-Role`.

## 12. Kriteria penerimaan

- Semua endpoint di bagian 5.1 berjalan sesuai [openapi.yaml](openapi.yaml).
- `/docs` terbuka setelah `npm start` dan "Try it out" berhasil memanggil endpoint.
- `npm test` hijau dan `npm run typecheck` bersih.
- Contoh request/response di README berasal dari run nyata.
- Restart server tidak menghapus data.
- Semua error memakai bentuk yang sama.

## 13. Deliverables dan submission

- Repository Git: nama `[NamaLengkap]_BackEndEngineer_SKBatch2`, akses "anyone with the link can view".
- README: cara menjalankan, dokumentasi endpoint, contoh request/response, design decisions, catatan penggunaan AI.
- Folder `docs/`: PRD, design decisions, ERD, OpenAPI.
- Catatan AI: tool yang dipakai (Claude Code) dan bantuannya (scaffolding, hint, review, dokumentasi). Keputusan desain dan kode inti oleh kandidat.
- Pengumpulan lewat Google Form sebelum deadline **12 Nov 2026, 23:59 WIB**. Buka link repo di jendela incognito sebelum submit.

## 14. Roadmap post-MVP

1. Autentikasi asli menggantikan `X-Role`. `changed_by` menjadi identitas pengguna. Applicant hanya bisa mengakses lamarannya sendiri.
2. Alur person penuh: `POST /persons`, `PATCH /persons/:id` (edit profil), melamar dengan `person_id`. Skema tidak berubah.
3. Tabel `vacancies` dengan status buka/tutup dan validasi lamaran ke lowongan tertutup.
4. Keyset pagination pada `(created_at, id)` jika data mencapai puluhan ribu baris.
5. Rate limit berbasis Redis untuk multi-instance.
6. `ETag`/caching di endpoint baca jika beban naik.
7. Notifikasi saat stage berubah, dan export data.
8. Migrasi skema berversi (alat migrasi) menggantikan `migrate()` inline.

## 15. Risiko

| Risiko | Mitigasi |
|---|---|
| `X-Role` dipalsukan | Dicatat sebagai keterbatasan; auth di roadmap |
| Id lamaran bisa ditebak, detail terbaca tanpa auth | Dicatat; ownership check bersama auth |
| Fixed window memungkinkan burst | Dicatat; cukup untuk skala MVP |
| Peta transisi dan tabel `stages` tidak sinkron | Test sinkronisasi |
| Scope melebar melewati deadline | Item "jika waktu cukup" dikerjakan terakhir |
| `openapi.yaml` ditulis tangan dan bisa menyimpang dari kode | Test kesesuaian path/method; ubah spec dan kode dalam commit yang sama |

## 16. Rencana kerja

1. Schema dan seed (`src/db.ts`)
2. Peta transisi (`src/stages.ts`)
3. Schema Zod dan format error (`src/schemas.ts`, `src/errors.ts`)
4. Endpoint create, list, detail, update stage
5. Middleware: `X-Role`, rate limit, batas body, error handler
6. Test
7. Swagger UI di `/docs` (`swagger-ui-express` + parser YAML), sekitar 15 menit
8. README, lalu cek akhir dan submit
