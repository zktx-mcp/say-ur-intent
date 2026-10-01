import type { PublicChainReceipt } from "../../../src/core/action/suiChainReceiptReader.js";
import { signedRawToDisplay, suiAmount, typeName } from "../format.js";
import { t } from "../i18n/i18n.js";
import { section, monoShort, placeholder, row, statusBanner } from "./ui.js";

// The same observed amounts and outcome lead both transaction result views.
export function receiptSummary(receipt: PublicChainReceipt): HTMLElement {
  const node = section();
  node.append(statusBanner(receipt.effectsStatus.success ? "success" : "failure",
    receipt.effectsStatus.success ? t.receipt.success : t.receipt.failure));
  if (receipt.balanceChanges.length === 0) node.append(placeholder(t.receipt.noBalanceChanges));
  for (const change of receipt.balanceChanges) {
    const amount = change.decimals === undefined ? "Amount unavailable" :
      `${change.direction === "increase" ? "+" : ""}${signedRawToDisplay(change.amountRaw, change.decimals)}`;
    const item = row(change.symbol ?? typeName(change.coinType), amount);
    if (change.address !== receipt.sender) item.append(row(t.receipt.account, monoShort(change.address)));
    node.append(item);
  }
  node.append(row("Network fee", suiAmount(receipt.gas.totalMist)));
  if (receipt.sender) node.append(row(t.receipt.sender, monoShort(receipt.sender)));
  return node;
}
