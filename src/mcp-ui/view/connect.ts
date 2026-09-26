import QRCode from "qrcode";
import { workflowViewSchema, type WorkflowView } from "../../core/session/workflowView.js";
import type { CardSnapshot, CardWalletDisplay } from "../contracts.js";
import { card, element, row, monoShort } from "../../../review-app/src/ui/ui.js";
import type { CardRenderer } from "./lifecycle.js";
import "./workflow.css";

const connectionLabels: Record<NonNullable<WorkflowView["connection"]>["status"], string> = {
  awaiting_approval: "Approve the connection in your wallet", connected: "Wallet connected",
  rejected: "Connection declined", failed: "Connection could not be completed", expired: "Connection expired",
  stopped: "Connection waiting stopped", disconnected: "Wallet disconnected"
};

function connectionView(snapshot: CardSnapshot, act?: (input: Record<string, unknown>) => void, wallet?: CardWalletDisplay) {
  const data = workflowViewSchema.parse(snapshot.data);
  const node = element("div", "workflow-card"), facts = card();
  let disposed = false;
  const connected = data.connections.filter((connection) => connection.status === "connected");
  const available = connected.filter((connection) => connection.pendingAction === undefined);
  const pending = data.connections.some((connection) => connection.status === "awaiting_approval" || connection.pendingAction === "disconnect");
  const action = (label: string, input: Record<string, unknown>) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.dataset.cardAction = String(input.action); button.disabled = !act;
    button.addEventListener("click", () => { if (!disposed) act?.(input); }); return button;
  };
  facts.append(row("Network", "Sui · Mainnet"));
  const status = row(data.walletAvailability.status === "unavailable" ? "Last recorded status" : "Status",
    data.connection ? connectionLabels[data.connection.status] : connected.length ? "Wallet connected" : data.walletAvailability.status === "unavailable" ? "Connection not confirmed" : "No wallet connected");
  status.setAttribute("role", "status"); facts.append(status);
  if (data.walletAvailability.status === "unavailable") {
    facts.append(element("p", "ui-note", "The wallet connection cannot be checked right now. Restart the apps using Say Ur Intent, then try again."));
    if (data.connection && !connected.some((connection) => connection.connectionId === data.connection!.connectionId)) {
      facts.append(row("Last updated", data.connection.updatedAt));
    }
  }
  if (pending && connected.some((connection) => connection.pendingAction === "disconnect")) facts.append(element("p", "ui-note", "Disconnecting wallet…"));
  if (data.connection?.reason) facts.append(element("p", "ui-note", data.connection.reason));
  if (data.activeAccount && connected.some((connection) => connection.accounts.some((account) => account !== data.activeAccount))) {
    facts.append(row("Selected account", monoShort(data.activeAccount)));
  }
  node.append(facts);
  if (!connected.length && !pending && data.allowedActions.includes("connect")) facts.append(action("Connect wallet", { action: "connect" }));

  const choices = available.flatMap((connection) => connection.accounts.map((account) => ({ connection, account })));
  if (data.allowedActions.includes("use_account") && choices.some((choice) => choice.account !== data.activeAccount)) {
    const form = document.createElement("form"), select = document.createElement("select");
    select.className = "workflow-select"; select.required = true; select.setAttribute("aria-label", "Account to use");
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Select an account"; select.append(placeholder);
    for (const choice of choices) {
      const option = document.createElement("option"); option.value = `${choice.connection.connectionId}:${choice.account}`;
      option.textContent = `${choice.connection.walletName ?? "Wallet"} · ${choice.account}`; select.append(option);
    }
    const use = document.createElement("button"); use.type = "submit"; use.textContent = "Use account"; use.dataset.cardAction = "use_account";
    form.append(select, use); form.addEventListener("submit", (event) => {
      event.preventDefault(); const choice = choices.find((item) => `${item.connection.connectionId}:${item.account}` === select.value);
      if (!disposed && choice) act?.({ action: "use_account", connectionId: choice.connection.connectionId, account: choice.account });
    }); facts.append(form);
  }
  for (const connection of connected) {
    const item = card(connection.walletName ?? "Connected wallet");
    if (data.walletAvailability.status === "unavailable") item.append(row("Last updated", connection.updatedAt));
    for (const account of connection.accounts) item.append(row("Account", monoShort(account)));
    if (!connection.pendingAction && data.allowedActions.includes("disconnect")) {
      const controls = element("div", "card-actions");
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Disconnect"; open.dataset.cardAction = "disconnect"; open.disabled = !act;
      open.addEventListener("click", () => {
        if (disposed) return;
        const original = [...node.children];
        const confirmation = card("Disconnect wallet?");
        confirmation.append(row("Wallet", connection.walletName ?? "Wallet"), row("Network", "Sui · Mainnet"));
        for (const account of connection.accounts) confirmation.append(row("Account", monoShort(account)));
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => { if (!disposed) node.replaceChildren(...original); });
        confirmation.append(action("Confirm disconnect", { action: "disconnect", connectionId: connection.connectionId }), cancel);
        node.replaceChildren(confirmation);
      });
      controls.append(open); item.append(controls);
    }
    node.append(item);
  }
  let canvas: HTMLCanvasElement | undefined;
  if (data.connection?.status === "awaiting_approval" && data.walletAvailability.status === "available") {
    if (wallet && wallet.connectionId === data.connection.connectionId) {
      canvas = document.createElement("canvas"); canvas.className = "workflow-qr";
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Wallet connection QR code");
      facts.append(element("p", "ui-note", "Scan with your Sui wallet."), canvas);
    } else facts.append(element("p", "ui-note", "The QR code is unavailable. Reopen this same card to check the connection."));
  }
  if (data.allowedActions.includes("stop_connection")) facts.append(action("Stop waiting", { action: "stop_connection" }));
  if (data.allowedActions.includes("cancel")) facts.append(action("Close", { action: "cancel" }));
  return { node, mount: () => {
    if (canvas && wallet) void QRCode.toCanvas(canvas, wallet.pairingUri).catch(() => {
      if (!disposed) facts.append(element("p", "ui-error", "The QR code could not be displayed. Reopen this same card."));
    });
  }, dispose: () => { disposed = true; } };
}

export const connectRenderer = {
  title: "Wallet connection",
  controls: (snapshot, act, _display, wallet) => connectionView(snapshot, act, wallet),
  result: (snapshot, _receipt, act, wallet) => connectionView(snapshot, act, wallet)
} satisfies CardRenderer;
