// Types only. They are erased at runtime and validate nothing: runtime validation of incoming
// data is Zod's job (applicants.schemas.ts, where *Input types come from z.infer).
// This file holds the shapes of (1) database rows and (2) what the service returns to the routes.
// StageCode and Role live in stages.ts so there is one source of truth.

import type { Role, StageCode } from "./stages.ts";

/* -------------------------------------------------------------------------- */
/* 1. Raw table rows. Must match src/db/schema.ts column for column.           */
/*    Nullable column in the schema -> `| null` here.                          */
/* -------------------------------------------------------------------------- */

export interface StageRow {
  id: number;
  code: StageCode;
  name: string;
  sort_order: number;
  is_terminal: number; // SQLite has no boolean: 0 or 1
}

export interface PersonRow {
  id: number;
  name: string;
  email: string; // stored normalized (trim + lowercase)
  phone: string | null;
  created_at: string; // ISO-8601 UTC
}

export interface ApplicationRow {
  id: number;
  person_id: number;
  position: string;
  batch: string;
  current_stage_id: number;
  created_at: string;
  updated_at: string;
}

export interface StageHistoryRow {
  id: number;
  application_id: number;
  from_stage_id: number | null; // null on the initial row written at create
  to_stage_id: number;
  changed_by_role: Role;
  reason: string | null;
  notes: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* 2. Joined query results. Adjust the column aliases to match your SELECTs.   */
/* -------------------------------------------------------------------------- */

// application + person + current stage, for get and list.
export interface ApplicantJoinRow {
  id: number;
  position: string;
  batch: string;
  created_at: string;
  updated_at: string;
  person_id: number;
  person_name: string;
  person_email: string;
  person_phone: string | null;
  stage_code: StageCode;
  stage_name: string;
}

// stage_history with stage ids resolved to codes, for the timeline.
export interface HistoryJoinRow {
  from_stage: StageCode | null;
  to_stage: StageCode;
  changed_by_role: Role;
  reason: string | null;
  notes: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* 3. Response shapes returned by the service. Mirror docs/openapi.yaml.       */
/* -------------------------------------------------------------------------- */

export interface Applicant {
  id: number;
  person: { id: number; name: string; email: string; phone: string | null };
  position: string;
  batch: string;
  stage: { code: StageCode; name: string };
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  from_stage: StageCode | null;
  to_stage: StageCode;
  changed_by_role: Role;
  reason: string | null;
  notes?: string | null; // omitted entirely for role "applicant" (internal recruiter notes)
  created_at: string;
}

export interface ApplicantDetail extends Applicant {
  history: HistoryEntry[]; // oldest first
}

export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface ApplicantList {
  data: Applicant[];
  meta: PageMeta;
}
