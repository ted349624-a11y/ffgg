// Shared by the /vote page (browser) and /api/vote (server). Nothing secret lives here.

export const VOTE = {
  // ---- Member Pass NFT: fill in after the OpenSea mint ----
  nft: {
    contract: "0x3A95f310507bEB6dB553Df6724454dD8421FA012",   // Member Pass (CA)
    chain: "Robinhood Chain",
    rpc: ["https://rpc.mainnet.chain.robinhood.com", "https://rpc.nodeflare.app/robinhood/public"],
    standard: "auto",        // detected on chain (ERC-721 or ERC-1155 edition)
    tokenId: null,           // edition token id; if null, ids 0–32 are summed
    snapshotBlock: null      // optional: count passes held at this block (stops vote-then-transfer)
  },

  // ---- Current round ----
  round: {
    id: "ch2",
    chapter: 2,
    title: "Which page do we save first?",
    opensAt: "2026-10-30T13:50:00Z",   // UTC
    closesAt: "2026-10-31T01:50:00Z"   // UTC (12 hours)
  },

  // Reader points the winning option needs for the $FFGG airdrop to unlock (1 reader vote = 1 point)
  readerThreshold: 777,

  options: [
    {
      key: "A", title: "The Library",
      teaser: "Hoshi and you search the half-drawn library for the last pen. But the shelves are already going white.",
      img: "/story/img/stand.webp", pos: "50% 16%", sfx: "シーン"
    },
    {
      key: "B", title: "The Artist's Desk",
      teaser: "Follow the eraser crumbs back to the desk where the artist stopped drawing, and find out why he left.",
      img: "/story/img/face.webp", pos: "56% 40%", sfx: "ゴゴゴ"
    },
    {
      key: "C", title: "Face the Eraser",
      teaser: "No more running. Hoshi draws a sword in the margin and stands between the Eraser and the last street.",
      img: "/story/img/point.webp", pos: "50% 30%", sfx: "ビシッ"
    }
  ]
};

// Member Pass checks only run once the contract (and, for editions, the token id) is set
export function passReady(cfg) {
  return !!(cfg.nft.contract && cfg.nft.rpc.length);
}

// The exact text a wallet signs. Page and server must build it the same way.
export function voteMessage({ round, choice, wallet, issued }) {
  return [
    "Hoshi's Notebook: Chapter vote",
    `Round: ${round}`,
    `Choice: ${choice}`,
    `Wallet: ${wallet.toLowerCase()}`,
    `Issued: ${issued}`,
    "",
    "Signing is free and does not send a transaction."
  ].join("\n");
}

export function phaseAt(cfg, nowMs) {
  if (!cfg.round.opensAt) return "preview";
  const o = cfg.round.opensAt ? Date.parse(cfg.round.opensAt) : null;
  const c = cfg.round.closesAt ? Date.parse(cfg.round.closesAt) : null;
  if (!o || nowMs < o) return "soon";
  if (c && nowMs >= c) return "closed";
  return "open";
}
