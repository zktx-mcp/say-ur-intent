import { getWalletUniqueIdentifier, type UiWallet } from "@mysten/dapp-kit-core";
import { createLocalDAppKit, hasStoredWalletSelection } from "./dappKitClient.js";
import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import { readPageToken, tokenHeaders } from "./token.js";
import "./connect.css";
import { renderShell } from "./ui/shell.js";
import { agentOriginBadge, button, card, copyButton, element, endRow, feedback, note, walletChip } from "./ui/ui.js";
import {
  resultForConnectedAccount,
  resultForNoCompatibleWallet,
  resultForWalletError,
  type WalletAccountLike,
  type WalletIdentityResultPayload
} from "./walletStatus.js";
import {
  isTerminalWalletIdentityStatus,
  isWalletIdentityStatus,
  type WalletIdentityStatus
} from "../../src/core/session/walletIdentityStatusContract.js";

const root = document.querySelector<HTMLElement>("#connect-app");

if (!root) {
  throw new Error("connect app root missing");
}
const rootElement = root;

const walletSessionId = rootElement.dataset.walletSessionId ?? "";
const token = readPageToken();

const dAppKit = createLocalDAppKit();

// Token page: the shared shell in token mode (no navigation, brand not a link).
const shell = renderShell(rootElement);
const main = shell.main;

// The server wallet-identity session is the single source of truth for this page.
// Every server call (/opened, /connecting, /result) returns the authoritative
// session - its status and, once connected, the recorded account - so the page
// adopts that returned session and renders from it. The browser dapp-kit
// connection is used only to drive the picker and the wallet popup, never as the
// authoritative state.
type ServerSession = { status: WalletIdentityStatus; account: string | undefined };

// session === undefined means "not fetched yet" (checking the token). pageError
// means a server call failed on this loopback server, which is terminal (wrong or
// expired token, dead session, server error); both stop all wallet controls.
let session: ServerSession | undefined;
let pageError = false;
let isBusy = false;
let lastError: string | undefined;

// Avoid flashing the wallet picker before dapp-kit's autoConnect resolves.
let autoConnectSettling = hasStoredWalletSelection();
if (autoConnectSettling) {
  window.setTimeout(() => {
    autoConnectSettling = false;
    render();
  }, 2000);
}

// Validate the token first; the returned session decides every later state.
if (token) {
  void openSession();
}

dAppKit.stores.$wallets.subscribe(() => render());
dAppKit.stores.$connection.subscribe(() => render());
render();

async function openSession(): Promise<void> {
  try {
    session = await postSession(`/api/wallet/${encodeURIComponent(walletSessionId)}/opened`, {});
  } catch (error) {
    failSession(error, "The local review server did not accept this wallet session.");
  }
  render();
}

// End the page as a terminal recovery state. On a loopback server a failed call
// is terminal (wrong/expired token, dead session, server error), so the page
// stops here rather than retrying.
function failSession(error: unknown, fallback: string): void {
  pageError = true;
  lastError = messageForHttpError(error, fallback);
}

function render(): void {
  const connection = dAppKit.stores.$connection.get();
  const wallets = dAppKit.stores.$wallets.get();

  // Reconcile: while the server session still expects a result and the browser is
  // connected, record the connected account. This single binding path covers both
  // autoConnect (no user pick) and the manual pick. A failed submission sets
  // pageError and a successful one makes the session terminal, so it never
  // re-fires.
  if (!pageError && session && !isTerminalWalletIdentityStatus(session.status) && !isBusy && connection.status === "connected") {
    void recordConnected(connection.account, connection.wallet);
  }

  const panel = card();
  panel.append(agentOriginBadge("Opened from your AI client"));

  panel.append(element("h1", "connect-title", "Connect your Sui wallet"));
  panel.append(
    element(
      "p",
      "connect-lede",
      "Connect a Sui mainnet wallet to bind its address as the active account for account-bound review. This page only binds an address; it prepares no transaction and does nothing else."
    )
  );

  appendBody(panel, connection, wallets);
  main.replaceChildren(panel);
}

function appendBody(
  panel: HTMLElement,
  connection: ReturnType<typeof dAppKit.stores.$connection.get>,
  wallets: readonly UiWallet[]
): void {
  if (!token) {
    panel.append(feedback("error", "Missing connect token. Open the connect URL from your AI client again."));
    return;
  }
  if (pageError) {
    panel.append(
      feedback(
        "error",
        "This connect session is no longer available. Open a fresh connect URL from your AI client.",
        lastError
      )
    );
    return;
  }
  if (!session) {
    panel.append(note("Opening the connect session…"));
    return; // checking the token
  }

  const serverStatus = session.status;
  if (serverStatus === "connected") {
    panel.append(feedback("ok", "Wallet address bound."));
    if (session.account) {
      const boundAddress = session.account;
      panel.append(walletChip({ address: boundAddress }));
      panel.append(copyButton("Copy address", () => boundAddress, "Copied"));
    }
    panel.append(note("Return to your AI client to continue. This page only binds the address."));
    return;
  }
  if (serverStatus === "rejected" || serverStatus === "failed") {
    panel.append(feedback("error", "Return to your AI client and request a new connect URL."));
    return;
  }
  if (serverStatus === "expired") {
    panel.append(feedback("error", "This connect session has expired. Open a fresh connect URL from your AI client."));
    return;
  }

  // Non-terminal server session (pending / opened / connecting).
  if (connection.status === "connected" || isBusy) {
    panel.append(note("Recording the connection with the local server…"));
  } else if (connection.status === "connecting") {
    panel.append(note("Finish or cancel the request in your wallet popup."));
  } else if (autoConnectSettling || connection.status === "reconnecting") {
    panel.append(note("Reconnecting your wallet…"));
  } else if (wallets.length === 0) {
    panel.append(feedback("error", "No compatible Sui wallet was detected in this browser."));
    const report = button("Report no compatible wallet", () => void submitResult(resultForNoCompatibleWallet()), "secondary");
    report.disabled = isBusy;
    panel.append(endRow(report));
  } else {
    panel.append(note("Choose a wallet to continue."));
    const list = element("div", "connect-wallet-list");
    for (const wallet of wallets) {
      const pick = button(wallet.name, () => void connect(wallet), "secondary");
      pick.disabled = isBusy;
      list.append(pick);
    }
    panel.append(list);
  }
}

// Drive the wallet popup for a manual pick. The success result is recorded by the
// connected-state reconciliation in render(); this path only records failures.
async function connect(wallet: UiWallet): Promise<void> {
  if (isBusy || pageError || !session || isTerminalWalletIdentityStatus(session.status)) return;
  isBusy = true;
  lastError = undefined;
  render();
  try {
    session = await postSession(`/api/wallet/${encodeURIComponent(walletSessionId)}/connecting`, {});
  } catch (error) {
    isBusy = false;
    failSession(error, "The local review server did not accept this wallet session.");
    render();
    return;
  }

  let failure: WalletIdentityResultPayload | undefined;
  try {
    await dAppKit.connectWallet({ wallet });
  } catch (error) {
    failure = resultForWalletError(error, {
      walletName: wallet.name,
      walletId: getWalletUniqueIdentifier(wallet)
    });
  }
  isBusy = false;
  if (failure) {
    await submitResult(failure);
  } else {
    // The $connection store flips to "connected"; render() reconciles and records.
    render();
  }
}

// Record the connected account. resultForConnectedAccount also classifies an
// unsupported chain or missing account as a terminal failure, so the server
// always learns a terminal result.
async function recordConnected(account: WalletAccountLike, wallet: UiWallet | null): Promise<void> {
  const payload = resultForConnectedAccount(
    account,
    wallet ? { walletName: wallet.name, walletId: getWalletUniqueIdentifier(wallet) } : {}
  );
  await submitResult(payload);
}

async function submitResult(payload: WalletIdentityResultPayload): Promise<void> {
  if (isBusy || pageError || !session || isTerminalWalletIdentityStatus(session.status)) return;
  isBusy = true;
  lastError = undefined;
  try {
    session = await postSession(`/api/wallet/${encodeURIComponent(walletSessionId)}/result`, payload);
  } catch (error) {
    failSession(error, "The local review server did not accept this wallet identity result.");
  } finally {
    isBusy = false;
    render();
  }
}

// Post to a wallet lifecycle endpoint and adopt the returned authoritative
// session. The token travels in the header only, never the URL.
async function postSession(path: string, body: Record<string, unknown>): Promise<ServerSession> {
  const response = await fetch(path, {
    method: "POST",
    headers: tokenHeaders(token, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  const data = (await response.json()) as { status?: unknown; account?: unknown };
  // Validate the status against the known contract and fail closed on anything
  // else, so an unexpected status can never be treated as a non-terminal state
  // that renders wallet controls.
  if (!isWalletIdentityStatus(data.status)) {
    throw new HttpJsonRequestError(response.status, "wallet_session_response_invalid");
  }
  return {
    status: data.status,
    account: typeof data.account === "string" ? data.account : undefined
  };
}
