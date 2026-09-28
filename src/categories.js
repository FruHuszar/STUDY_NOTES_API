import { HttpError, json, readJson } from "./http.js";
import * as valid from "./validate.js";

function requiredName(value) {
  const name = valid.categoryName(value);
  if (!name) {
    throw new HttpError(400, "Name the category.");
  }
  return name;
}

export async function save({ env, user, request }) {
  const body = await readJson(request);
  const name = requiredName(body.name);
  const color = valid.color(body.color);
  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE owner = ?1 AND name != ?2"
  )
    .bind(user.id, name)
    .first();
  if (count >= valid.limits.categoriesPerUser) {
    throw new HttpError(409, `You've reached ${valid.limits.categoriesPerUser} category colors.`);
  }
  const saved = await env.DB.prepare(
    `INSERT INTO categories (owner, name, color) VALUES (?1, ?2, ?3)
     ON CONFLICT (owner, name) DO UPDATE SET color = excluded.color
     RETURNING name, color`
  )
    .bind(user.id, name, color)
    .first();
  return json(saved);
}

export async function rename({ env, user, request }) {
  const body = await readJson(request);
  const from = requiredName(body.from);
  const to = requiredName(body.to);
  const color = valid.color(body.color);
  if (from === to) {
    return json({ name: to, color });
  }
  const taken = await env.DB.prepare("SELECT 1 FROM categories WHERE owner = ?1 AND name = ?2")
    .bind(user.id, to)
    .first();
  if (taken) {
    throw new HttpError(409, `A category named "${to}" already exists.`);
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE notes SET category = ?1, version = version + 1, updated_at = ?2 WHERE owner = ?3 AND category = ?4"
    ).bind(to, new Date().toISOString(), user.id, from),
    env.DB.prepare("INSERT INTO categories (owner, name, color) VALUES (?1, ?2, ?3)").bind(user.id, to, color),
    env.DB.prepare("DELETE FROM categories WHERE owner = ?1 AND name = ?2").bind(user.id, from)
  ]);
  return json({ name: to, color });
}

export async function remove({ env, user, params }) {
  let decoded;
  try {
    decoded = decodeURIComponent(params[0]);
  } catch {
    throw new HttpError(404, "That category doesn't exist.");
  }
  const name = requiredName(decoded);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE notes SET category = '', version = version + 1, updated_at = ?1 WHERE owner = ?2 AND category = ?3"
    ).bind(new Date().toISOString(), user.id, name),
    env.DB.prepare("DELETE FROM categories WHERE owner = ?1 AND name = ?2").bind(user.id, name)
  ]);
  return new Response(null, { status: 204 });
}
