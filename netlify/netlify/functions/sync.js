// ── Conqur Cloud Sync — State sync function ────────────────────────────────
// GET  /.netlify/functions/sync   → download state from cloud
// PUT  /.netlify/functions/sync   → upload state to cloud
// Requires Authorization: Bearer <token> header

const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const SECRET = process.env.JWT_SECRET || "changeme-MUST-set-JWT_SECRET-in-Netlify";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
};

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const user = verifyToken(event.headers.authorization || event.headers.Authorization || "");
  if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Unauthorized" }) };

  const store = getStore("conqur-state");
  const key   = `state-${user.uid}`;

  if (event.httpMethod === "GET") {
    const data = await store.get(key, { type: "text" }).catch(() => null);
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: data || "null",
    };
  }

  if (event.httpMethod === "PUT") {
    if (!event.body) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "No body" }) };
    // Basic sanity check — must be JSON with a challenges key
    try {
      const parsed = JSON.parse(event.body);
      if (typeof parsed !== "object" || !("challenges" in parsed)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid state object" }) };
      }
    } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    await store.set(key, event.body);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
};
