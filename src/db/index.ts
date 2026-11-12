import { DatabaseSync } from "node:sqlite";
import { migrate } from "./schema.ts";
import { seedStages } from "./seed.ts";

// Pass ":memory:" in tests, a file path (default) for local persistence.
export function openDb(path: string = "applicants.db"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;"); // per connection, must be set on every open
  migrate(db);
  seedStages(db);
  return db;
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN TRANSACTION;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}
