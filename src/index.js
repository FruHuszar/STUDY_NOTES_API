import { authenticate, createSession } from "./auth.js";
import { corsHeaders, isOriginAllowed } from "./cors.js";
import { HttpError, json, withHeaders } from "./http.js";
import * as notes from "./notes.js";
import * as categories from "./categories.js";

const routes = [
  { method: "GET", path: /^\/api\/health$/, handler: () => json({ ok: true }) },
  { method: "POST", path: /^\/api\/session$/, handler: ({ request, env }) => createSession(request, env) },
  { method: "GET", path: /^\/api\/notes$/, handler: notes.list, signedIn: true },
  { method: "POST", path: /^\/api\/notes$/, handler: notes.create, signedIn: true },
  { method: "PUT", path: /^\/api\/notes\/([^/]+)$/, handler: notes.update, signedIn: true },
  { method: "DELETE", path: /^\/api\/notes\/([^/]+)$/, handler: notes.remove, signedIn: true },
  { method: "PUT", path: /^\/api\/categories$/, handler: categories.save, signedIn: true },
  { method: "POST", path: /^\/api\/categories\/rename$/, handler: categories.rename, signedIn: true },
  { method: "DELETE", path: /^\/api\/categories\/([^/]+)$/, handler: categories.remove, signedIn: true }
];

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const matches = routes.filter((entry) => entry.path.test(pathname));
  if (matches.length === 0) {
    throw new HttpError(404, "Not found.");
  }
  const entry = matches.find((candidate) => candidate.method === request.method);
  if (!entry) {
    throw new HttpError(405, "Method not allowed.");
  }
  const params = entry.path.exec(pathname).slice(1);
  const user = entry.signedIn ? await authenticate(request, env) : null;
  return entry.handler({ request, env, user, params });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (origin && !isOriginAllowed(origin, env)) {
      return withHeaders(json({ error: "This site isn't allowed to use the notes API." }, 403), {
        Vary: "Origin"
      });
    }
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") {
      return withHeaders(new Response(null, { status: 204 }), cors);
    }
    try {
      return withHeaders(await route(request, env), cors);
    } catch (error) {
      if (error instanceof HttpError) {
        return withHeaders(json({ error: error.message }, error.status), cors);
      }
      console.error("Unexpected error:", error instanceof Error ? error.message : "unknown");
      return withHeaders(json({ error: "The notes server hit an unexpected error." }, 500), cors);
    }
  }
};
