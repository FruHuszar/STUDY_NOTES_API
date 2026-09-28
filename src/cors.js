const allowedOrigins = (env) =>
  String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

export const isOriginAllowed = (origin, env) => allowedOrigins(env).includes(origin);

export function corsHeaders(origin, env) {
  if (!origin || !isOriginAllowed(origin, env)) {
    return { Vary: "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
