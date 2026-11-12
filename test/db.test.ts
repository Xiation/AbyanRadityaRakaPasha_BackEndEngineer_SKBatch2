import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.ts";
import { migrate } from "../src/db/schema.ts";
import { seedStages } from "../src/db/seed.ts";

test("openDb creates all tables and seeds the 9 stages", () => {
  const db = openDb(":memory:");
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, ["applications", "persons", "stage_history", "stages"]);

  const stages = db.prepare("SELECT code FROM stages ORDER BY sort_order").all().map((r) => r.code);
  assert.deepEqual(stages, [
    "applied", "screening", "assessment", "interview", "offering",
    "hired", "rejected", "withdrawn", "on_hold",
  ]);
});

test("migrate + seed are idempotent", () => {
  const db = openDb(":memory:");
  // running the same steps again on the same connection must not throw or duplicate stages
  migrate(db);
  seedStages(db);
  const count = db.prepare("SELECT count(*) AS c FROM stages").get() as { c: number };
  assert.equal(count.c, 9);
});

test("a person with applications cannot be deleted (ON DELETE RESTRICT)", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO persons (name, email) VALUES ('A', 'a@x.com')").run();
  db.prepare(
    "INSERT INTO applications (person_id, position, batch, current_stage_id) VALUES (1, 'be', 'b2', 1)",
  ).run();
  assert.throws(() => db.prepare("DELETE FROM persons WHERE id = 1").run(), /FOREIGN KEY/);
});

test("same person cannot apply twice to the same position and batch", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO persons (name, email) VALUES ('A', 'a@x.com')").run();
  const insert = () =>
    db.prepare(
      "INSERT INTO applications (person_id, position, batch, current_stage_id) VALUES (1, 'be', 'b2', 1)",
    ).run();
  insert();
  assert.throws(insert, /UNIQUE/);
});
