// Pure module: no DB, no HTTP. Single source of truth for stage codes and roles.
// Zod can reuse these arrays (z.enum(STAGE_CODES)), so adding a stage means editing one list.
// Keep this list in sync with src/db/seed.ts (a test in test/stages.test.ts should enforce it).

export const STAGE_CODES = [
  "applied",
  "screening",
  "assessment",
  "interview",
  "offering",
  "hired",
  "rejected",
  "withdrawn",
  "on_hold",
] as const;
export type StageCode = (typeof STAGE_CODES)[number];

export const ROLES = ["applicant", "recruiter"] as const;
export type Role = (typeof ROLES)[number];

export const TRANSITIONS: Record<StageCode, StageCode[]> = {
  applied: ["screening", "rejected", "withdrawn", "on_hold"],
  screening:  ["rejected", "assessment", "withdrawn", "on_hold"],
  assessment: ["rejected", "interview", "withdrawn", "on_hold"],
  interview:  ["rejected", "offering", "withdrawn", "on_hold"],
  offering:   ["rejected", "hired", "withdrawn", "on_hold"],
  hired:      [],
  rejected:   [],
  withdrawn:  [],
  on_hold:    ["rejected", "withdrawn"],
};

export function canTransition(from: StageCode, to: StageCode): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function roleCanMoveTo(role: Role, to: StageCode): boolean {
  if (role === "applicant") {
    return to === "withdrawn";
  }
  if (role === "recruiter") {
    return to !== "withdrawn";
  }
  return false;
}

export function reasonRequiredFor(to: StageCode): boolean {
  return to === "rejected" || to === "withdrawn";
}

export function canResumeFromHold(previousStage: StageCode, to: StageCode): boolean {
  return to === previousStage && canTransition(previousStage, "on_hold");
}
