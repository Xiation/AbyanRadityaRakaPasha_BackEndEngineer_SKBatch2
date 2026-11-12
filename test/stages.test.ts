// Unit tests for the pure state-machine rules in src/applicants/stages.ts (no HTTP, no DB except the sync check).
// Written with the AI assistant (Claude Code). The expected rules below are spelled out independently of
// TRANSITIONS, so a mistake in stages.ts cannot "agree with itself".
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.ts";
import {
  canTransition,
  roleCanMoveTo,
  reasonRequiredFor,
  canResumeFromHold,
  TRANSITIONS,
  STAGE_CODES,
  ROLES,
  type StageCode,
} from "../src/applicants/stages.ts";

const FORWARD_CHAIN = ["applied", "screening", "assessment", "interview", "offering", "hired"] as const;
const ACTIVE = ["applied", "screening", "assessment", "interview", "offering"] as const;
const TERMINAL = ["hired", "rejected", "withdrawn"] as const;

// The whole rulebook as an explicit list of legal (from -> to) pairs.
const LEGAL = new Set<string>([
  "applied>screening",
  "screening>assessment",
  "assessment>interview",
  "interview>offering",
  "offering>hired",
  ...ACTIVE.flatMap((from) => [`${from}>rejected`, `${from}>withdrawn`, `${from}>on_hold`]),
  "on_hold>rejected",
  "on_hold>withdrawn",
]);

test("canTransition matches the explicit rulebook for all 81 (from, to) pairs", () => {
  for (const from of STAGE_CODES) {
    for (const to of STAGE_CODES) {
      assert.equal(canTransition(from, to), LEGAL.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
});

test("the happy path moves forward exactly one step at a time", () => {
  for (let i = 0; i < FORWARD_CHAIN.length - 1; i++) {
    assert.equal(canTransition(FORWARD_CHAIN[i], FORWARD_CHAIN[i + 1]), true, `${FORWARD_CHAIN[i]} -> ${FORWARD_CHAIN[i + 1]}`);
  }
});

test("skipping a stage is rejected for every forward pair", () => {
  for (let i = 0; i < FORWARD_CHAIN.length; i++) {
    for (let j = i + 2; j < FORWARD_CHAIN.length; j++) {
      assert.equal(canTransition(FORWARD_CHAIN[i], FORWARD_CHAIN[j]), false, `${FORWARD_CHAIN[i]} -> ${FORWARD_CHAIN[j]}`);
    }
  }
});

test("going backwards is rejected for every forward pair", () => {
  for (let i = 0; i < FORWARD_CHAIN.length; i++) {
    for (let j = 0; j < i; j++) {
      assert.equal(canTransition(FORWARD_CHAIN[i], FORWARD_CHAIN[j]), false, `${FORWARD_CHAIN[i]} -> ${FORWARD_CHAIN[j]}`);
    }
  }
});

test("staying in the same stage is never a transition", () => {
  for (const stage of STAGE_CODES) {
    assert.equal(canTransition(stage, stage), false, stage);
  }
});

test("every active stage can go to rejected, withdrawn and on_hold", () => {
  for (const from of ACTIVE) {
    for (const to of ["rejected", "withdrawn", "on_hold"] as const) {
      assert.equal(canTransition(from, to), true, `${from} -> ${to}`);
    }
  }
});

test("terminal stages have no way out", () => {
  for (const from of TERMINAL) {
    assert.deepEqual(TRANSITIONS[from], [], `${from} should map to an empty list`);
    for (const to of STAGE_CODES) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
    }
  }
});

test("on_hold can only go to rejected or withdrawn (resume is a separate rule)", () => {
  const allowed = STAGE_CODES.filter((to) => canTransition("on_hold", to));
  assert.deepEqual([...allowed].sort(), ["rejected", "withdrawn"]);
});

test("role rules: applicant may only withdraw, recruiter may do everything except withdraw", () => {
  for (const to of STAGE_CODES) {
    assert.equal(roleCanMoveTo("applicant", to), to === "withdrawn", `applicant -> ${to}`);
    assert.equal(roleCanMoveTo("recruiter", to), to !== "withdrawn", `recruiter -> ${to}`);
  }
});

test("every stage is movable by exactly one role", () => {
  for (const to of STAGE_CODES) {
    const roles = ROLES.filter((role) => roleCanMoveTo(role, to));
    assert.equal(roles.length, 1, `${to} movable by ${roles.join(", ") || "nobody"}`);
  }
});

test("an unknown role can move nowhere", () => {
  for (const to of STAGE_CODES) {
    assert.equal(roleCanMoveTo("admin" as never, to), false, to);
  }
});

test("reason is required only for rejected and withdrawn", () => {
  for (const to of STAGE_CODES) {
    assert.equal(reasonRequiredFor(to), to === "rejected" || to === "withdrawn", to);
  }
});

test("resume from hold: only back to the stage the application came from, and only if that stage can be held", () => {
  const resumable = new Set<StageCode>(ACTIVE);
  for (const previous of STAGE_CODES) {
    for (const to of STAGE_CODES) {
      const expected = to === previous && resumable.has(previous);
      assert.equal(canResumeFromHold(previous, to), expected, `before hold: ${previous}, resume to: ${to}`);
    }
  }
});

test("resume from hold is never possible into a terminal stage or on_hold itself", () => {
  for (const stage of [...TERMINAL, "on_hold"] as const) {
    assert.equal(canResumeFromHold(stage, stage), false, stage);
  }
});

test("STAGE_CODES and TRANSITIONS stay in sync with the seeded stages table", () => {
  const db = openDb(":memory:");
  const seeded = (db.prepare("SELECT code FROM stages ORDER BY sort_order").all() as { code: string }[]).map((r) => r.code);
  assert.deepEqual(seeded, [...STAGE_CODES], "STAGE_CODES must match the seeded stages (same codes, same order)");
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...STAGE_CODES].sort(), "TRANSITIONS must have a key for every stage");
  for (const targets of Object.values(TRANSITIONS)) {
    for (const to of targets) assert.ok(seeded.includes(to), `TRANSITIONS points to unknown stage ${to}`);
  }
  const terminal = (db.prepare("SELECT code FROM stages WHERE is_terminal = 1 ORDER BY sort_order").all() as { code: string }[]).map((r) => r.code);
  assert.deepEqual(terminal, [...TERMINAL], "is_terminal in the DB must match terminal stages in code");
});
