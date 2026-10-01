import type { PublicChainReceipt } from "../../../src/core/action/suiChainReceiptReader.js";
import { accordion, element } from "./ui.js";
import { receiptSummary } from "./receiptSummary.js";
import { chainReceiptDetails } from "./chainReceiptView.js";
import { transactionGraph, disposePtbGraphs } from "./ptbDiagram.js";

// Both result cards display the executed transaction, never the earlier estimate
// in place of a missing chain graph. Private details remain bound by the caller.
export function receiptView(receipt: PublicChainReceipt, reviewedConditions?: HTMLElement) {
  const node = element("div");
  let disposed = false, rendered = false;
  const dispose = () => { if (!disposed) { disposed = true; disposePtbGraphs(node); } };
  try {
    node.append(receipt.ptbGraph ? transactionGraph({ source: "receipt", mermaid: receipt.ptbGraph.mermaid }) :
      element("p", "ui-note", "The transaction graph is unavailable. The recorded result is shown below."));
    node.append(receiptSummary(receipt));
    const details = accordion("Details");
    details.details.addEventListener("toggle", () => {
      if (disposed || rendered || !details.details.open || !details.details.isConnected) return;
      try {
        details.body.replaceChildren(chainReceiptDetails(receipt));
        if (reviewedConditions) details.body.append(reviewedConditions);
        rendered = true;
      } catch {
        details.body.replaceChildren(element("p", "ui-error", "These details could not be displayed. Close and reopen the details to try again."));
      }
    });
    node.append(details.details);
    return { node, dispose };
  } catch (error) { dispose(); throw error; }
}
