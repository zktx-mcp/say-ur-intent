import type { PublicChainReceipt } from "../../../src/core/action/suiChainReceiptReader.js";
import { signedRawToDisplay, suiAmount, typeName } from "../format.js";
import { t } from "../i18n/i18n.js";
import { accordion, card, mono, monoShort, placeholder, row, statusBanner, timeValue } from "./ui.js";

// Shared observed facts only. Keeping graphs out of this module also keeps them
// out of the standalone Receipt bundle.
export function receiptSummary(receipt: PublicChainReceipt): HTMLElement {
  const node = card();
  node.append(statusBanner(receipt.effectsStatus.success ? "success" : "failure",
    receipt.effectsStatus.success ? t.receipt.success : t.receipt.failure));
  if (!receipt.effectsStatus.success && receipt.effectsStatus.errorMessage) {
    const error = accordion("Failure details");
    error.body.append(mono(receipt.effectsStatus.errorMessage)); node.append(error.details);
  }
  if (receipt.balanceChanges.length === 0) node.append(placeholder(t.receipt.noBalanceChanges));
  for (const change of receipt.balanceChanges) {
    const amount = change.decimals === undefined ? "Amount unavailable" :
      `${change.direction === "increase" ? "+" : ""}${signedRawToDisplay(change.amountRaw, change.decimals)}`;
    const item = row(change.symbol ?? typeName(change.coinType), amount);
    if (change.address !== receipt.sender) item.append(row(t.receipt.account, monoShort(change.address)));
    node.append(item);
  }
  node.append(row("Net network fee", suiAmount(receipt.gas.totalMist)));
  if (receipt.sender) node.append(row(t.receipt.sender, monoShort(receipt.sender)));
  node.append(row("Transaction hash", monoShort(receipt.txDigest)), row(t.receipt.checkedAt, timeValue(receipt.fetchedAt)));
  const identifiers = accordion("Transaction identifiers");
  if (receipt.sender) identifiers.body.append(row(t.receipt.sender, mono(receipt.sender)));
  identifiers.body.append(row("Transaction hash", mono(receipt.txDigest)), row("Exact observation time", receipt.fetchedAt));
  node.append(identifiers.details);
  return node;
}
