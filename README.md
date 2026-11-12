# Applicant Records API

A small back-end service for recording job applicants and moving them through a recruitment pipeline (a minimal ATS).
It was built for the Sekolah Karir **Back-End Engineer** mini assignment (SKBatch2).

- Create an application, list applications (filter + pagination), read one application with its full stage history, and move an application to another stage.
- The pipeline is a **state machine**: illegal moves (skipping a stage, leaving a terminal stage, resuming from "on hold" to the wrong stage) are rejected with `409`.
- Every stage change is written to an **audit trail** (`stage_history`), including who (role) did it and why.
- All data is mock data. No paid tools or external services are used.

**Author:** Abyan Raditya Raka Pasha

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [Quick start](#quick-start)
3. [API documentation](#api-documentation)
4. [Endpoints with real examples](#endpoints-with-real-examples)
5. [Stage workflow](#stage-workflow)
6. [Validation rules](#validation-rules)
7. [Error format](#error-format)
8. [Rate limiting](#rate-limiting)
9. [Operational behavior](#operational-behavior)
10. [Data model](#data-model)
11. [Design decisions](#design-decisions)
12. [Project structure](#project-structure)
13. [Testing](#testing)
14. [Security notes and known limitations](#security-notes-and-known-limitations)
15. [Future improvements](#future-improvements)
16. [AI usage disclosure](#ai-usage-disclosure)

---

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (run with `tsx`, checked with `tsc --noEmit`) | Types for rows, DTOs and Zod-inferred inputs catch mistakes early. |
| HTTP | Express 5 | Familiar, and Express 5 forwards errors thrown in sync/async handlers to the error middleware. |
| Database | SQLite through the built-in `node:sqlite` | Zero setup and no native build step. Satisfies "in-memory/SQLite" in the brief. File on disk for persistence, `:memory:` in tests. |
| Validation | Zod 4 | One schema gives runtime validation, coercion, normalization and the TypeScript type (`z.infer`). |
| Tests | `node:test` + `fetch` | No test framework dependency; tests run against a real HTTP server with an in-memory DB. |
| Docs | OpenAPI 3.0 + Swagger UI | The YAML file is the contract and also drives the interactive UI at `/docs`. |

Runtime dependencies: `express`, `zod`, `swagger-ui-express`, `yaml`.

## Quick start

Requirements: **Node.js >= 24** (uses `node:sqlite`) and npm.

```bash
npm install
npm run dev        # watch mode, http://localhost:3000
# or
npm start          # plain start
```

Open **http://localhost:3000/docs** for the interactive Swagger UI.

Environment variables (both optional, validated at startup; an invalid value stops the process with exit code 1 and a clear message):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port, integer 1 to 65535 |
| `DB_PATH` | `applicants.db` | SQLite file. Use `:memory:` for a throwaway database. |

The database file and the stage seed data are created automatically on first start (idempotent migration, safe on every start).

Other scripts:

```bash
npm test           # run all tests (node:test)
npm run typecheck  # tsc --noEmit
```

Quick smoke test:

```bash
curl -s http://localhost:3000/health
# {"status":"ok"}
```

## API documentation

| What | Where |
|---|---|
| Interactive docs (Swagger UI) | `GET /docs` |
| Raw OpenAPI spec (JSON) | `GET /openapi.json` |
| OpenAPI source | [`docs/openapi.yaml`](docs/openapi.yaml) |
| Product requirements | [`docs/PRD.md`](docs/PRD.md) |
| Design decisions and trade-offs | [`docs/design-decisions.md`](docs/design-decisions.md) |
| ER diagram + state diagram | [`docs/erd.md`](docs/erd.md) |

A test (`kontrak: setiap path + method di openapi.yaml ada di app`) fails if the spec lists an operation the app does not serve, so the documentation cannot silently drift from the code.

### Roles

Every `/v1/applicants` endpoint requires the header `X-Role: applicant` or `X-Role: recruiter`. A missing or unknown value returns `400 INVALID_ROLE`.

| Capability | `applicant` | `recruiter` |
|---|---|---|
| Create an application | yes | yes |
| Read one application (`GET /v1/applicants/:id`) | yes (internal `notes` hidden) | yes (sees `notes`) |
| List applications (`GET /v1/applicants`) | **no** (`403`) | yes |
| Move to `withdrawn` | yes | **no** (`403`) |
| Move to any other stage | **no** (`403`) | yes |

> The role is **simulated** by a header to demonstrate role-based rules without building an auth system. It is not authentication and can be forged. See [Security notes](#security-notes-and-known-limitations).

## Endpoints with real examples

Base URL: `http://localhost:3000`. The business API is versioned under **`/v1`**; `/health`, `/docs` and `/openapi.json` are not. All outputs below are real responses from the running server.

Every response carries an `X-Request-Id` header, and every `/v1/applicants` response carries `Cache-Control: no-store` (the bodies contain personal data). Methods a path does not support get `405` with an `Allow` header, and a request body that is not JSON gets `415`.

| Method | Path | Purpose | Success |
|---|---|---|---|
| `GET` | `/health` | Liveness + database check (no role needed) | `200`, or `503` if the DB cannot answer |
| `POST` | `/v1/applicants` | Create an application | `201` + `Location` header |
| `GET` | `/v1/applicants` | List with filters and pagination (recruiter only) | `200` |
| `GET` | `/v1/applicants/:id` | One application with stage history | `200` |
| `PATCH` | `/v1/applicants/:id/stage` | Move to another stage | `200` |

### Create an applicant: `POST /v1/applicants`

```bash
curl -i -X POST http://localhost:3000/v1/applicants \
  -H 'Content-Type: application/json' \
  -H 'X-Role: applicant' \
  -d '{
    "name": "Abyan Raditya",
    "email": "Abyan@Example.com",
    "phone": "+6281234567890",
    "position": "Back-End Engineer",
    "batch": "SKBatch2"
  }'
```

`201 Created`, `Location: /v1/applicants/1`

```json
{
  "id": 1,
  "person": { "id": 1, "name": "Abyan Raditya", "email": "abyan@example.com", "phone": "+6281234567890" },
  "position": "Back-End Engineer",
  "batch": "SKBatch2",
  "stage": { "code": "applied", "name": "Applied" },
  "created_at": "2026-11-12T15:22:26.227Z",
  "updated_at": "2026-11-12T15:22:26.227Z",
  "history": [
    { "from_stage": null, "to_stage": "applied", "changed_by_role": "applicant", "reason": null, "created_at": "2026-11-12T15:22:26.227Z" }
  ]
}
```

Notes: the email was normalized (trimmed + lowercased). `phone` is optional. A new application always starts at `applied`, and the first history row has `from_stage: null`.

### Move to another stage: `PATCH /v1/applicants/:id/stage`

```bash
curl -X PATCH http://localhost:3000/v1/applicants/1/stage \
  -H 'Content-Type: application/json' \
  -H 'X-Role: recruiter' \
  -d '{ "to_stage": "screening", "notes": "CV matches the role" }'
```

`200 OK`. The full application is returned (abridged):

```json
{
  "id": 1,
  "stage": { "code": "screening", "name": "Screening" },
  "updated_at": "2026-11-12T15:22:26.328Z",
  "history": [
    { "from_stage": null, "to_stage": "applied", "changed_by_role": "applicant", "reason": null, "notes": null, "created_at": "2026-11-12T15:22:26.227Z" },
    { "from_stage": "applied", "to_stage": "screening", "changed_by_role": "recruiter", "reason": null, "notes": "CV matches the role", "created_at": "2026-11-12T15:22:26.328Z" }
  ]
}
```

Body fields: `to_stage` (required, one of the nine stage codes), `reason` (**required** for `rejected` and `withdrawn`, max 500), `notes` (optional internal note, max 1000).

### List applicants: `GET /v1/applicants`

```bash
curl 'http://localhost:3000/v1/applicants?stage=screening&position=Back-End%20Engineer&limit=10&offset=0' \
  -H 'X-Role: recruiter'
```

```json
{
  "data": [
    {
      "id": 1,
      "person": { "id": 1, "name": "Abyan Raditya", "email": "abyan@example.com", "phone": "+6281234567890" },
      "position": "Back-End Engineer",
      "batch": "SKBatch2",
      "stage": { "code": "screening", "name": "Screening" },
      "created_at": "2026-11-12T15:22:26.227Z",
      "updated_at": "2026-11-12T15:22:26.328Z"
    }
  ],
  "meta": { "total": 1, "limit": 10, "offset": 0 }
}
```

| Query param | Meaning | Default / limits |
|---|---|---|
| `stage` | exact stage code | one of the nine codes |
| `position` | exact match | max 100 chars |
| `batch` | exact match | max 50 chars |
| `limit` | page size | default 20, 1 to 100 |
| `offset` | rows to skip | default 0, >= 0 |

Order is `created_at DESC, id DESC` (newest first, `id` as tie-breaker). `meta.total` is the count **before** pagination.

### Read one application: `GET /v1/applicants/:id`

```bash
curl http://localhost:3000/v1/applicants/1 -H 'X-Role: applicant'
```

Same body as the create response, with the whole `history` (oldest first). For the `applicant` role the `notes` field is **omitted from every history entry** (not set to `null`), because notes are internal to recruiters.

## Stage workflow

Stages are rows in the `stages` table (seeded), while the transition rules live in code (`src/applicants/stages.ts`) as pure, unit-tested functions.

```
applied -> screening -> assessment -> interview -> offering -> hired (terminal)

any active stage -> rejected  (terminal, reason required)
any active stage -> withdrawn (terminal, reason required, applicant only)
any active stage -> on_hold
on_hold -> rejected | withdrawn | back to the stage it came from (and only that one)
```

Active stages: `applied`, `screening`, `assessment`, `interview`, `offering`. Terminal stages: `hired`, `rejected`, `withdrawn` (no way out).

Checks run in this order inside one transaction, which also decides the status code:

1. Application exists, otherwise `404 NOT_FOUND`.
2. The role may move to that stage, otherwise `403 FORBIDDEN`.
3. The transition is legal, otherwise `409 INVALID_TRANSITION`.
4. Update `current_stage_id` and `updated_at`, and append a `stage_history` row.

(`reason` for `rejected`/`withdrawn` is validated earlier, at the request boundary, as `422 VALIDATION_ERROR`.)

## Validation rules

Validation happens at the HTTP boundary with Zod. The parsed result is trimmed/normalized and typed, and failures return `422` with one entry per field.

| Field | Rule |
|---|---|
| `name` | required, 1 to 100 chars, no control characters |
| `email` | required, trimmed + lowercased, valid email, max 254 |
| `phone` | optional, `+` optional then 8 to 15 digits (`^\+?[0-9]{8,15}$`) |
| `position` | required, 1 to 100 chars, no control characters |
| `batch` | required, 1 to 50 chars, no control characters |
| `:id` | plain positive integer (`1e3`, `0x10`, `1.0`, `-1`, `0` are rejected) |
| `to_stage` | one of the nine stage codes |
| `reason` | max 500; required when `to_stage` is `rejected` or `withdrawn` |
| `notes` | max 1000 |
| request body | JSON, max 10 KB |

Control characters (null byte, tab, newline, DEL) are rejected in `name`, `position` and `batch` because they make two visually identical values different in the database, which would defeat the unique constraint. Unknown fields in the body are ignored (so `id`, `stage`, `created_at` cannot be injected).

## Error format

Every error, including unknown routes and framework errors, uses one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Input tidak valid.", "details": [ { "field": "email", "message": "Invalid email address" } ] } }
```

`code` is stable and machine-readable. `details` is always an array (empty when not applicable). Real examples:

**422 validation** (`POST /v1/applicants` with an empty name, bad email, missing batch):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Input tidak valid.",
    "details": [
      { "field": "name", "message": "Too small: expected string to have >=1 characters" },
      { "field": "email", "message": "Invalid email address" },
      { "field": "batch", "message": "Invalid input: expected string, received undefined" }
    ]
  }
}
```

**409 illegal transition** (`screening` to `offering`):

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "Tidak bisa pindah dari stage screening ke offering", "details": [] } }
```

**405 wrong method** (`DELETE /v1/applicants`, response carries `Allow: GET, POST, HEAD, OPTIONS`):

```json
{ "error": { "code": "METHOD_NOT_ALLOWED", "message": "Method DELETE tidak didukung di path ini. Gunakan: GET, POST, HEAD, OPTIONS.", "details": [] } }
```

**415 wrong media type** (body sent as `text/plain`):

```json
{ "error": { "code": "UNSUPPORTED_MEDIA_TYPE", "message": "Content-Type harus application/json.", "details": [] } }
```

**429 rate limited** (response also carries `Retry-After: 60`):

```json
{ "error": { "code": "RATE_LIMITED", "message": "Terlalu banyak request. Coba lagi dalam 60 detik.", "details": [] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_JSON` | malformed JSON body |
| 400 | `INVALID_ROLE` | `X-Role` missing or not `applicant`/`recruiter` |
| 403 | `FORBIDDEN` | role is not allowed (list as applicant, wrong stage for the role) |
| 404 | `NOT_FOUND` | unknown application id or unknown route |
| 409 | `DUPLICATE_APPLICATION` | same person + position + batch already exists |
| 405 | `METHOD_NOT_ALLOWED` | known path, unsupported method (see the `Allow` header) |
| 409 | `INVALID_TRANSITION` | stage move not allowed by the state machine |
| 413 | `PAYLOAD_TOO_LARGE` | body over 10 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | request has a body but `Content-Type` is not `application/json` |
| 422 | `VALIDATION_ERROR` | any field failed validation (see `details`) |
| 429 | `RATE_LIMITED` | rate limit exceeded |
| 500 | `INTERNAL_ERROR` | unexpected bug; generic message, details only in the server log |

Error `message` texts are written in Indonesian (the target users), except validation messages that come from Zod, which are in English. Clients should rely on `code` and `details[].field`, not on message text.

## Rate limiting

Fixed window of 1 minute per client IP, with separate budgets: **60 reads** (`GET`) and **20 writes** (every other method, mainly `POST`/`PATCH`). Exceeding it returns `429` with a `Retry-After` header (seconds). `/health` and `/docs` are not limited. Limits are injectable (`createApp(db, { rateLimit })`), which is how the tests avoid throttling themselves and how the 429 behavior is tested with tiny limits.

## Operational behavior

- **Configuration** (`src/config.ts`): `PORT` and `DB_PATH` are parsed and validated with Zod at startup. `PORT=abc` or `PORT=70000` exits immediately with `Invalid configuration (PORT: ...)` instead of failing later inside `listen()`.
- **Health** (`GET /health`): runs `SELECT 1`. Returns `{"status":"ok"}`, or `503 {"status":"unavailable"}` when the database cannot answer, so an orchestrator or load balancer can react.
- **Request id and logging** (`src/middleware/requestLogger.ts`): each request gets an id (a client-supplied `X-Request-Id` is reused only if it matches `[A-Za-z0-9._-]{1,64}`, otherwise a UUID is generated), returned in the `X-Request-Id` response header. The server prints one JSON line per request, for example:
  `{"ts":"2026-11-12T15:53:21.380Z","id":"a41f5bc7-...","method":"POST","path":"/v1/applicants","status":415,"ms":2.6}`.
  The log deliberately contains no query string, body, headers or IP address, because those can hold personal data. Unexpected errors (500) are logged with the same id so a report can be traced.
- **Graceful shutdown** (`src/server.ts`): on `SIGTERM` or `SIGINT` the server stops accepting connections, lets in-flight requests finish, closes the SQLite database, and exits with code 0. A 10-second timer forces exit if something hangs.

## Data model

Four tables (details and diagram in [`docs/erd.md`](docs/erd.md)):

| Table | Purpose |
|---|---|
| `stages` | Seeded lookup: `code` (unique), `name`, `sort_order`, `is_terminal`. |
| `persons` | A human: `name`, `email` (unique, normalized), optional `phone`. |
| `applications` | A person applying to a `position` in a `batch`; points to `current_stage_id`. `UNIQUE(person_id, position, batch)`. |
| `stage_history` | Append-only audit trail: `from_stage_id` (NULL for the first row), `to_stage_id`, `changed_by_role`, `reason`, `notes`, `created_at`. |

- Foreign keys are enforced (`PRAGMA foreign_keys = ON`) and all use `ON DELETE RESTRICT`, so history can never disappear through a cascade.
- Timestamps are ISO-8601 UTC strings (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`).
- Index on `applications.current_stage_id` (stage filter) and `stage_history.application_id` (timeline).

## Design decisions

The long version, with alternatives considered, is in [`docs/design-decisions.md`](docs/design-decisions.md). The short version:

1. **Person and application are separate tables.** One person can apply to several positions or batches without duplicating their data, and the duplicate rule becomes `UNIQUE(person_id, position, batch)`. If the email already exists, the stored person data is kept and the new `name`/`phone` are ignored, so a later request cannot overwrite someone else's data.
2. **Stages in a table, rules in code.** Labels and ordering are data; transition rules are pure functions that are easy to unit test. A test checks that the code's stage list and transition map stay in sync with the seeded rows.
3. **Audit trail instead of only a `stage` column.** `stage_history` answers "who moved this application, when, and why", and also makes "resume from on hold" possible, because the previous stage is read from history.
4. **`on_hold` is reversible, but only to where it came from.** Resuming to a different stage would bypass the pipeline.
5. **Three layers.** Routes (HTTP + validation), service (business rules + transactions), repository (plain SQL). Rules are testable without HTTP and SQL is in one place.
6. **Centralized errors.** Code throws `AppError(status, code, message, details)`; one error handler renders the single error shape, translates body-parser errors (`INVALID_JSON`, `PAYLOAD_TOO_LARGE`), and hides internals for unexpected errors.
7. **Offset pagination** with a stable order (`created_at DESC, id DESC`). Simple and enough for this scale; the order is already compatible with a future switch to keyset/cursor pagination.
8. **Transactions** wrap create (person + application + first history row) and stage update (update + history row) so a failure never leaves half-written data.
9. **Parameterized SQL only.** Filter values always go through `?` placeholders; only fixed fragments are concatenated into the query text.
10. **URL versioning (`/v1`).** A breaking change can ship as `/v2` while `/v1` keeps working. Operational endpoints (`/health`, `/docs`) are outside the version on purpose.
11. **Correct HTTP semantics for the unhappy paths.** `405` + `Allow` (instead of a misleading 404) for wrong methods, `415` for non-JSON bodies, `Cache-Control: no-store` for personal data, `201` + `Location` for creation.

## Project structure

```
src/
  server.ts                  process entry: config, DB, listen, graceful shutdown
  config.ts                  loadConfig(env): validated PORT / DB_PATH
  app.ts                     createApp(db, options): middleware order and route mounting
  docs.ts                    Swagger UI at /docs and the spec at /openapi.json
  errors.ts                  AppError
  helper/validate.ts         parseOrThrow(schema, data): Zod -> 422 VALIDATION_ERROR
  middleware/
    requestLogger.ts         X-Request-Id + one JSON log line per request
    httpGuards.ts            no-store header, 415 media-type check, 405 + Allow helper
    role.ts                  X-Role check (simulated role)
    rateLimit.ts             fixed-window limiter (injectable limits)
    errorHandler.ts          404 handler + central error handler
  db/
    index.ts                 openDb(), withTransaction()
    schema.ts                CREATE TABLE ... IF NOT EXISTS
    seed.ts                  idempotent stage seed
  applicants/
    stages.ts                stage codes, transition map, role/reason rules (pure)
    applicants.schemas.ts    Zod schemas and inferred input types
    applicants.types.ts      row, join-row and response types
    applicants.repository.ts SQL only
    applicants.service.ts    business rules and transactions
    applicants.routes.ts     HTTP only
test/                        db, stage rules, config, process-level and HTTP integration tests
docs/                        PRD, design decisions, ERD, OpenAPI
```

## Testing

```bash
npm test
```

70 tests (`node:test`), no mocks of the database or HTTP:

- `test/stages.test.ts`: the pure state-machine rules, checked against an explicit list of the legal moves for all 81 (from, to) pairs (forward steps, skips, going backwards, terminal stages, role permissions, reason rules, resume from hold), plus a sync check against the seeded stages.
- `test/db.test.ts`: migration creates all tables and seeds nine stages, migration is idempotent, `ON DELETE RESTRICT` blocks deleting a person with applications, the unique constraint on person + position + batch.
- `test/applicants.test.ts`: the HTTP API against a real server on a random port with an in-memory DB: create/duplicate/normalization, validation errors, role errors, malformed and oversized bodies, every stage rule including on-hold resume, history order, `notes` visibility per role, list filters and pagination, rate limiting (429 + window recovery), `/v1` versioning, `405`/`415`/`no-store`, request id and the privacy of the log line, `/health` 200 and 503, `/docs`, a spec-vs-app contract check, and the security regressions listed below.
- `test/config.test.ts`: defaults, coercion, boundaries and fail-fast messages of the environment config.
- `test/server.test.ts`: starts the real process and checks graceful shutdown on `SIGTERM` and `SIGINT` (exit code 0) and that an invalid `PORT` exits with code 1.

I also checked test strength by hand with mutation testing: deliberately breaking the code (removing the 403 check, leaking `notes`, ignoring a filter, reversing history order, dropping `updated_at`, and so on) and confirming at least one test fails for each mutation.

## Security notes and known limitations

A short security review was done by reading the code and attacking the running server. Findings and what was done:

**Checked and fine**

- SQL injection: all values are bound parameters (tried `' OR 1=1--` in filters and ids).
- Mass assignment: unknown body fields are dropped by Zod; `id`, `stage`, `created_at` cannot be set by a client.
- Prototype pollution payloads (`__proto__`, `constructor`) have no effect.
- Oversized bodies, malformed JSON, wrong content types, arrays and primitives as bodies all return clean 4xx errors. Unexpected errors return a generic 500 and are only logged server-side.
- `npm audit`: 0 known vulnerabilities at the time of writing.

**Hardened during the review** (each has a regression test)

- Removed the `X-Powered-By` header and added `X-Content-Type-Options: nosniff`.
- Strict `:id` parsing (previously `1e3` and `0x10` were accepted as ids).
- Length limits on list filters; control characters rejected in free-text fields.

**Known limitations (intentional for this scope)**

1. **No real authentication or authorization (most important).** `X-Role` is only a declaration, so anyone can claim `recruiter`. Even as `applicant`, a caller can read or withdraw **someone else's** application by guessing ids (an object-level authorization gap, a.k.a. IDOR/BOLA). The fix for production is token-based auth (for example JWT carrying `person_id` and `role`), an ownership check in the service layer, and non-sequential public ids (UUIDs).
2. **Email is not verified.** Anyone can submit an application using someone else's email address (the existing person's data is never overwritten, though).
3. **Rate limiter state is in-memory.** It is per process (not shared across instances; production would use Redis), entries are never purged (unbounded growth under many distinct IPs), and `HEAD`/`OPTIONS` count against the write budget. Behind a reverse proxy you must set `app.set('trust proxy', ...)`, otherwise all clients share one IP; it is deliberately left off so clients cannot spoof `X-Forwarded-For`.
4. **Free text is stored as-is.** The API only emits JSON, but a front end that renders `name` must escape it (for example `<script>` is stored verbatim).
5. **Phone numbers are validated but not normalized or unique.** `0812...` and `+62812...` are different values. Email is the identity key.
6. **Error `message` language is mixed** (Indonesian from the app, English from Zod). `code` is the stable contract.
7. **No HTTPS or CORS configuration.** Intended to run behind a reverse proxy. Without a CORS policy, browsers block cross-origin calls to the API by default. Request logging exists but is minimal (no log levels, rotation or shipping).
8. **Offset pagination** can skip or repeat rows when data changes between page requests; keyset pagination is the upgrade path.

## Future improvements

Ideas that are deliberately out of scope for this assignment, roughly in order of value:

1. **Optimistic locking for stage changes.** Today two recruiters can act on stale information (one rejects an application that the other has just moved forward; both moves are individually legal). Return an `ETag` (for example derived from `updated_at`) on reads and require `If-Match` on `PATCH`, answering `412 Precondition Failed` on a mismatch; in SQL, `UPDATE ... WHERE id = ? AND updated_at = ?` and check `changes`. For multi-process deployments also use `BEGIN IMMEDIATE`, `busy_timeout` and WAL mode.
2. **Authentication and ownership checks** (see the first limitation above).
3. **`RateLimit-*` headers on every response** (limit, remaining, reset), a purge of expired limiter entries, `HEAD`/`OPTIONS` counted as reads, and `trust proxy` when deployed behind one.
4. **`Idempotency-Key` for `POST`**, so a retried request returns the original result instead of `409`.
5. **Outbox pattern for stage-change events**: write an event row in the same transaction as the change, and let a separate worker deliver emails or webhooks. `stage_history` is already most of the way there.
6. **Keyset (cursor) pagination**, phone normalization, editing person data, and soft delete / data-erasure for privacy.

## AI usage disclosure

The assignment allows AI tools as long as their use is logged. This is the log.

**Tools used**

| Tool | Used for |
|---|---|
| **Claude Code** (Anthropic's Claude, in the terminal) | Main assistant for the whole project: requirements and design discussion, project scaffolding, writing documentation, coaching while I wrote the core code, code review, stress tests, the security review, and writing most integration tests and this README. |
| **opencode** with a **DeepSeek** model | Drafted a first version of the stage unit tests early on. That version was later fully replaced by a rewrite done with Claude Code, so no opencode output remains in the repository. |

**How the work was split**

- **Decisions (mine):** domain and data model, stage list and transition rules, the on-hold behavior, who can do what, pagination style, error codes, which items are in or out of scope. The assistant asked guiding questions and laid out trade-offs; I chose.
- **Code and documents (AI-assisted):** all code in this repository (source, tests, and configuration) and all documents (this README, `docs/`: PRD, ERD, OpenAPI, design decisions) were produced with AI assistance. I typed parts of the core code (database schema, stage rules, Zod schemas, repository, service, routes, role and rate-limit middleware) following the assistant's hints, skeletons and examples, and the assistant wrote the rest directly: project boilerplate, error handling and validation helpers, some SQL queries, the Swagger setup, most tests (marked with comments in the test files), and the documents. Every part was reviewed by me.
- **Verification:** each piece was run (typecheck, tests, curl against a live server). The assistant also attacked the running API (security review) and used mutation testing to check that the tests catch real bugs.
