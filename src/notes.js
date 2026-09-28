import { HttpError, json, readJson } from "./http.js";
import { renewIfDue } from "./auth.js";
import * as valid from "./validate.js";

const columns = "id, title, category, content, version, updated_at AS updatedAt";

export async function list({ env, user }) {
  const [notes, categories] = await env.DB.batch([
    env.DB.prepare(`SELECT ${columns} FROM notes WHERE owner = ?1 ORDER BY category, title`).bind(user.id),
    env.DB.prepare("SELECT name, color FROM categories WHERE owner = ?1 ORDER BY name").bind(user.id)
  ]);
  const session = await renewIfDue(user, env);
  return json({
    notes: notes.results,
    categories: categories.results,
    ...(session ? { session } : {})
  });
}

export async function create({ env, user, request }) {
  const fields = valid.noteFields(await readJson(request));
  const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM notes WHERE owner = ?1")
    .bind(user.id)
    .first();
  if (count >= valid.limits.notesPerUser) {
    throw new HttpError(409, `You've reached ${valid.limits.notesPerUser} notes. Delete some to add more.`);
  }
  const now = new Date().toISOString();
  const note = await env.DB.prepare(
    `INSERT INTO notes (id, owner, title, category, content, version, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
     RETURNING ${columns}`
  )
    .bind(crypto.randomUUID(), user.id, fields.title, fields.category, fields.content, now)
    .first();
  return json(note, 201);
}

export async function update({ env, user, request, params }) {
  const noteId = valid.id(params[0]);
  const body = await readJson(request);
  const fields = valid.noteFields(body);
  const expected = valid.version(body.version);
  const note = await env.DB.prepare(
    `UPDATE notes
     SET title = ?1, category = ?2, content = ?3, version = version + 1, updated_at = ?4
     WHERE id = ?5 AND owner = ?6 AND version = ?7
     RETURNING ${columns}`
  )
    .bind(fields.title, fields.category, fields.content, new Date().toISOString(), noteId, user.id, expected)
    .first();
  if (note) {
    return json(note);
  }
  const exists = await env.DB.prepare("SELECT 1 FROM notes WHERE id = ?1 AND owner = ?2")
    .bind(noteId, user.id)
    .first();
  if (!exists) {
    throw new HttpError(404, "That note doesn't exist.");
  }
  throw new HttpError(409, "This note was changed on another device. Copy your text, press Sync, and edit again.");
}

export async function remove({ env, user, params }) {
  const noteId = valid.id(params[0]);
  const result = await env.DB.prepare("DELETE FROM notes WHERE id = ?1 AND owner = ?2")
    .bind(noteId, user.id)
    .run();
  if (result.meta.changes === 0) {
    throw new HttpError(404, "That note doesn't exist.");
  }
  return new Response(null, { status: 204 });
}
