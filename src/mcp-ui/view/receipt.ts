import { receiptForCard } from "./receiptData.js";
import { receiptSummary } from "../../../review-app/src/ui/receiptSummary.js";
import { asRecord } from "../../../review-app/src/parse.js";
import { element } from "../../../review-app/src/ui/ui.js";
import type { CardRenderer } from "./lifecycle.js";

export const receiptRenderer = {
  title: "Transaction result",
  controls: () => element("p", "ui-note", "Please provide a transaction hash in chat."),
  result(snapshot, display) {
    const result = asRecord(snapshot.data);
    if (result?.status !== "found") {
      const message = result?.status === "not_found" ? "The transaction was not found." : "Transaction data is unavailable.";
      return { node: element("p", "ui-note", message) };
    }
    const receipt = receiptForCard(snapshot, display);
    return { node: receiptSummary(receipt) };
  }
} satisfies CardRenderer;
