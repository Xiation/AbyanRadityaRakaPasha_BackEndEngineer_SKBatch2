import type { DatabaseSync } from "node:sqlite";

// Idempotent: INSERT OR IGNORE keyed by the UNIQUE `code`, safe to run on every start.
export function seedStages(db: DatabaseSync): void {
  const sql = "INSERT OR IGNORE INTO stages (code, name, sort_order, is_terminal) VALUES (?, ?, ?, ?)";
  const seed = db.prepare(sql);
  for (const [code, name, sort_order, is_terminal] of [
      ["applied", "Applied", 1, 0],
      ["screening", "Screening", 2, 0],
      ["assessment", "Assessment", 3, 0],
      ["interview", "Interview", 4, 0],
      ["offering", "Offering", 5, 0],
      ["hired", "Hired", 6, 1],
      ["rejected", "Rejected", 7, 1],
      ["withdrawn", "Withdrawn", 8, 1],
      ["on_hold", "On Hold", 9, 0],
  ] as const) {
    seed.run(code, name, sort_order, is_terminal);
  }
}
