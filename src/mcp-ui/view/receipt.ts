import { receiptForCard } from "./receiptData.js";
import { chainReceiptView } from "../../../review-app/src/ui/chainReceiptView.js";
import { disposePtbGraphs } from "../../../review-app/src/ui/ptbDiagram.js";
import { asRecord } from "../../../review-app/src/parse.js";
import { element } from "../../../review-app/src/ui/ui.js";
import type { CardRenderer } from "./lifecycle.js";
import "../../../review-app/src/receipt.css";

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
    const node = chainReceiptView(receipt, { summary: true });
    return { node, dispose: () => disposePtbGraphs(node) };
  }
} satisfies CardRenderer;
