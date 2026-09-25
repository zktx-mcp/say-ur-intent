import QRCode from "qrcode";
import { workflowViewSchema } from "../../core/session/workflowView.js";
import type { CardSnapshot, CardWalletDisplay } from "../contracts.js";
import { card, element, row } from "../../../review-app/src/ui/ui.js";
import type { CardRenderer } from "./lifecycle.js";
import "./workflow.css";

function connectionView(snapshot: CardSnapshot, act?: (input: Record<string, unknown>) => void, wallet?: CardWalletDisplay) {
  const data = workflowViewSchema.parse(snapshot.data);
  const node = element("div", "workflow-card");
  const facts = card("Wallet connection");
  facts.append(row("Network", "Sui mainnet"), row("Read account", data.activeAccount ?? "Not set"));
  node.append(facts);
  if (data.walletAvailability.status === "unavailable") facts.append(element("p", "ui-note", data.walletAvailability.message));
  const action = (label: string, input: Record<string, unknown>) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.dataset.cardAction = String(input.action); button.disabled = !act;
    button.addEventListener("click", () => act?.(input)); return button;
  };
  if (data.allowedActions.includes("connect")) facts.append(action("Connect a wallet", { action: "connect" }));
  const connected = data.connections.filter((connection) => connection.status === "connected" && connection.pendingAction === undefined);
  if (connected.length && data.allowedActions.includes("use_account")) {
    const form = document.createElement("form"), select = document.createElement("select");
    select.className = "workflow-select"; select.required = true; select.setAttribute("aria-label", "Wallet account to use for reads");
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Select a wallet account"; select.append(placeholder);
    const choices = connected.flatMap((connection) => connection.accounts.map((account) => ({ connection, account })));
    for (const choice of choices) {
      const option = document.createElement("option"); option.value = `${choice.connection.connectionId}:${choice.account}`;
      option.textContent = `${choice.connection.walletName ?? "Wallet"} · ${choice.account}`; select.append(option);
    }
    const use = document.createElement("button"); use.type = "submit"; use.textContent = "Use this account for reads"; use.dataset.cardAction = "use_account";
    form.append(select, use); form.addEventListener("submit", (event) => {
      event.preventDefault(); const choice = choices.find((item) => `${item.connection.connectionId}:${item.account}` === select.value);
      if (choice) act?.({ action: "use_account", connectionId: choice.connection.connectionId, account: choice.account });
    }); facts.append(form);
  }
  if (connected.length && data.allowedActions.includes("disconnect")) {
    const controls = card("Manage an existing connection");
    for (const connection of connected) {
      const item = element("div", "workflow-section");
      item.append(row(connection.walletName ?? "Wallet", connection.accounts.join(", ")),
        action("Disconnect this wallet", { action: "disconnect", connectionId: connection.connectionId })); controls.append(item);
    }
    node.append(controls);
  }
  let canvas: HTMLCanvasElement | undefined;
  if (data.connection) {
    if (data.connection.pendingAction === "disconnect" && data.progress.status === "waiting") facts.append(element("p", "ui-note", "Wallet disconnection is in progress."));
    facts.append(row(data.walletAvailability.status === "unavailable" ? "Last recorded status" : "Status", data.connection.status), row("Updated", data.connection.updatedAt), row("Connection", data.connection.connectionId), row("Expires", data.connection.expiresAt));
    if (data.connection.walletName) facts.append(row("Wallet", data.connection.walletName));
    for (const account of data.connection.accounts) facts.append(row("Approved account", account));
    if (data.connection.reason) facts.append(element("p", "ui-note", data.connection.reason));
    if (data.connection.status === "awaiting_approval" && data.walletAvailability.status === "available") {
      if (wallet && wallet.connectionId === data.connection.connectionId) {
        canvas = document.createElement("canvas"); canvas.className = "workflow-qr";
        canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "WalletConnect pairing QR code");
        facts.append(element("p", "ui-note", "Scan this QR code in your Sui wallet, then review the connection request."), canvas);
      } else facts.append(element("p", "ui-note", "Pairing display data is unavailable in this view. Reopen this same card to read its current state; this does not create a new pairing."));
    }
  }
  if (data.allowedActions.includes("stop_connection")) facts.append(action("Stop waiting", { action: "stop_connection" }));
  if (data.allowedActions.includes("cancel")) facts.append(action("Cancel this selection", { action: "cancel" }));
  node.append(element("p", "ui-note", data.boundary));
  let disposed = false;
  return { node, mount: () => {
    if (canvas && wallet) void QRCode.toCanvas(canvas, wallet.pairingUri).catch(() => {
      if (!disposed) facts.append(element("p", "ui-error", "The pairing QR could not be displayed. Reopen this same card to read its saved state."));
    });
  }, dispose: () => { disposed = true; } };
}

export const connectRenderer = {
  title: "Connect wallet",
  controls: (snapshot, act, _display, wallet) => connectionView(snapshot, act, wallet),
  result: (snapshot, _receipt, act, wallet) => connectionView(snapshot, act, wallet)
} satisfies CardRenderer;
