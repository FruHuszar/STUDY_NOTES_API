// Smoke test for a running local Worker: `npm run dev` in one terminal, `npm run test:smoke` in another.
// Needs .dev.vars with SESSION_SECRET and at least two emails in ALLOWED_EMAILS.
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";

const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()])
);
const emails = String(vars.ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!vars.SESSION_SECRET || emails.length < 2) {
  console.error("Put SESSION_SECRET and at least two ALLOWED_EMAILS in .dev.vars first.");
  process.exit(1);
}
const base = process.env.API_URL || "http://127.0.0.1:8787";
const origin = process.env.TEST_ORIGIN || "http://localhost:5173";
const secret = new TextEncoder().encode(vars.SESSION_SECRET);
const token = (sub, email, { iat, aud = "study-notes-app", key = secret } = {}) => {
  const jwt = new SignJWT({ email }).setProtectedHeader({ alg: "HS256" }).setSubject(sub)
    .setIssuer("study-notes-api").setAudience(aud).setExpirationTime("1h");
  iat ? jwt.setIssuedAt(iat) : jwt.setIssuedAt();
  return jwt.sign(key);
};
const call = async (method, path, { auth, body, origin: requestOrigin = origin, type = "application/json" } = {}) => {
  const headers = {};
  if (requestOrigin) headers.Origin = requestOrigin;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body !== undefined) headers["Content-Type"] = type;
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
};
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`); };

const me = await token("sub-me", emails[0]);
const friend = await token("sub-friend", emails[1]);
const stranger = await token("sub-x", `not-allowed-${Date.now()}@example.com`);

let r = await call("GET", "/api/notes");
check("no token -> 401", r.status === 401);
r = await call("GET", "/api/notes", { auth: stranger });
check("not allowlisted -> 403", r.status === 403);
r = await call("GET", "/api/notes", { auth: await token("sub-me", emails[0], { key: new TextEncoder().encode("x".repeat(40)) }) });
check("forged signature -> 401", r.status === 401);
r = await call("GET", "/api/notes", { auth: await token("sub-me", emails[0], { aud: "other" }) });
check("wrong audience -> 401", r.status === 401);
r = await call("GET", "/api/notes", { auth: me, origin: "https://evil.example" });
check("bad origin -> 403", r.status === 403);
r = await call("OPTIONS", "/api/notes");
check("preflight CORS", r.status === 204 && r.headers.get("access-control-allow-origin") === origin);
r = await call("GET", "/api/notes", { auth: friend });
check("second allowlisted user can sign in", r.status === 200, JSON.stringify(r.body));

r = await call("POST", "/api/notes", { auth: me, body: { title: "  Joins ", category: " School  Notes ", content: "## A\n\n#### tags\nsql\n\ntext" } });
check("create", r.status === 201 && r.body.title === "Joins" && r.body.category === "school notes" && r.body.version === 1, JSON.stringify(r.body));
const note = r.body;
check("no-store header", r.headers.get("cache-control") === "no-store");

r = await call("GET", "/api/notes", { auth: friend });
check("IDOR: friend can't list mine", !r.body.notes.some((entry) => entry.id === note.id));
r = await call("PUT", `/api/notes/${note.id}`, { auth: friend, body: { title: "hack", version: 1 } });
check("IDOR: friend can't update mine", r.status === 404);
r = await call("DELETE", `/api/notes/${note.id}`, { auth: friend });
check("IDOR: friend can't delete mine", r.status === 404);

r = await call("PUT", `/api/notes/${note.id}`, { auth: me, body: { title: "Joins 2", category: "school notes", content: "x", version: 1 } });
check("update v1->v2", r.status === 200 && r.body.version === 2);
r = await call("PUT", `/api/notes/${note.id}`, { auth: me, body: { title: "stale", content: "y", version: 1 } });
check("stale version -> 409", r.status === 409);
r = await call("PUT", `/api/notes/${note.id}`, { auth: me, body: { title: "no version" } });
check("missing version -> 400", r.status === 400);

r = await call("POST", "/api/notes", { auth: me, body: { title: "" } });
check("empty title -> 400", r.status === 400);
r = await call("POST", "/api/notes", { auth: me, body: { title: "big", content: "x".repeat(500_001) } });
check("too large -> 413", r.status === 413);
r = await call("POST", "/api/notes", { auth: me, body: "title=x", type: "application/x-www-form-urlencoded" });
check("non-JSON -> 415", r.status === 415);
r = await call("POST", "/api/notes", { auth: me, body: "{bad" });
check("bad JSON -> 400", r.status === 400);
r = await call("PUT", "/api/notes/not-a-uuid", { auth: me, body: { title: "t", version: 1 } });
check("bad id -> 404", r.status === 404);

r = await call("PUT", "/api/categories", { auth: me, body: { name: "School Notes", color: "#5F9E6E" } });
check("category color upsert", r.status === 200 && r.body.name === "school notes" && r.body.color === "#5f9e6e", JSON.stringify(r.body));
r = await call("PUT", "/api/categories", { auth: me, body: { name: "school notes", color: "red" } });
check("bad color -> 400", r.status === 400);
r = await call("PUT", "/api/categories", { auth: me, body: { name: "school notes", color: "#4f7fb8" } });
r = await call("GET", "/api/notes", { auth: me });
check("list mine + categories", r.body.notes.some((entry) => entry.id === note.id) && r.body.categories.some((c) => c.name === "school notes" && c.color === "#4f7fb8"));
check("fresh token not renewed", r.body.session === undefined);
r = await call("GET", "/api/notes", { auth: await token("sub-me", emails[0], { iat: Math.floor(Date.now() / 1000) - 2 * 86400 }) });
check("old token renewed", typeof r.body.session?.token === "string" && r.body.session.expiresAt > Date.now() + 29 * 86400e3);

r = await call("POST", "/api/session", { body: { credential: "a.b.c" } });
check("fake Google credential -> 401", r.status === 401, JSON.stringify(r.body));
r = await call("DELETE", `/api/notes/${note.id}`, { auth: me });
check("delete", r.status === 204);
r = await call("GET", "/api/notes/whatever", { auth: me });
check("unknown route method -> 405", r.status === 405);
r = await call("GET", "/nope");
check("404", r.status === 404);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
