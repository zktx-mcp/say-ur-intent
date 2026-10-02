import QRCode from "qrcode";
import { t } from "../../../review-app/src/i18n/i18n.js";
import { connectionRecoveryRoute, workflowViewSchema, type WorkflowView } from "../../core/session/workflowView.js";
import type { CardSnapshot, CardWalletDisplay } from "../contracts.js";
import { section, accordion, element, row, monoShort, button, field, select, timeValue } from "../../../review-app/src/ui/ui.js";
import { walletCommandGuidance, type CardDisplayRecovery, type CardRenderer, type CardViewContext } from "./lifecycle.js";
import "./workflow.css";

const connectionLabels: Record<NonNullable<WorkflowView["connection"]>["status"], string> = {
  awaiting_approval: "Approve the connection in your wallet", connected: "Wallet connected",
  rejected: "Connection declined", failed: "Wallet connection unavailable", expired: "Connection expired",
  stopped: "Connection request stopped", disconnected: "Wallet disconnected"
};

function connectionView(snapshot: CardSnapshot, act?: (input: Record<string, unknown>) => void, wallet?: CardWalletDisplay, context?: CardViewContext) {
  const data = workflowViewSchema.parse(snapshot.data);
  const node = element("div", "workflow-card"), facts = section();
  let disposed = false;
  const connected = data.connections.filter((connection) => connection.status === "connected");
  const available = connected.filter((connection) => connection.pendingAction === undefined);
  const pending = data.connections.some((connection) => connection.status === "awaiting_approval" || connection.pendingAction === "disconnect");
  const waitingElsewhere = !data.connection && data.connections.some((connection) => connection.status === "awaiting_approval");
  const action = (label: string, input: Record<string, unknown>) => {
    const bound = ["connect", "disconnect", "use_account", "restart_wallet_service"].includes(String(input.action))
      ? { ...input, walletRunId: data.walletAvailability.walletRunId } : input;
    const control = button(label, () => { if (!disposed) act?.(bound); }, ["disconnect", "restart_wallet_service"].includes(String(input.action)) ? "danger" : input.action === "connect" ? "primary" : "secondary");
    control.dataset.cardAction = String(input.action); control.disabled = !act; return control;
  };
  facts.append(row("Network", t.common.mainnet));
  if (data.runtimeRecovery) {
    const recovery = data.runtimeRecovery;
    const message = "phase" in recovery
      ? recovery.phase === "stopping" ? "Stopping the wallet connection service…" : data.walletAvailability.status !== "available" ? data.walletAvailability.message : "Confirming wallet service recovery…"
      : recovery.outcome === "available" ? "Wallet service restarted."
      : recovery.outcome === "superseded" ? "A newer wallet service restart replaced this request."
      : recovery.message ?? "This wallet service restart could not be confirmed.";
    const status = row("Wallet service", message); status.setAttribute("role", "status"); facts.append(status);
    facts.append(element("p", "ui-note", "Restarting the service does not approve a connection, revoke a connection in your wallet, or cancel a submitted transaction."));
    node.append(facts);
    return { node, dispose: () => { disposed = true; } };
  }
  const status = row(data.walletAvailability.status !== "available" ? "Last recorded status" : "Status",
    data.connectionAction === "disconnect" && data.connection?.status === "failed" ? "Disconnection could not be confirmed" :
    pending && connected.some((item) => item.pendingAction === "disconnect") ? "Disconnecting wallet…" : data.connection ? connectionLabels[data.connection.status] : connected.length ? "Wallet connected" : waitingElsewhere ? "Connection approval is pending in another card" : data.walletAvailability.status !== "available" ? "Connection not confirmed" : "No wallet connected");
  status.setAttribute("role", "status"); facts.append(status);
  if (data.walletAvailability.status !== "available") {
    facts.append(element("p", "ui-note", data.walletAvailability.message));
    if (data.connection && !connected.some((connection) => connection.connectionId === data.connection!.connectionId)) {
      facts.append(row("Last updated", timeValue(data.connection.updatedAt)));
    }
  }
  if (data.connection?.reason) facts.append(element("p", "ui-note", data.connection.reason));
  if (data.activeAccount && connected.some((connection) => connection.accounts.some((account) => account !== data.activeAccount))) {
    facts.append(row("Selected account", monoShort(data.activeAccount)));
  }
  node.append(facts);
  const details = accordion("Details");
  if (data.walletObservation) details.body.append(row("Last service check", timeValue(data.walletObservation.observedAt)));

  const choices = available.flatMap((connection) => connection.accounts.map((account) => ({ connection, account })));
  if (act && data.allowedActions.includes("use_account") && choices.some((choice) => choice.account !== data.activeAccount)) {
    const form = document.createElement("form"), choiceInput = select({ choices: [{ value: "", label: "Select an account" }, ...choices.map((choice) => ({ value: `${choice.connection.connectionId}:${choice.account}`, label: `${choice.connection.walletName ?? "Wallet"} · ${choice.account}` }))] });
    form.className = "ui-form";
    choiceInput.required = true; choiceInput.setAttribute("aria-label", "Account to use");
    const use = button("Use account", () => undefined); use.type = "submit"; use.dataset.cardAction = "use_account";
    form.append(field("Account", choiceInput), use); form.addEventListener("submit", (event) => {
      event.preventDefault(); const choice = choices.find((item) => `${item.connection.connectionId}:${item.account}` === choiceInput.value);
      if (!disposed && choice) act?.({ action: "use_account", walletRunId: data.walletAvailability.walletRunId, connectionId: choice.connection.connectionId, account: choice.account });
    }); details.body.append(form);
  }
  for (const connection of connected) {
    const item = element("div");
    if (data.walletAvailability.status === "unavailable") item.append(row("Last updated", timeValue(connection.updatedAt)));
    details.body.append(row("Connection expires", timeValue(connection.expiresAt)));
    for (const account of connection.accounts) item.append(row(connection.walletName ?? "Wallet", monoShort(account)));
    if (act && !connection.pendingAction && data.allowedActions.includes("disconnect")) {
      const controls = element("div", "card-actions");
      const open = button("Disconnect", () => undefined, "secondary"); open.dataset.cardAction = "disconnect"; open.disabled = !act;
      open.addEventListener("click", () => {
        if (disposed) return;
        const original = [...node.children];
        const confirmation = section("Disconnect wallet?");
        confirmation.append(row("Wallet", connection.walletName ?? "Wallet"), row("Network", t.common.mainnet));
        for (const account of connection.accounts) confirmation.append(row("Account", monoShort(account)));
        const back = button("Back", () => undefined, "secondary");
        back.addEventListener("click", () => { if (!disposed) node.replaceChildren(...original); });
        const actions = element("div", "card-actions");
        actions.append(action("Confirm disconnect", { action: "disconnect", connectionId: connection.connectionId }), back);
        confirmation.append(actions);
        node.replaceChildren(confirmation);
      });
      controls.append(open); item.append(controls);
      if (snapshot.input.intent === "disconnect" && available.length === 1) queueMicrotask(() => { if (!disposed) open.click(); });
    }
    facts.append(item);
  }
  let canvas: HTMLCanvasElement | undefined, scanInstruction: HTMLElement | undefined;
  if (data.connection?.status === "awaiting_approval" && data.walletAvailability.status === "available") {
    if (wallet && wallet.connectionId === data.connection.connectionId) {
      canvas = document.createElement("canvas"); canvas.className = "workflow-qr";
      canvas.hidden = true;
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Wallet connection QR code");
      scanInstruction = element("p", "ui-note workflow-qr-instruction", "Scan to connect your Sui wallet.");
      scanInstruction.hidden = true;
      facts.append(scanInstruction, canvas);
    } else facts.append(element("p", "ui-note", "The QR code is not available in this view."));
  }
  if (act && data.allowedActions.includes("stop_connection")) facts.append(action("Stop connecting", { action: "stop_connection" }));
  const help = accordion("Wallet service help");
  const impact = data.recoveryImpact;
  if (data.allowedActions.includes("restart_wallet_service") && !impact) throw new Error("Wallet restart details are unavailable.");
  if (act && impact && data.allowedActions.includes("restart_wallet_service") && data.walletAvailability.walletRunId) {
    help.body.append(element("p", "ui-note", "If the wallet service stops responding, you can restart it here. Other cards and submitted transaction results remain available."));
    const open = button("Restart wallet service", () => {
      if (disposed) return;
      const original = [...node.children], confirmation = section("Restart wallet service?");
      confirmation.append(element("p", "ui-note", "This interrupts connection attempts and approval requests that have not been submitted. Update the review and request approval again afterward. It does not cancel a submitted transaction or remove connections from your wallet app."));
      confirmation.append(row("Approval requests interrupted", String(impact.attemptIds.length)));
      for (const connection of data.connections.filter((item) => ["connected", "awaiting_approval"].includes(item.status))) {
        confirmation.append(row("Affected wallet", connection.walletName ?? "Wallet connection"));
        for (const account of connection.accounts) confirmation.append(row("Account", monoShort(account)));
      }
      const back = button("Back", () => { if (!disposed) node.replaceChildren(...original); }, "secondary");
      const actions = element("div", "card-actions");
      actions.append(action("Confirm restart", { action: "restart_wallet_service" }), back);
      confirmation.append(actions);
      node.replaceChildren(confirmation);
    });
    open.dataset.cardAction = "restart_wallet_service"; help.body.append(open);
  } else help.body.append(element("p", "ui-note", "If the wallet service stops responding, ask in chat to open wallet connection controls, then choose Restart wallet service."));
  facts.append(help.details);
  if (details.body.children.length) facts.append(details.details);
  let drawing = false, displayFailure: CardDisplayRecovery | undefined;
  const draw = () => {
    if (disposed || drawing || !canvas || !wallet) return;
    drawing = true; displayFailure = undefined;
    canvas.hidden = true;
    if (scanInstruction) scanInstruction.hidden = true;
    // Report the asynchronous result to the frame. A state read does not by
    // itself mean this canvas was painted successfully.
    void QRCode.toCanvas(canvas, wallet.pairingUri).then(() => {
      if (disposed) return;
      drawing = false; canvas!.hidden = false;
      if (scanInstruction) scanInstruction.hidden = false;
      context?.onDisplayChange?.();
    }, () => {
      if (disposed) return;
      drawing = false;
      displayFailure = { message: "The QR code could not be displayed.", retry: draw };
      context?.onDisplayChange?.();
    });
  };
  return { node, mount: draw, displayRecovery: () => displayFailure, dispose: () => { disposed = true; } };
}

export const connectRenderer = {
  title: "Wallet connection",
  guidance(snapshot, context) {
    const command = walletCommandGuidance(context);
    if (command) return command;
    const parsed = workflowViewSchema.safeParse(snapshot?.data);
    if (!context.confirmed || !parsed.success) return context.recoveryNeeded ? "Ask in chat to check your wallet connection." : undefined;
    const data = parsed.data;
    if (data.connectionAction === "disconnect" && data.connection?.status === "failed") {
      return "Check the connection in your wallet app and remove it there if it is still listed. Disconnection was not confirmed here.";
    }
    const recoveryRoute = connectionRecoveryRoute(data);
    if (recoveryRoute) {
      const here = !context.readOnly && data.allowedActions.includes("restart_wallet_service");
      return (recoveryRoute === "conditional" ? "If this request is not responding, " : "") +
        (here ? (recoveryRoute === "conditional" ? "open" : "Open") + " Wallet service help and choose Restart wallet service."
          : (recoveryRoute === "conditional" ? "ask" : "Ask") + " in chat to open wallet connection controls. You can restart the wallet service there after confirming the effects.");
    }
    if (data.runtimeRecovery) return "phase" in data.runtimeRecovery
      ? data.runtimeRecovery.phase === "stopping" ? undefined
        : "To restart a wallet service that remains unresponsive, ask in chat to open new wallet connection controls."
      : data.runtimeRecovery.outcome === "available" ? undefined : "Ask in chat to open wallet connection controls if you need to restart the service again.";
    if (data.walletAvailability.status === "unavailable") return !context.readOnly && data.allowedActions.includes("restart_wallet_service")
      ? "Open Wallet service help and choose Restart wallet service." : t.common.walletStatusRecovery;
    if (!data.connection && data.connections.some((connection) => connection.status === "awaiting_approval")) {
      return "Continue in the wallet connection card you opened first.";
    }
    if (data.connection?.status === "awaiting_approval") {
      return context.readOnly ? "You can ask in chat to check this connection request." : undefined;
    }
    if (data.connections.some((connection) => connection.status === "connected" || connection.pendingAction)) {
      return context.recoveryNeeded && context.readOnly ? "Ask in chat to check your wallet connection." : undefined;
    }
    if (data.automaticAction && !context.automaticPaused) return undefined;
    return "Ask in chat to connect your wallet.";
  },
  controls: (snapshot, act, _display, wallet = undefined, context = undefined) => connectionView(snapshot, act, wallet, context),
  result: (snapshot, _receipt, act, wallet = undefined, context = undefined) => connectionView(snapshot, act, wallet, context)
} satisfies CardRenderer;
