import { receiptForCard } from "./receiptData.js";
import { chainReceiptView } from "../../../review-app/src/ui/chainReceiptView.js";
import { disposePtbGraphs } from "../../../review-app/src/ui/ptbDiagram.js";
import { asRecord } from "../../../review-app/src/parse.js";
import { element } from "../../../review-app/src/ui/ui.js";
import type { CardRenderer } from "./lifecycle.js";
import "../../../review-app/src/receipt.css";

export const receiptRenderer: CardRenderer = {
  title: "Transaction result",
  controls(snapshot, submit) {
    const form = document.createElement("form");
    const digest = document.createElement("input"); digest.required = true; digest.name = "digest";
    digest.placeholder = "Transaction digest"; digest.setAttribute("aria-label", "Sui transaction digest");
    digest.value = String(snapshot.input.digest ?? "");
    const button = document.createElement("button"); button.type = "submit"; button.textContent = "Show transaction";
    form.append(digest, button);
    form.addEventListener("submit", (event) => { event.preventDefault(); submit({ digest: digest.value.trim() }); });
    return form;
  },
  result(snapshot, display) {
    const result = asRecord(snapshot.data);
    if (result?.status !== "found") {
      const message = result?.status === "not_found" ? "The transaction was not found." : "Transaction data is unavailable.";
      return { node: element("p", "ui-note", message) };
    }
    const receipt = receiptForCard(snapshot, display);
    const node = chainReceiptView(receipt);
    const notice = display ? "" : "Input values and PTB display details are unavailable; this does not mean the transaction had no inputs.";
    if (notice) node.prepend(element("p", "ui-note", notice));
    return { node, dispose: () => disposePtbGraphs(node) };
  }
};
