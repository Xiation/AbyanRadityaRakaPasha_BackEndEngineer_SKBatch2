import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db/index.ts";

let server: Server;
let base: string;

before(() => {
  server = createApp(openDb(":memory:"), { rateLimit: { windowMs: 60_000, readLimit: 100000, writeLimit: 100000 } }).listen(0);
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => { server.close(); });

// helper: panggil API, kembalikan status + body JSON
async function call(method: string, path: string, role: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const valid = { name: "Ani", email: "ani@mail.com", position: "BE", batch: "2" };

test("POST /applicants valid -> 201 dan stage applied", async () => {
  const r = await call("POST", "/applicants", "applicant", valid);
  assert.equal(r.status, 201);
  assert.equal(r.body.stage.code, "applied");
});

test("POST email+posisi+batch sama -> 409", async () => {
  const body = { ...valid, email: "dup@mail.com" };
  await call("POST", "/applicants", "applicant", body);
  const r = await call("POST", "/applicants", "applicant", body);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "DUPLICATE_APPLICATION");
});

test("PATCH loncat stage -> 409", async () => {
  const created = await call("POST", "/applicants", "applicant", { ...valid, email: "jump@mail.com" });
  const r = await call("PATCH", `/applicants/${created.body.id}/stage`, "recruiter", { to_stage: "offering" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "INVALID_TRANSITION");
});

/* -------------------------------------------------------------------------- */
/* Tests below were written by the AI assistant (Claude Code). Each test uses  */
/* its own email because all tests share one in-memory DB.                     */
/* -------------------------------------------------------------------------- */

// helper: create an applicant and return its id
async function createId(email: string, extra: Record<string, unknown> = {}): Promise<number> {
  const r = await call("POST", "/applicants", "applicant", { ...valid, email, ...extra });
  assert.equal(r.status, 201, `setup: create ${email} should be 201`);
  return r.body.id;
}

const move = (id: number, role: string | null, body: unknown) =>
  call("PATCH", `/applicants/${id}/stage`, role, body);

// ---- create & validation ----

test("POST body tidak valid -> 422 dengan detail per field", async () => {
  const r = await call("POST", "/applicants", "applicant", { name: "", email: "x", position: "BE", batch: "2" });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  const fields = r.body.error.details.map((d: { field: string }) => d.field);
  assert.ok(fields.includes("email"));
  assert.ok(fields.includes("name"));
});

test("POST email dinormalisasi (trim + lowercase) dan person dipakai ulang", async () => {
  const a = await call("POST", "/applicants", "applicant", { ...valid, email: "  Norm@Mail.COM " });
  assert.equal(a.status, 201);
  assert.equal(a.body.person.email, "norm@mail.com");
  // email sama, posisi beda -> lamaran baru, person yang sama
  const b = await call("POST", "/applicants", "applicant", { ...valid, email: "norm@mail.com", position: "FE" });
  assert.equal(b.status, 201);
  assert.equal(b.body.person.id, a.body.person.id);
  assert.notEqual(b.body.id, a.body.id);
});

test("POST tanpa header X-Role -> 400 INVALID_ROLE", async () => {
  const r = await call("POST", "/applicants", null, { ...valid, email: "norole@mail.com" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "INVALID_ROLE");
});

test("POST X-Role tidak dikenal -> 400 INVALID_ROLE", async () => {
  const r = await call("POST", "/applicants", "admin", { ...valid, email: "admin@mail.com" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "INVALID_ROLE");
});

test("POST JSON rusak -> 400 INVALID_JSON", async () => {
  const res = await fetch(`${base}/applicants`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-role": "applicant" },
    body: "{oops",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "INVALID_JSON");
});

test("POST body > 10 KB -> 413 PAYLOAD_TOO_LARGE", async () => {
  const r = await call("POST", "/applicants", "applicant", { ...valid, email: "big@mail.com", name: "x".repeat(20000) });
  assert.equal(r.status, 413);
  assert.equal(r.body.error.code, "PAYLOAD_TOO_LARGE");
});

test("route tidak ada -> 404 NOT_FOUND dalam format error yang sama", async () => {
  const r = await call("GET", "/tidak-ada", null);
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "NOT_FOUND");
});

// ---- update stage ----

test("PATCH applied -> screening oleh recruiter -> 200", async () => {
  const id = await createId("step@mail.com");
  const r = await move(id, "recruiter", { to_stage: "screening" });
  assert.equal(r.status, 200);
  assert.equal(r.body.stage.code, "screening");
  assert.equal(r.body.history.length, 2);
});

test("PATCH rejected tanpa reason -> 422 pada field reason", async () => {
  const id = await createId("noreason@mail.com");
  const r = await move(id, "recruiter", { to_stage: "rejected" });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.details[0].field, "reason");
});

test("PATCH rejected dengan reason -> 200 lalu stage terminal tidak bisa dibuka lagi", async () => {
  const id = await createId("reject@mail.com");
  assert.equal((await move(id, "recruiter", { to_stage: "rejected", reason: "kurang cocok" })).status, 200);
  const r = await move(id, "recruiter", { to_stage: "screening" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "INVALID_TRANSITION");
});

test("PATCH oleh applicant ke stage selain withdrawn -> 403 FORBIDDEN", async () => {
  const id = await createId("forbid@mail.com");
  const r = await move(id, "applicant", { to_stage: "screening" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FORBIDDEN");
});

test("PATCH applicant withdraw dengan reason -> 200; recruiter tidak boleh withdraw -> 403", async () => {
  const a = await createId("wd1@mail.com");
  const ok = await move(a, "applicant", { to_stage: "withdrawn", reason: "terima tawaran lain" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.stage.code, "withdrawn");

  const b = await createId("wd2@mail.com");
  const no = await move(b, "recruiter", { to_stage: "withdrawn", reason: "x" });
  assert.equal(no.status, 403);
});

test("on_hold: resume hanya ke stage sebelum hold", async () => {
  const id = await createId("hold@mail.com");
  await move(id, "recruiter", { to_stage: "screening" });
  await move(id, "recruiter", { to_stage: "assessment" });
  assert.equal((await move(id, "recruiter", { to_stage: "on_hold" })).status, 200);

  const wrong = await move(id, "recruiter", { to_stage: "screening" });
  assert.equal(wrong.status, 409);

  const right = await move(id, "recruiter", { to_stage: "assessment" });
  assert.equal(right.status, 200);
  assert.equal(right.body.stage.code, "assessment");
});

test("PATCH id tidak valid -> 422, id tidak ada -> 404, to_stage ngawur -> 422", async () => {
  assert.equal((await move(0 as number, "recruiter", { to_stage: "screening" })).status, 422);
  const nf = await move(999999, "recruiter", { to_stage: "screening" });
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, "NOT_FOUND");
  const id = await createId("badstage@mail.com");
  assert.equal((await move(id, "recruiter", { to_stage: "foo" })).status, 422);
});

// ---- detail & history ----

test("GET /applicants/:id -> riwayat urut lama ke baru, mulai dari from_stage null", async () => {
  const id = await createId("hist@mail.com");
  await move(id, "recruiter", { to_stage: "screening" });
  const r = await call("GET", `/applicants/${id}`, "recruiter");
  assert.equal(r.status, 200);
  const h = r.body.history;
  assert.equal(h.length, 2);
  assert.equal(h[0].from_stage, null);
  assert.equal(h[0].to_stage, "applied");
  assert.equal(h[1].from_stage, "applied");
  assert.equal(h[1].to_stage, "screening");
});

test("GET detail oleh applicant: field notes tidak ada; oleh recruiter: ada", async () => {
  const id = await createId("notes@mail.com");
  await move(id, "recruiter", { to_stage: "screening", notes: "rahasia internal" });

  const asApplicant = await call("GET", `/applicants/${id}`, "applicant");
  assert.equal(asApplicant.status, 200);
  for (const entry of asApplicant.body.history) {
    assert.equal("notes" in entry, false);
  }

  const asRecruiter = await call("GET", `/applicants/${id}`, "recruiter");
  assert.equal(asRecruiter.body.history[1].notes, "rahasia internal");
});

test("GET /applicants/999999 -> 404 NOT_FOUND", async () => {
  const r = await call("GET", "/applicants/999999", "recruiter");
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "NOT_FOUND");
});

// ---- list ----

test("GET /applicants oleh applicant -> 403", async () => {
  const r = await call("GET", "/applicants", "applicant");
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FORBIDDEN");
});

test("GET /applicants oleh recruiter -> 200 dengan data dan meta, terbaru dulu", async () => {
  const r = await call("GET", "/applicants", "recruiter");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data));
  assert.ok(r.body.meta.total >= 1);
  assert.equal(r.body.meta.limit, 20);
  assert.equal(r.body.meta.offset, 0);
  const ids: number[] = r.body.data.map((a: { id: number }) => a.id);
  assert.deepEqual(ids, [...ids].sort((x, y) => y - x));
});

test("GET /applicants filter stage + position, paginasi menjaga total", async () => {
  const id = await createId("filter@mail.com", { position: "QA-Filter", batch: "9" });
  await move(id, "recruiter", { to_stage: "screening" });

  const f = await call("GET", "/applicants?stage=screening&position=QA-Filter&batch=9", "recruiter");
  assert.equal(f.status, 200);
  assert.equal(f.body.meta.total, 1);
  assert.equal(f.body.data[0].id, id);

  const all = await call("GET", "/applicants", "recruiter");
  const page = await call("GET", "/applicants?limit=1&offset=1", "recruiter");
  assert.equal(page.body.data.length, 1);
  assert.equal(page.body.meta.total, all.body.meta.total);

  const beyond = await call("GET", "/applicants?offset=100000", "recruiter");
  assert.deepEqual(beyond.body.data, []);
});

test("GET /applicants?stage= hanya mengembalikan stage itu", async () => {
  const id = await createId("onlystage@mail.com");
  await move(id, "recruiter", { to_stage: "screening" });
  const r = await call("GET", "/applicants?stage=screening&limit=100", "recruiter");
  assert.ok(r.body.data.length >= 1);
  for (const a of r.body.data) assert.equal(a.stage.code, "screening");
  const none = await call("GET", "/applicants?stage=hired", "recruiter");
  assert.equal(none.body.meta.total, 0);
});

test("GET /applicants?position= dan ?batch= masing-masing menyaring sendiri", async () => {
  await createId("pos1@mail.com", { position: "Solo-Position", batch: "B-solo" });
  await createId("pos2@mail.com", { position: "Other-Position", batch: "B-solo" });
  const byPos = await call("GET", "/applicants?position=Solo-Position", "recruiter");
  assert.equal(byPos.body.meta.total, 1);
  assert.equal(byPos.body.data[0].position, "Solo-Position");
  const byBatch = await call("GET", "/applicants?batch=B-solo", "recruiter");
  assert.equal(byBatch.body.meta.total, 2);
});

test("PATCH memperbarui updated_at, created_at tetap", async () => {
  const id = await createId("ts@mail.com");
  const before = (await call("GET", `/applicants/${id}`, "recruiter")).body;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const after = (await move(id, "recruiter", { to_stage: "screening" })).body;
  assert.equal(after.created_at, before.created_at);
  assert.notEqual(after.updated_at, before.updated_at);
  assert.ok(after.updated_at > before.updated_at);
});

// ---- API docs (written by the AI assistant) ----

test("/docs dan /openapi.json terbuka tanpa X-Role", async () => {
  const ui = await fetch(`${base}/docs/`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /swagger-ui/i);
  const spec = await fetch(`${base}/openapi.json`);
  assert.equal(spec.status, 200);
  assert.equal((await spec.json()).openapi, "3.0.3");
});

test("kontrak: setiap path + method di openapi.yaml ada di app (bukan 404 route-not-found)", async () => {
  const spec = parse(readFileSync(new URL("../docs/openapi.yaml", import.meta.url), "utf8"));
  let checked = 0;
  for (const [path, methods] of Object.entries<Record<string, unknown>>(spec.paths)) {
    for (const method of Object.keys(methods)) {
      if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
      const url = path.replace("{id}", "999999");
      const res = await fetch(base + url, {
        method: method.toUpperCase(),
        headers: { "content-type": "application/json", "x-role": "recruiter" },
        body: method === "get" ? undefined : JSON.stringify({}),
      });
      const body = await res.json();
      const routeMissing = res.status === 404 && String(body.error?.message).startsWith("Route ");
      assert.equal(routeMissing, false, `${method.toUpperCase()} ${path} ada di spec tapi tidak ada di app`);
      checked++;
    }
  }
  assert.ok(checked >= 4, "spec harus memuat minimal 4 operasi");
});

// ---- security hardening (written by the AI assistant, from the security audit) ----

test("karakter kontrol di name/position/batch -> 422; teks unicode wajar tetap diterima", async () => {
  const bad: Array<[string, string]> = [
    ["position", "BE\u0000"],
    ["batch", "1\t2"],
    ["name", "A\nB"],
    ["position", "BE\u007f"],
  ];
  for (const [field, value] of bad) {
    const r = await call("POST", "/applicants", "applicant", { ...valid, email: `ctl-${field}@mail.com`, [field]: value });
    assert.equal(r.status, 422, `${field} dengan karakter kontrol harus ditolak`);
    assert.equal(r.body.error.details[0].field, field);
  }
  const ok = await call("POST", "/applicants", "applicant", {
    name: "Siti Ñandú 李 😀", email: "unicode@mail.com", position: "Back-End Engineer (Jr.)", batch: "SK Batch 2",
  });
  assert.equal(ok.status, 201);
});

test("filter list menolak karakter kontrol dan teks terlalu panjang", async () => {
  for (const q of ["position=BE%00", "batch=1%092", `position=${"a".repeat(101)}`, `batch=${"b".repeat(51)}`]) {
    const r = await call("GET", `/applicants?${q}`, "recruiter");
    assert.equal(r.status, 422, q);
  }
});

test("id harus berupa angka bulat positif polos (bukan 1e3, 0x10, 1.0, spasi, negatif)", async () => {
  for (const id of ["1e3", "0x10", "1.0", "-1", "0", "abc", "9007199254740992"]) {
    const r = await call("GET", `/applicants/${encodeURIComponent(id)}`, "recruiter");
    assert.equal(r.status, 422, `id ${id}`);
  }
});

test("header: X-Powered-By tidak dikirim, X-Content-Type-Options: nosniff ada", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get("x-powered-by"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("field tambahan (id, stage, created_at) diabaikan saat create", async () => {
  const r = await call("POST", "/applicants", "applicant", {
    ...valid, email: "mass@mail.com", id: 99999, stage: "hired", current_stage_id: 6, created_at: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(r.status, 201);
  assert.notEqual(r.body.id, 99999);
  assert.equal(r.body.stage.code, "applied");
  assert.notEqual(r.body.created_at, "2000-01-01T00:00:00.000Z");
});

test("GET /applicants query tidak valid -> 422", async () => {
  for (const q of ["limit=101", "limit=0", "offset=-1", "limit=abc", "stage=foo"]) {
    const r = await call("GET", `/applicants?${q}`, "recruiter");
    assert.equal(r.status, 422, q);
    assert.equal(r.body.error.code, "VALIDATION_ERROR", q);
  }
});

// RATE LIMITING
test("rate limit: request ke-3 dengan writeLimit 2 -> 429 + Retry-After", async () => {
  const small = createApp(openDb(":memory:"), {
    rateLimit: { windowMs: 60_000, readLimit: 100, writeLimit: 2 },
  }).listen(0);
  try {
    const url = `http://localhost:${(small.address() as { port: number }).port}`;
    const post = (email: string) =>
      fetch(`${url}/applicants`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-role": "applicant" },
        body: JSON.stringify({ ...valid, email }),
      });

    assert.equal((await post("rl1@mail.com")).status, 201);
    assert.equal((await post("rl2@mail.com")).status, 201);
    const third = await post("rl3@mail.com");
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
    assert.equal((await third.json()).error.code, "RATE_LIMITED");

    // kuota GET terpisah dari kuota write
    const get = await fetch(`${url}/applicants`, { headers: { "x-role": "recruiter" } });
    assert.equal(get.status, 200);
  } finally {
    small.close();
  }
});

test("rate limit: kuota pulih setelah jendela berakhir", async () => {
  const small = createApp(openDb(":memory:"), {
    rateLimit: { windowMs: 50, readLimit: 100, writeLimit: 1 },
  }).listen(0);
  try {
    const url = `http://localhost:${(small.address() as { port: number }).port}`;
    const post = (email: string) =>
      fetch(`${url}/applicants`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-role": "applicant" },
        body: JSON.stringify({ ...valid, email }),
      });

    assert.equal((await post("win1@mail.com")).status, 201);
    assert.equal((await post("win2@mail.com")).status, 429);
    await new Promise((resolve) => setTimeout(resolve, 80)); // lebih lama dari windowMs
    assert.equal((await post("win3@mail.com")).status, 201);
  } finally {
    small.close();
  }
});
