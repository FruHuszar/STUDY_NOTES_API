import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { HttpError, json, readJson } from "./http.js";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const googleIssuers = ["https://accounts.google.com", "accounts.google.com"];
const sessionIssuer = "study-notes-api";
const sessionAudience = "study-notes-app";
const sessionDays = 30;
const renewAfterSeconds = 24 * 60 * 60;

const notAllowed = () =>
  new HttpError(403, "This Google account isn't on the list of people who can use private notes.");

function allowedEmails(env) {
  return new Set(
    String(env.ALLOWED_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function sessionKey(env) {
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters.");
  }
  return new TextEncoder().encode(env.SESSION_SECRET);
}

async function issueSession(userId, email, env) {
  const expiresAt = Date.now() + sessionDays * 24 * 60 * 60 * 1000;
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(sessionIssuer)
    .setAudience(sessionAudience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(sessionKey(env));
  return { token, email, expiresAt };
}

export async function createSession(request, env) {
  const { credential } = await readJson(request);
  if (typeof credential !== "string" || credential.length === 0 || credential.length > 8192) {
    throw new HttpError(400, "The Google sign-in response is missing.");
  }
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not configured.");
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(credential, googleKeys, {
      issuer: googleIssuers,
      audience: env.GOOGLE_CLIENT_ID,
      algorithms: ["RS256"]
    }));
  } catch {
    throw new HttpError(401, "Google sign-in couldn't be verified. Try signing in again.");
  }
  const email = String(payload.email || "").toLowerCase();
  if (payload.email_verified !== true || !payload.sub || !email) {
    throw new HttpError(401, "Google didn't confirm this account's email address.");
  }
  if (!allowedEmails(env).has(email)) {
    throw notAllowed();
  }
  return json(await issueSession(payload.sub, email, env));
}

export async function authenticate(request, env) {
  const key = sessionKey(env);
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(header);
  if (!match) {
    throw new HttpError(401, "Sign in to use private notes.");
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], key, {
      issuer: sessionIssuer,
      audience: sessionAudience,
      algorithms: ["HS256"]
    }));
  } catch {
    throw new HttpError(401, "Your session has ended. Sign in again.");
  }
  const email = String(payload.email || "").toLowerCase();
  if (typeof payload.sub !== "string" || !allowedEmails(env).has(email)) {
    throw notAllowed();
  }
  return { id: payload.sub, email, issuedAt: payload.iat };
}

export function renewIfDue(user, env) {
  const age = Math.floor(Date.now() / 1000) - user.issuedAt;
  return age > renewAfterSeconds ? issueSession(user.id, user.email, env) : null;
}
