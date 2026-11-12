// Written by the AI assistant. Unit tests for src/config.ts (pure function, takes the env as an argument).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

test("config: defaults when nothing is set", () => {
  assert.deepEqual(loadConfig({}), { PORT: 3000, DB_PATH: "applicants.db" });
});

test("config: PORT is coerced to a number; DB_PATH is trimmed", () => {
  assert.deepEqual(loadConfig({ PORT: "8080", DB_PATH: " data/app.db " }), { PORT: 8080, DB_PATH: "data/app.db" });
});

test("config: boundaries of PORT (1 and 65535 ok)", () => {
  assert.equal(loadConfig({ PORT: "1" }).PORT, 1);
  assert.equal(loadConfig({ PORT: "65535" }).PORT, 65535);
});

test("config: invalid values fail fast with a message naming the variable", () => {
  for (const bad of ["abc", "0", "-1", "65536", "3000.5"]) {
    assert.throws(() => loadConfig({ PORT: bad }), /Invalid configuration \(PORT:/, `PORT=${bad}`);
  }
  assert.throws(() => loadConfig({ DB_PATH: "   " }), /Invalid configuration \(DB_PATH:/);
  assert.throws(() => loadConfig({ DB_PATH: "" }), /Invalid configuration \(DB_PATH:/);
});
