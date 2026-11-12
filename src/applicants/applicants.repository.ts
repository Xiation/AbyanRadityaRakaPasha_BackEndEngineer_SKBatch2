import type { DatabaseSync } from "node:sqlite";
import type { ApplicationRow, PersonRow, ApplicantJoinRow, HistoryJoinRow } from "./applicants.types.ts";
import type { StageCode } from "./stages.ts";
import { ListQuery } from "./applicants.schemas.ts";

export function findPersonByEmail(db: DatabaseSync, email: string): PersonRow | undefined {
  const row = db.prepare("SELECT * FROM persons WHERE email = ?").get(email);
  return row as PersonRow | undefined;
}
export function insertPerson(
  db: DatabaseSync,
  p: { name: string; email: string; phone: string | null },
): number {
  const info = db.prepare("INSERT INTO persons (name, email, phone) VALUES (?, ?, ?)").run(p.name, p.email, p.phone);
  return Number(info.lastInsertRowid)
}

export function findStageId(db: DatabaseSync, code: StageCode): number {
  const row = db.prepare("SELECT id FROM stages WHERE code = ?").get(code) as { id: number } | undefined;
  if (!row) throw new Error(`Stage code not found: ${code}`);
  return row.id as number;
}

export function insertApplication(db: DatabaseSync,
  p: { person_id: number; position: string; batch: string; current_stage_id: number }
): number {
  const info = db.prepare("INSERT INTO applications (person_id, position, batch, current_stage_id) VALUES (?, ?, ?, ?)").run(p.person_id, p.position, p.batch, p.current_stage_id);
  return Number(info.lastInsertRowid)
}

export function findApplication(db: DatabaseSync, personId: number, position: string, batch: string): ApplicationRow | undefined {
  const row = db.prepare(
    "SELECT * FROM applications WHERE person_id = ? AND position = ? AND batch = ?"
  ).get(personId, position, batch);
  return row as ApplicationRow | undefined;
}

export function insertHistory(db: DatabaseSync,
  p: { application_id: number; from_stage_id: number | null; to_stage_id: number; changed_by_role: "applicant" | "recruiter"; reason: string | null; notes: string | null }
): number {
  const info = db.prepare("INSERT INTO stage_history (application_id, from_stage_id, to_stage_id, changed_by_role, reason, notes) VALUES (?, ?, ?, ?, ?, ?)").run(p.application_id, p.from_stage_id, p.to_stage_id, p.changed_by_role, p.reason, p.notes);
  return Number(info.lastInsertRowid)
}

export function updateCurrentStage(db: DatabaseSync, application_id: number, current_stage_id: number): void {
  db.prepare(
    "UPDATE applications SET current_stage_id = ?,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(current_stage_id, application_id);
}

export function findApplicantById(db: DatabaseSync, id: number): ApplicantJoinRow | undefined {
  const row = db.prepare(`
    SELECT a.id, a.position, a.batch, a.created_at, a.updated_at,
           p.id AS person_id, p.name AS person_name, p.email AS person_email, p.phone AS person_phone,
           s.code AS stage_code, s.name AS stage_name
    FROM applications a
    JOIN persons p ON p.id = a.person_id
    JOIN stages  s ON s.id = a.current_stage_id
    WHERE a.id = ?
  `).get(id);
  return row as ApplicantJoinRow | undefined;
}

export function findStageBeforeLastHold(db: DatabaseSync, applicationId: number): StageCode | undefined {
  const row = db.prepare(`
    SELECT s.code FROM stage_history h
    JOIN stages s ON s.id = h.from_stage_id
    WHERE h.application_id = ?
      AND h.to_stage_id = (SELECT id FROM stages WHERE code = 'on_hold')
    ORDER BY h.id DESC LIMIT 1
  `).get(applicationId) as { code: StageCode } | undefined;
  return row?.code;
}

export function listHistory(db: DatabaseSync, applicationId: number): HistoryJoinRow[] {
  const rows = db.prepare(`
    SELECT f.code AS from_stage, t.code AS to_stage, h.changed_by_role, h.reason, h.notes, h.created_at
    FROM stage_history h
    LEFT JOIN stages f ON f.id = h.from_stage_id
    JOIN stages t ON t.id = h.to_stage_id
    WHERE h.application_id = ?
    ORDER BY h.id ASC
  `).all(applicationId);
  return rows as unknown as HistoryJoinRow[];
}

export function listApplicants(db: DatabaseSync, q: ListQuery): { rows: ApplicantJoinRow[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (q.stage)    { where.push("s.code = ?");     params.push(q.stage); }
  if (q.position) { where.push("a.position = ?"); params.push(q.position); }
  if (q.batch)    { where.push("a.batch = ?");    params.push(q.batch); }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const from = `
    FROM applications a
    JOIN persons p ON p.id = a.person_id
    JOIN stages  s ON s.id = a.current_stage_id
    ${whereSql}
  `;

  const total = (db.prepare(`SELECT COUNT(*) AS c ${from}`).get(...params) as { c: number }).c;

  const rows = db.prepare(`
    SELECT a.id, a.position, a.batch, a.created_at, a.updated_at,
           p.id AS person_id, p.name AS person_name, p.email AS person_email, p.phone AS person_phone,
           s.code AS stage_code, s.name AS stage_name
    ${from}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, q.limit, q.offset);

  return { rows: rows as unknown as ApplicantJoinRow[], total };
}
