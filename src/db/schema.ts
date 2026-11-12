import type { DatabaseSync } from "node:sqlite";

// Schema only (idempotent: CREATE ... IF NOT EXISTS). Seed data lives in seed.ts.
export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stages (
       id          INTEGER PRIMARY KEY,
       code        TEXT    NOT NULL UNIQUE,
       name        TEXT    NOT NULL,
       sort_order  INTEGER NOT NULL,
       is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1))
     );

     CREATE TABLE IF NOT EXISTS persons (
       id          INTEGER PRIMARY KEY,
       name        TEXT    NOT NULL,
       email       TEXT    NOT NULL UNIQUE,
       phone       TEXT,
       created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     );
     CREATE TABLE IF NOT EXISTS applications (
       id               INTEGER PRIMARY KEY,
       person_id        INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
       position         TEXT    NOT NULL,
       batch            TEXT    NOT NULL,
       current_stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
       created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       UNIQUE (person_id, position, batch)
     );
     CREATE INDEX IF NOT EXISTS idx_applications_current_stage ON applications(current_stage_id);

     CREATE TABLE IF NOT EXISTS stage_history (
        id              INTEGER PRIMARY KEY,
        application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
        from_stage_id   INTEGER REFERENCES stages(id) ON DELETE RESTRICT,
        to_stage_id     INTEGER NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
        changed_by_role TEXT    NOT NULL CHECK (changed_by_role IN ('applicant', 'recruiter')),
        reason          TEXT,
        notes           TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     );
     CREATE INDEX IF NOT EXISTS idx_stage_history_applications ON stage_history(application_id);
  `);
}
