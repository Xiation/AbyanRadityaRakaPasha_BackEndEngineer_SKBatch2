# ERD

Diagram ditulis dengan Mermaid. Tampil otomatis di GitHub, atau buka di <https://mermaid.live> (tempel isi blok `mermaid`), atau ekstensi "Markdown Preview Mermaid Support" di VS Code.

```mermaid
erDiagram
    PERSONS ||--o{ APPLICATIONS : "melamar"
    STAGES  ||--o{ APPLICATIONS : "stage saat ini"
    APPLICATIONS ||--|{ STAGE_HISTORY : "memiliki riwayat"
    STAGES  ||--o{ STAGE_HISTORY : "from_stage"
    STAGES  ||--o{ STAGE_HISTORY : "to_stage"

    PERSONS {
        integer id PK
        text    name         "NOT NULL"
        text    email        "NOT NULL, UNIQUE, trim+lowercase"
        text    phone        "NULL, opsional"
        text    created_at   "NOT NULL, ISO-8601 UTC"
    }

    STAGES {
        integer id PK
        text    code         "NOT NULL, UNIQUE, mis. interview"
        text    name         "NOT NULL, label tampilan"
        integer sort_order   "NOT NULL, urutan pipeline"
        integer is_terminal  "NOT NULL, 0 atau 1"
    }

    APPLICATIONS {
        integer id PK
        integer person_id        FK "NOT NULL"
        text    position         "NOT NULL"
        text    batch            "NOT NULL, mis. SKBatch2"
        integer current_stage_id FK "NOT NULL"
        text    created_at       "NOT NULL, ISO-8601 UTC"
        text    updated_at       "NOT NULL, ISO-8601 UTC"
    }

    STAGE_HISTORY {
        integer id PK
        integer application_id FK "NOT NULL"
        integer from_stage_id  FK "NULL pada baris awal"
        integer to_stage_id    FK "NOT NULL"
        text    changed_by_role    "NOT NULL, applicant atau recruiter"
        text    reason             "NULL, wajib utk rejected dan withdrawn"
        text    notes              "NULL, internal recruiter"
        text    created_at         "NOT NULL, ISO-8601 UTC"
    }
```

## Constraint dan index

- `persons.email`: `UNIQUE`. Nilai disimpan setelah trim + lowercase.
- `stages.code`: `UNIQUE`.
- `applications`: `UNIQUE(person_id, position, batch)`. Satu orang, satu lamaran per posisi per periode.
- `applications.current_stage_id`: index, karena filter `stage` di list.
- `stage_history.application_id`: index, untuk membaca timeline satu lamaran.
- Foreign key aktif (`PRAGMA foreign_keys = ON`, per koneksi). Semua foreign key memakai `ON DELETE RESTRICT`: data turunan, terutama `stage_history` sebagai jejak audit, tidak boleh hilang karena cascade.

## Daftar stage (seed)

| sort_order | code | is_terminal |
|---|---|---|
| 1 | applied | 0 |
| 2 | screening | 0 |
| 3 | assessment | 0 |
| 4 | interview | 0 |
| 5 | offering | 0 |
| 6 | hired | 1 |
| 7 | rejected | 1 |
| 8 | withdrawn | 1 |
| 9 | on_hold | 0 |

## Diagram transisi

```mermaid
stateDiagram-v2
    [*] --> applied : create
    applied --> screening
    screening --> assessment
    assessment --> interview
    interview --> offering
    offering --> hired

    applied --> on_hold
    screening --> on_hold
    assessment --> on_hold
    interview --> on_hold
    offering --> on_hold
    on_hold --> applied : resume ke stage sebelum hold
    on_hold --> screening : resume
    on_hold --> assessment : resume
    on_hold --> interview : resume
    on_hold --> offering : resume

    applied --> rejected
    screening --> rejected
    assessment --> rejected
    interview --> rejected
    offering --> rejected
    on_hold --> rejected

    applied --> withdrawn
    screening --> withdrawn
    assessment --> withdrawn
    interview --> withdrawn
    offering --> withdrawn
    on_hold --> withdrawn

    hired --> [*]
    rejected --> [*]
    withdrawn --> [*]
```

Catatan: dari `on_hold`, resume hanya diizinkan ke satu stage, yaitu stage sebelum di-hold (dibaca dari `stage_history`). Diagram menampilkan semua kemungkinan, server hanya menerima satu.
