import { parseReceipt } from "../../../review-app/src/receiptFacts.js";
import { asRecord } from "../../../review-app/src/parse.js";
import type { CardSnapshot, CardReceiptDisplay } from "../contracts.js";

export function receiptForCard(snapshot: CardSnapshot, display?: CardReceiptDisplay) {
  const result = asRecord(snapshot.data);
  const receipt = parseReceipt(result?.receipt);
  if (!receipt) throw new Error("Transaction data is incomplete.");
  if (display) {
    if (display.transactionDigest !== receipt.txDigest || display.cardId !== snapshot.cardId || display.revision !== snapshot.revision) {
      throw new Error("Receipt display details do not match this transaction.");
    }
    for (const value of display.pureInputs) {
      const input = receipt.inputs.find((item) => item.index === value.index);
      if (!input || input.kind !== "pure") throw new Error("Receipt input details do not match this transaction.");
      input.bytes = value.bytes;
    }
    receipt.ptbGraph = display.ptbGraph;
  }
  return receipt;
}
