import { formatWalletAssetRow, type WalletAssetRow } from "../../../review-app/src/walletAssetRow.js";
import { asRecord } from "../../../review-app/src/parse.js";
import { accordion, card, element, info, mono, placeholder, row } from "../../../review-app/src/ui/ui.js";
import { qualifiedName } from "../../../review-app/src/format.js";
import { t } from "../../../review-app/src/i18n/i18n.js";
import type { CardRenderer } from "./lifecycle.js";
import "../../../review-app/src/account.css";

export const accountRenderer = {
  title: "Account assets",
  controls(snapshot, submit) {
    const form = document.createElement("form");
    const address = document.createElement("input");
    address.name = "account"; address.required = true; address.placeholder = "Sui address";
    address.setAttribute("aria-label", "Sui account address"); address.value = String(snapshot.input.account ?? "");
    const button = document.createElement("button"); button.type = "submit"; button.textContent = "Show assets";
    form.append(address, button);
    form.addEventListener("submit", (event) => { event.preventDefault(); submit({ account: address.value.trim() }); });
    return form;
  },
  result(snapshot) {
    const payload = asRecord(snapshot.data);
    if (!payload || payload.status !== "ok" || !Array.isArray(payload.balances) ||
        typeof payload.account !== "string" || !Array.isArray(payload.nfts) || !Array.isArray(payload.objectGroups) ||
        typeof payload.objectsTruncated !== "boolean" || typeof payload.fetchedAt !== "string") throw new Error("Account data is incomplete.");
    const node = element("div");
    node.append(identityCard(payload.account, payload), balanceCard(payload), nftCard(payload), objectsCard(payload));
    return { node };
  }
} satisfies CardRenderer;

function identityCard(address: string, payload: Record<string, unknown>): HTMLElement {
  const node = card(t.account.identity);
  const name = typeof payload.name === "string" && payload.name.length > 0 ? payload.name : undefined;
  node.append(row(t.account.name, name ?? t.account.noName));
  node.append(row(t.account.address, mono(address)));
  const fetchedAt = typeof payload.fetchedAt === "string" ? payload.fetchedAt : undefined;
  if (fetchedAt) {
    node.append(row(t.account.checkedAt, fetchedAt));
  }
  return node;
}

// Card 2: coin balances, each with the held-as split on a hover tooltip.
function balanceCard(payload: Record<string, unknown>): HTMLElement {
  const node = card(t.account.balances);
  const balances = Array.isArray(payload.balances) ? payload.balances : [];
  if (balances.length === 0) {
    node.append(placeholder(t.account.noBalances));
    return node;
  }
  for (const entry of balances) {
    const assetRow = formatWalletAssetRow(entry);
    if (assetRow) {
      node.append(assetBreakdownRow(assetRow));
    }
  }
  return node;
}

// Card 3: owned NFTs (objects with a Display name/image) as an image grid. Images
// load directly from their external host (page CSP allows external https), with a
// no-referrer policy so only the image bytes are requested.
function nftCard(payload: Record<string, unknown>): HTMLElement {
  const node = card(t.account.nfts);
  const nfts = Array.isArray(payload.nfts) ? payload.nfts : [];
  if (nfts.length === 0) {
    node.append(placeholder(t.account.noNfts));
    return node;
  }
  const grid = element("div", "account-nfts");
  for (const raw of nfts) {
    const nft = asRecord(raw);
    if (nft) {
      grid.append(nftTile(nft));
    }
  }
  node.append(grid);
  return node;
}

function nftTile(nft: Record<string, unknown>): HTMLElement {
  const type = typeof nft.type === "string" ? nft.type : "";
  const name = typeof nft.name === "string" && nft.name.length > 0 ? nft.name : qualifiedName(type);
  const imageUrl = typeof nft.imageUrl === "string" && nft.imageUrl.length > 0 ? imageSrc(nft.imageUrl) : undefined;
  const tile = element("div", "account-nft");
  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "account-nft-img";
    img.src = imageUrl;
    img.alt = name;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    // A failed external image is replaced with a "No image" box rather than the
    // browser's broken-image glyph.
    img.addEventListener("error", () => {
      img.replaceWith(element("div", "account-nft-img account-nft-noimg", t.account.noImage));
    });
    tile.append(img);
  } else {
    tile.append(element("div", "account-nft-img account-nft-noimg", t.account.noImage));
  }
  tile.append(element("span", "account-nft-name", name));
  return tile;
}

// Card 4: other owned objects (non-coin, no Display), grouped by Move type.
// Collapsed by default — the list can be long (one row per distinct type), so it
// slides open from a summary that shows the group count.
function objectsCard(payload: Record<string, unknown>): HTMLElement {
  const groups = Array.isArray(payload.objectGroups) ? payload.objectGroups : [];
  const { details, body } = accordion(`${t.account.objects} (${groups.length})`);
  if (groups.length === 0) {
    body.append(placeholder(t.account.noObjects));
  } else {
    for (const raw of groups) {
      const group = asRecord(raw);
      if (!group) {
        continue;
      }
      const type = typeof group.type === "string" ? group.type : "";
      const count = typeof group.count === "number" ? group.count : 0;
      body.append(row(qualifiedName(type), `×${count}`));
    }
  }
  if (payload.objectsTruncated === true) {
    body.append(placeholder(t.account.objectsTruncated));
  }
  return details;
}

// One coin's holdings as a list item: symbol → total, with the held-as split
// (object vs account balance) on a hover tooltip after the total.
function assetBreakdownRow(assetRow: WalletAssetRow): HTMLElement {
  const node = element("div", "account-asset");
  node.append(element("span", "account-asset-symbol", assetRow.symbol));
  const total = element("span", "account-asset-total");
  total.append(assetRow.total);
  if (assetRow.object !== undefined || assetRow.account !== undefined) {
    total.append(
      " ",
      info(`${t.account.heldObject} ${assetRow.object ?? "0"} · ${t.account.heldAccount} ${assetRow.account ?? "0"}`)
    );
  }
  node.append(total);
  return node;
}

// NFT image hosts vary; ipfs:// URLs are rewritten to a public gateway so the
// browser (which has no ipfs scheme handler) can still load them over https.
function imageSrc(url: string): string {
  const resolved = url.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}` : url;
  try { return (new URL(resolved).protocol === "https:" || /^data:image\//i.test(resolved)) ? resolved : ""; } catch { return ""; }
}
