import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../db/index.ts";
import { AppError } from "../errors.ts";
import type { Role, StageCode } from "./stages.ts";
import * as stage from "./stages.ts";
import type { CreateApplicantInput,  ListQuery } from "./applicants.schemas.ts";
import * as repo from "./applicants.repository.ts";
import type {
  Applicant, ApplicantJoinRow, HistoryEntry,
  HistoryJoinRow, ApplicantDetail, ApplicantList,
} from "./applicants.types.ts";

export function createApplicant(db: DatabaseSync, input: CreateApplicantInput, role: Role): number {
  // 1. find-or-create person by email (existing person keeps old data)
  // 2. check duplicate (person, position, batch) -> throw AppError(409, "DUPLICATE_APPLICATION") if exists
  // 3. find stage id for "applied"
  // 4. insertApplication({ person_id, position, batch, current_stage_id })
  // 5. insertHistory({ application_id, from_stage_id: null, to_stage_id: <id applied>,
  //                    changed_by_role: role, reason: null, notes: null })
  // 6. return id application from step 4
  return withTransaction(db, () => {
    const existing = repo.findPersonByEmail(db, input.email);
    const personId = existing ? existing.id : repo.insertPerson(db, {
      name: input.name,
      email: input.email,
      phone: input.phone ?? null, // undefined tidak bisa di-bind ke SQLite
    });

    const existingApp = repo.findApplication(db, personId, input.position, input.batch);
    if (existingApp) {
      throw new AppError(409, "DUPLICATE_APPLICATION", "Aplikasi untuk person, posisi, dan batch ini sudah ada");
    }
    const appliedStageId = repo.findStageId(db, "applied");

    const applicationId = repo.insertApplication(db, {
      person_id: personId,
      position: input.position,
      batch: input.batch,
      current_stage_id: appliedStageId,
    });
    repo.insertHistory(db, {
      application_id: applicationId,
      from_stage_id: null,
      to_stage_id: appliedStageId,
      changed_by_role: role,
      reason: null,
      notes: null,
    });
    return applicationId;
  });
}

export function updateStage(db: DatabaseSync, applicationId: number, toStageCode: StageCode, reason: string | null, notes: string | null, role: Role): void {
  return withTransaction(db, () => {
    const application = repo.findApplicantById(db, applicationId)
     if (!application) throw new AppError(404, "NOT_FOUND", "Aplikasi tidak ditemukan");

     if (!stage.roleCanMoveTo(role, toStageCode)) {
       throw new AppError(403, "FORBIDDEN", `Role ${role} tidak boleh pindah ke stage ${toStageCode}`);
     }
     if (!stage.canTransition(application.stage_code, toStageCode)) {
       if (application.stage_code === "on_hold") {
         const beforeLastHold = repo.findStageBeforeLastHold(db, applicationId);
         if (!beforeLastHold || !stage.canResumeFromHold(beforeLastHold, toStageCode)) {
           throw new AppError(409, "INVALID_TRANSITION", `Tidak bisa pindah dari stage ${application.stage_code} ke ${toStageCode}`);
         }
       } else {
         throw new AppError(409, "INVALID_TRANSITION", `Tidak bisa pindah dari stage ${application.stage_code} ke ${toStageCode}`);
       }
     }
     // reason wajib untuk rejected/withdrawn sudah divalidasi di updateStageSchema (route), bukan di sini

     const toStageId = repo.findStageId(db, toStageCode);
     repo.updateCurrentStage(db, applicationId, toStageId);
     repo.insertHistory(db, {
       application_id: applicationId,
       from_stage_id: repo.findStageId(db, application.stage_code),
       to_stage_id: toStageId,
       changed_by_role: role,
       reason,
       notes,
     });
  });
}

function toApplicantDto(row: ApplicantJoinRow): Applicant {
  return {
    id: row.id,
    person: {
      id: row.person_id,
      name: row.person_name,
      email: row.person_email,
      phone: row.person_phone,
    },
    position: row.position,
    batch: row.batch,
    stage: {
      code: row.stage_code,
      name: row.stage_name,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function toHistoryEntry(row: HistoryJoinRow, role: Role) {
  const entry: HistoryEntry = {
    from_stage: row.from_stage,
    to_stage: row.to_stage,
    changed_by_role: row.changed_by_role,
    reason: row.reason,
    created_at: row.created_at,
  };
  if (role === "recruiter") {
    entry.notes = row.notes;
  }
  return entry;
}

export function getApplicant(db: DatabaseSync, id: number, role: Role): ApplicantDetail {
    const row = repo.findApplicantById(db, id);
    if (!row) throw new AppError(404, "NOT_FOUND", "Aplikasi tidak ditemukan");
    const history = repo.listHistory(db, id).map((h) => toHistoryEntry(h, role));
    return { ...toApplicantDto(row), history };
}

export function listApplicants(db: DatabaseSync, query: ListQuery, role: Role): ApplicantList {
  if (role !== "recruiter") throw new AppError(403, "FORBIDDEN", "Hanya recruiter yang boleh melihat daftar pelamar.");
  const { rows, total } = repo.listApplicants(db, query);
  return {
    data: rows.map(toApplicantDto),
    meta: { total, limit: query.limit, offset: query.offset },
  };
}
