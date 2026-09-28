import { HttpError } from "./http.js";

export const limits = Object.freeze({
  title: 200,
  category: 40,
  content: 500_000,
  notesPerUser: 2000,
  categoriesPerUser: 200
});

const noteId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hexColor = /^#[0-9a-f]{6}$/;

export function categoryName(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "Category must be text.");
  }
  const name = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (name.length > limits.category) {
    throw new HttpError(400, `Keep the category under ${limits.category} characters.`);
  }
  return name;
}

export function noteFields(body) {
  const { title, content } = body;
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new HttpError(400, "Give the note a title.");
  }
  if (title.trim().length > limits.title) {
    throw new HttpError(400, `Keep the title under ${limits.title} characters.`);
  }
  if (content !== undefined && typeof content !== "string") {
    throw new HttpError(400, "Note content must be text.");
  }
  const text = content || "";
  if (new TextEncoder().encode(text).length > limits.content) {
    throw new HttpError(413, "The note is too large. Keep it under 500 KB.");
  }
  return { title: title.trim(), category: categoryName(body.category), content: text };
}

export function version(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "Include the note's version so changes made elsewhere aren't overwritten.");
  }
  return value;
}

export function id(value) {
  if (!noteId.test(value)) {
    throw new HttpError(404, "That note doesn't exist.");
  }
  return value;
}

export function color(value) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!hexColor.test(normalized)) {
    throw new HttpError(400, "Pick a color like #5f9e6e.");
  }
  return normalized;
}
