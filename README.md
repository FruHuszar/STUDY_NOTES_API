# study-notes-api

Private-notes backend for Study Notes: a single Cloudflare Worker in front of a D1 (SQLite) database. The frontend is a static React PWA on GitHub Pages that calls this API cross-origin with a bearer token.

First-time setup is in [SETUP.txt](SETUP.txt).

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Workers (free plan) | No servers, global, 100k requests/day free |
| Database | Cloudflare D1 | SQLite, 5 GB free, 7-day point-in-time restore |
| Auth | Google Identity Services ID token, exchanged for our own session JWT | No seat limit, no cookies, works cross-origin from `github.io` |
| JWT / JWKS | [`jose`](https://github.com/panva/jose) | Audited, Web Crypto based, runs in Workers |
| Deploy | Wrangler, via GitHub Actions or by hand | |

No framework, no ORM. About 400 lines of plain JavaScript in `src/`.

## Auth flow

```
Browser                         Worker                          Google
  | Google button -> ID token      |                               |
  |------ POST /api/session ------>| verify RS256 sig (JWKS), iss, |
  |       { credential }           | aud = GOOGLE_CLIENT_ID,       |
  |                                | email_verified, allowlist  -->| certs (cached)
  |<----- { token, expiresAt } ----| HS256 session JWT, 30 days    |
  |------ GET /api/notes --------->| verify session JWT +          |
  |       Authorization: Bearer    | re-check allowlist every call |
```

- The session JWT carries `sub` (Google's stable account id) and `email`. `sub` is the row owner.
- The allowlist (`ALLOWED_EMAILS` secret) is checked on **every** request, so removing an email revokes access immediately, even for unexpired tokens.
- `GET /api/notes` returns a fresh token when the current one is more than a day old, giving a sliding 30-day session. Rotating `SESSION_SECRET` signs everyone out.
- The frontend stores the token in `localStorage` and the last fetched notes in IndexedDB for offline reading; both are wiped on sign-out, 401 and 403.

## API

All routes are JSON. Authenticated routes need `Authorization: Bearer <session token>`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/health` | | `{ ok: true }` |
| POST | `/api/session` | `{ credential }` (Google ID token) | `{ token, email, expiresAt }` |
| GET | `/api/notes` | | `{ notes, categories, session? }` |
| POST | `/api/notes` | `{ title, category, content }` | note, `201` |
| PUT | `/api/notes/:id` | `{ title, category, content, version }` | note, or `409` if `version` is stale |
| DELETE | `/api/notes/:id` | | `204` |
| PUT | `/api/categories` | `{ name, color }` (`#rrggbb`) | `{ name, color }` (upsert) |

A note is `{ id, title, category, content, version, updatedAt }`. `content` is Markdown without the `#` title line. Categories are normalized to trimmed lowercase.

Errors are `{ error: "human-readable message" }` with a meaningful status code. The frontend shows the message as-is, so messages are written for end users.

## Security model

- **Isolation (IDOR):** D1 has no row-level security, so every query filters with `owner = ?` bound to the verified token's `sub`. The owner is never read from the request.
- **Optimistic concurrency:** updates run `WHERE id = ? AND owner = ? AND version = ?`, so a stale tab gets `409` instead of silently overwriting.
- **CORS:** only origins in `ALLOWED_ORIGINS`. Requests from any other browser origin get `403` before routing.
- **Input limits:** title 200 chars, category 40, content 500 KB, body 1 MB, 2,000 notes and 200 category colors per user. JSON only (`415` otherwise).
- **Headers:** `Cache-Control: no-store`, `nosniff`, `no-referrer` on every response.
- **Not end-to-end encrypted, by design.** Notes are readable by whoever controls the Cloudflare account. D1 encrypts at rest.
- **Logging:** only error messages are logged, never note content.
- **Frontend side:** Markdown is sanitized with DOMPurify before rendering, and the built `index.html` ships a Content-Security-Policy that only allows this API and Google's sign-in scripts.

Secrets (`ALLOWED_EMAILS`, `SESSION_SECRET`) exist only as Wrangler secrets. `wrangler.toml` holds nothing sensitive, so this repo can be public.

## Free-tier budget

Reads per page load equal the number of the user's notes (indexed on `owner`). Writes are one row per save, plus one index row. A few users with a few hundred notes each use well under 1% of D1's 5M reads and 100k writes per day. If a quota is ever exhausted, requests fail until 00:00 UTC; nothing is billed on the free plan.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars        # put two emails and a 32+ char secret in it
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm run test:smoke                    # in a second terminal: 29 end-to-end API checks
```

Point the frontend at it with `VITE_API_URL=http://localhost:8787` in Repo A's `.env.local`. Google sign-in needs `http://localhost:5173` in the OAuth client's authorized origins.

## Schema changes

Add a new numbered file in `migrations/` (e.g. `0002_add_pinned.sql`). Never edit an applied migration. `npm run deploy` (or the GitHub Action) applies pending migrations before deploying code, so write migrations that the previous code version tolerates.

## Layout

```
src/index.js       routing, CORS gate, error handling
src/auth.js        Google token verification, session JWTs, allowlist
src/notes.js       note CRUD
src/categories.js  category colors
src/validate.js    input validation and limits
src/http.js        JSON helpers, security headers
src/cors.js        origin allowlist
migrations/        D1 schema
test/smoke.mjs     API smoke test against a running dev server
```
