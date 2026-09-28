export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const maxBodyBytes = 1_000_000;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

export async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) {
    throw new HttpError(415, "Send the request body as JSON.");
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBodyBytes) {
    throw new HttpError(413, "The note is too large. Keep it under 500 KB.");
  }
  const text = await request.text();
  if (text.length > maxBodyBytes) {
    throw new HttpError(413, "The note is too large. Keep it under 500 KB.");
  }
  try {
    const body = JSON.parse(text);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body;
  } catch {
    throw new HttpError(400, "The request body isn't valid JSON.");
  }
}

export function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  Object.entries(extra).forEach(([name, value]) => headers.set(name, value));
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}
