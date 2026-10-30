// Shared by the /vote page (browser) and /api/vote (server). Nothing secret lives here.

export const VOTE = {
  // ---- Member Pass NFT: fill in after the OpenSea mint ----
  nft: {
    contract: "",            // Member Pass contract address (CA)
    chain: "",               // e.g. "Ethereum", "Base" (shown on the page)
    rpc: [],                 // public RPC URL(s) for that chain
    standard: "erc721",      // "erc721" or "erc1155" (OpenSea editions are erc1155)
    tokenId: null,           // only for erc1155
    snapshotBlock: null      // optional: count passes held at this block (stops vote-then-transfer)
  },

  // ---- Current round ----
  round: {
    id: "ch2",
    chapter: 2,
    title: "Which page do we save first?",
    opensAt: null,           // ISO time, e.g. "2026-11-03T18:00:00Z"
    closesAt: null           // ISO time
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
  if (!cfg.nft.contract || !cfg.nft.rpc.length) return "preview";
  const o = cfg.round.opensAt ? Date.parse(cfg.round.opensAt) : null;
  const c = cfg.round.closesAt ? Date.parse(cfg.round.closesAt) : null;
  if (!o || nowMs < o) return "soon";
  if (c && nowMs >= c) return "closed";
  return "open";
}
