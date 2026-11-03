// /api/whitelist — stores whitelist sign-ups in the project's Upstash Redis.
//   POST /api/whitelist                      { x, wallet }  → { ok, already, permit }
//   GET  /api/whitelist?key=ADMIN_KEY        → { total }
//   GET  /api/whitelist?key=ADMIN_KEY&export=csv → CSV of every entry
import { getAddress } from "ethers";

const envEnd = (suffix, skip) => process.env["KV" + suffix] || process.env["UPSTASH_REDIS" + suffix] ||
  Object.entries(process.env).find(([k, v]) => k.endsWith(suffix) && !(skip && k.includes(skip)) && v)?.[1] || "";
const KV_URL = envEnd("_REST_API_URL");
const KV_TOKEN = envEnd("_REST_API_TOKEN", "READ_ONLY");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const KEY = "wl:elysium";           // hash: wallet(lowercase) -> JSON entry
const USER = /^[A-Za-z0-9_]{1,15}$/;

async function kv(...cmd) {
  const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error("storage: " + j.error);
  return j.result;
}
const hashToObj = r => { if (!r) return {}; if (!Array.isArray(r)) return r; const o = {}; for (let i = 0; i < r.length; i += 2) o[r[i]] = r[i + 1]; return o; };

// same permit id the page prints on the card
function hash(s) { let h = 2166136261; for (const ch of s.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const permitId = w => { const h = hash(w).toString(36).toUpperCase().padStart(7, "0"); return "FFGG-" + h.slice(0, 3) + "-" + h.slice(3, 7); };
const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (!KV_URL || !KV_TOKEN) return res.status(503).json({ error: "Storage is not connected." });
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!ADMIN_KEY || q.key !== ADMIN_KEY) return res.status(401).json({ error: "Not allowed." });
      if (q.export === "csv") {
        const all = hashToObj(await kv("HGETALL", KEY));
        const rows = [["wallet", "x_username", "permit_id", "joined_at"]];
        for (const [w, v] of Object.entries(all)) { const e = JSON.parse(v); rows.push([e.w || w, "@" + e.x, e.p, e.t]); }
        rows.splice(1, rows.length, ...rows.slice(1).sort((a, b) => a[3] < b[3] ? -1 : 1));
        res.setHeader("content-type", "text/csv; charset=utf-8");
        res.setHeader("content-disposition", 'attachment; filename="ffgg-whitelist-elysium.csv"');
        return res.status(200).send(rows.map(r => r.map(csvCell).join(",")).join("\n"));
      }
      return res.status(200).json({ total: +(await kv("HLEN", KEY)) || 0 });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const x = String(b.x || "").trim().replace(/^@/, "");
    if (!USER.test(x)) return res.status(400).json({ error: "Invalid X username." });
    let wallet; try { wallet = getAddress(String(b.wallet || "").trim().toLowerCase()); } catch { return res.status(400).json({ error: "Invalid wallet address." }); }

    // light rate limit: 20 sign-ups per IP per 10 minutes
    const ip = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
    const rk = `wl:rl:${ip}:${Math.floor(Date.now() / 600000)}`;
    const n = await kv("INCR", rk); if (+n === 1) await kv("EXPIRE", rk, 900);
    if (+n > 20) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });

    const permit = permitId(wallet);
    const fresh = await kv("HSETNX", KEY, wallet.toLowerCase(), JSON.stringify({ w: wallet, x, p: permit, t: new Date().toISOString() }));
    return res.status(200).json({ ok: true, already: !+fresh, permit });
  } catch (e) {
    return res.status(500).json({ error: "Server error: " + e.message });
  }
}
