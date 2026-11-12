// Written by the AI assistant. Process-level tests for src/server.ts: graceful shutdown and fail-fast config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const entry = new URL("../src/server.ts", import.meta.url).pathname;

function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return { child, output: () => out };
}

async function waitFor(predicate: () => boolean, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`graceful shutdown on ${signal}: finishes cleanly with exit code 0`, async () => {
    const port = String(39000 + Math.floor(Math.random() * 500));
    const { child, output } = start({ PORT: port, DB_PATH: ":memory:" });
    try {
      await waitFor(() => output().includes("API listening"));
      assert.equal((await fetch(`http://localhost:${port}/health`)).status, 200);
      child.kill(signal);
      const [code] = await once(child, "exit");
      assert.equal(code, 0, output());
      assert.match(output(), new RegExp(`${signal} received, shutting down`));
      assert.match(output(), /shutdown complete/);
    } finally {
      child.kill("SIGKILL");
    }
  });
}

test("invalid PORT: process exits with code 1 and a clear message, without listening", async () => {
  const { child, output } = start({ PORT: "abc", DB_PATH: ":memory:" });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(output(), /Invalid configuration \(PORT:/);
  assert.doesNotMatch(output(), /API listening/);
});
