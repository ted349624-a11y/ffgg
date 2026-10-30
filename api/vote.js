// /api/vote — Member Pass gated, secret chapter vote.
//   GET  /api/vote                 round state (totals only while open; full results once closed)
//   GET  /api/vote?wallet=0x..     + role (member/reader), weight, hasVoted for that wallet
//   POST /api/vote                 { wallet, choice, issued, signature }
//   GET  /api/vote?key=ADMIN_KEY   full tallies at any time
//   GET  /api/vote?key=ADMIN_KEY&export=csv   voter list for the airdrop
// Storage: Upstash Redis (Vercel Marketplace) via its REST API.
import { verifyMessage, getAddress } from "ethers";
import { VOTE as BASE, voteMessage, phaseAt, passReady } from "../lib/vote-shared.js";

// Upstash env names depend on the prefix chosen when connecting (KV_, STORAGE_, …) — accept any.
const envEnd = (suffix, skip) => process.env["KV" + suffix] || process.env["UPSTASH_REDIS" + suffix] ||
  Object.entries(process.env).find(([k, v]) => k.endsWith(suffix) && !(skip && k.includes(skip)) && v)?.[1] || "";
const KV_URL = envEnd("_REST_API_URL") || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = envEnd("_REST_API_TOKEN", "READ_ONLY") || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";

function config() {
  // optional override for testing / emergencies, never required
  if (!process.env.VOTE_CONFIG_JSON) return BASE;
  const o = JSON.parse(process.env.VOTE_CONFIG_JSON);
  return { ...BASE, ...o, nft: { ...BASE.nft, ...(o.nft || {}) }, round: { ...BASE.round, ...(o.round || {}) } };
}

async function kv(...cmd) {
  const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error("storage: " + j.error);
  return j.result;
}
const hashToObj = r => { if (!r) return {}; if (!Array.isArray(r)) return r; const o = {}; for (let i = 0; i < r.length; i += 2) o[r[i]] = r[i + 1]; return o; };

const pad = v => BigInt(v).toString(16).padStart(64, "0");
async function passBalance(cfg, wallet) {
  if (!passReady(cfg)) return 0n;            // pass not live yet: everyone is a reader
  const n = cfg.nft, data = n.standard === "erc1155"
    ? "0x00fdd58e" + pad(wallet) + pad(n.tokenId || 0)     // balanceOf(address,uint256)
    : "0x70a08231" + pad(wallet);                          // balanceOf(address)
  const tag = n.snapshotBlock ? "0x" + Number(n.snapshotBlock).toString(16) : "latest";
  let lastErr;
  for (const url of n.rpc) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: n.contract, data }, tag] }) });
      const j = await r.json(); if (j.error) throw new Error(j.error.message);
      return BigInt(j.result && j.result !== "0x" ? j.result : "0x0");
    } catch (e) { lastErr = e; }
  }
  throw new Error("could not read Member Pass balance" + (lastErr ? ": " + lastErr.message : ""));
}

function publicRound(cfg, phase) {
  return {
    phase, round: cfg.round, readerThreshold: cfg.readerThreshold, chain: cfg.nft.chain, contract: cfg.nft.contract, passLive: passReady(cfg),
    options: cfg.options.map(({ key, title, teaser, img, pos, sfx }) => ({ key, title, teaser, img, pos, sfx }))
  };
}

async function results(cfg) {
  const id = cfg.round.id;
  const [m, r] = await Promise.all([kv("HGETALL", `tally:${id}:member`), kv("HGETALL", `tally:${id}:reader`)]);
  const mem = hashToObj(m), rea = hashToObj(r), members = {}, readers = {};
  for (const o of cfg.options) { members[o.key] = +(mem[o.key] || 0); readers[o.key] = +(rea[o.key] || 0); }
  // winner: most member votes; tie → more reader points; still tied → option order
  let winner = null;
  for (const o of cfg.options) {
    if (!winner || members[o.key] > members[winner] || (members[o.key] === members[winner] && readers[o.key] > readers[winner])) winner = o.key;
  }
  if (Object.values(members).every(v => v === 0)) winner = null;
  const readerPoints = winner ? readers[winner] : 0;
  return { members, readers, winner, readerPoints, unlocked: !!winner && readerPoints >= cfg.readerThreshold };
}

async function counts(cfg) {
  const c = hashToObj(await kv("HGETALL", `count:${cfg.round.id}`));
  return { members: +(c.member || 0), memberVotes: +(c.memberWeight || 0), readers: +(c.reader || 0) };
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const cfg = config(), phase = phaseAt(cfg, Date.now()), storage = !!(KV_URL && KV_TOKEN);
  try {
    if (req.method === "GET") {
      const q = req.query || {}, out = { ...publicRound(cfg, phase), storage };
      const admin = ADMIN_KEY && q.key === ADMIN_KEY;
      if (storage && phase !== "preview") {
        out.totals = await counts(cfg);
        if (phase === "closed" || admin) out.results = await results(cfg);
        if (admin && q.export === "csv") return csv(res, cfg, out.results);
      }
      if (q.wallet && phase !== "preview") {
        let wallet; try { wallet = getAddress(String(q.wallet)); } catch { return res.status(400).json({ error: "Invalid wallet address." }); }
        const bal = await passBalance(cfg, wallet);
        out.me = { wallet, role: bal > 0n ? "member" : "reader", weight: bal > 0n ? Number(bal) : 1,
          hasVoted: false };
        if (storage) out.me.hasVoted = !!(await kv("HEXISTS", `votes:${cfg.round.id}:${out.me.role}`, wallet.toLowerCase()));
      }
      return res.status(200).json(out);
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    if (!storage) return res.status(503).json({ error: "Voting storage is not connected yet." });
    if (phase !== "open") return res.status(403).json({ error: phase === "closed" ? "This vote has closed." : "Voting is not open yet." });

    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const choice = String(b.choice || ""), issued = String(b.issued || "");
    if (!cfg.options.some(o => o.key === choice)) return res.status(400).json({ error: "Unknown option." });
    let wallet; try { wallet = getAddress(String(b.wallet)); } catch { return res.status(400).json({ error: "Invalid wallet address." }); }
    const age = Date.now() - Date.parse(issued);
    if (!(age > -120000 && age < 600000)) return res.status(400).json({ error: "Signature expired — please sign again." });
    let signer;
    try { signer = verifyMessage(voteMessage({ round: cfg.round.id, choice, wallet, issued }), String(b.signature || "")); }
    catch { return res.status(400).json({ error: "Bad signature." }); }
    if (signer.toLowerCase() !== wallet.toLowerCase()) return res.status(401).json({ error: "Signature does not match this wallet." });

    const bal = await passBalance(cfg, wallet);
    const role = bal > 0n ? "member" : "reader", weight = role === "member" ? Number(bal) : 1, id = cfg.round.id;
    const rec = JSON.stringify({ c: choice, r: role, w: weight, t: new Date().toISOString() });
    // one vote per wallet per role: a reader who later holds a pass can still cast a member vote
    const fresh = await kv("HSETNX", `votes:${id}:${role}`, wallet.toLowerCase(), rec);
    if (!+fresh) return res.status(409).json({ error: `This wallet has already voted as a ${role} in this round.` });
    await kv("HINCRBY", `tally:${id}:${role}`, choice, weight);
    await kv("HINCRBY", `count:${id}`, role, 1);
    if (role === "member") await kv("HINCRBY", `count:${id}`, "memberWeight", weight);
    return res.status(200).json({ ok: true, role, weight });
  } catch (e) {
    return res.status(500).json({ error: "Server error: " + e.message });
  }
}

async function csv(res, cfg, r) {
  const rows = [["wallet", "role", "choice", "weight", "backed_winner", "airdrop_eligible", "voted_at"]];
  const all = [];
  for (const role of ["member", "reader"]) for (const e of Object.entries(hashToObj(await kv("HGETALL", `votes:${cfg.round.id}:${role}`)))) all.push(e);
  for (const [w, v] of all) {
    const x = JSON.parse(v), backed = !!r.winner && x.c === r.winner;
    rows.push([w, x.r, x.c, x.w, backed, backed && r.unlocked, x.t]);
  }
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="ffgg-vote-${cfg.round.id}.csv"`);
  return res.status(200).send(rows.map(r => r.join(",")).join("\n"));
}
