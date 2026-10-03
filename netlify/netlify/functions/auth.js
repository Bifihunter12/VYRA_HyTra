// ── Conqur Cloud Sync — Auth function ─────────────────────────────────────
// Handles signup / signin using Netlify Blobs for user storage.
// Requires environment variable: JWT_SECRET (set in Netlify dashboard → Site settings → Environment variables)
//
// Token format: base64url(payload) . base64url(hmac-sha256-sig)
// No external npm deps — only Node built-ins + @netlify/blobs.

const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const SECRET   = process.env.JWT_SECRET || "changeme-MUST-set-JWT_SECRET-in-Netlify";
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function makeToken(uid, email) {
  const payload = Buffer.from(JSON.stringify({ uid, email, exp: Date.now() + TOKEN_TTL }))
    .toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function ok(body)    { return { statusCode: 200, headers: { ...CORS, "Content-Type":"application/json" }, body: JSON.stringify(body) }; }
function err(status, msg) { return { statusCode: status, headers: { ...CORS, "Content-Type":"application/json" }, body: JSON.stringify({ error: msg }) }; }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return err(405, "Method Not Allowed");

  let body;
  try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }

  const { action, email, password } = body;
  if (!action) return err(400, "action required");

  if (!email || typeof email !== "string") return err(400, "Valid email required");
  const cleanEmail = email.toLowerCase().trim();
  const uid = crypto.createHash("sha256").update(cleanEmail).digest("hex").slice(0, 20);

  if (action === "signup" || action === "signin") {
    if (!password || typeof password !== "string" || password.length < 8) {
      return err(400, "Password must be at least 8 characters");
    }
    const pwHash = crypto.createHash("sha256").update(uid + ":" + password).digest("hex");

    let store;
    try {
      store = getStore("conqur-users");
    } catch(e) {
      console.error("getStore failed:", e);
      return err(500, "Storage unavailable — try again in a moment.");
    }

    if (action === "signup") {
      try {
        const existing = await store.get(uid, { type: "text" });
        if (existing) return err(409, "Email already registered — sign in instead.");
      } catch(e) { /* not found = null, that's fine */ }
      try {
        await store.set(uid, JSON.stringify({ email: cleanEmail, pwHash, createdAt: Date.now() }));
      } catch(e) {
        console.error("store.set failed:", e);
        return err(500, "Could not save account — try again.");
      }
      return ok({ token: makeToken(uid, cleanEmail), uid, email: cleanEmail });
    }

    if (action === "signin") {
      let raw = null;
      try { raw = await store.get(uid, { type: "text" }); } catch(e) { raw = null; }
      if (!raw) return err(401, "Invalid email or password");
      const user = JSON.parse(raw);
      if (user.pwHash !== pwHash) return err(401, "Invalid email or password");
      return ok({ token: makeToken(uid, user.email), uid, email: user.email });
    }
  }

  return err(400, "Unknown action");
};
