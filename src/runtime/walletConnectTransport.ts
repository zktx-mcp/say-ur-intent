import { SignClient } from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";
import { z } from "zod";
import { parseSuiAddress } from "../core/suiAddress.js";
import { SUI_MAINNET_WALLET_CHAIN, SUI_SIGN_TRANSACTION_METHOD,
  WalletUserRejectedError, type WalletSession, type WalletTransport } from "../core/session/walletConnection.js";
import { openWalletConnectStorage } from "./walletConnectStorage.js";

const signedResponse = z.object({ transactionBytes: z.string().min(1), signature: z.string().min(1) }).strict();
function transportError(error: unknown): Error {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return ["USER_REJECTED", "USER_REJECTED_CHAINS", "USER_REJECTED_METHODS", "USER_REJECTED_EVENTS"]
    .some((name) => getSdkError(name as Parameters<typeof getSdkError>[0]).code === code)
    ? new WalletUserRejectedError() : new Error("The wallet request could not be completed.");
}

function sessionValue(session: SessionTypes.Struct): WalletSession {
  const namespace = session.namespaces.sui ?? session.namespaces[SUI_MAINNET_WALLET_CHAIN];
  if (!namespace || !Number.isSafeInteger(session.expiry) || session.expiry * 1000 <= Date.now()) {
    throw new Error("A live Sui mainnet wallet session is required.");
  }
  const accounts = namespace.accounts.filter((account) => account.startsWith(`${SUI_MAINNET_WALLET_CHAIN}:`))
    .map((account) => parseSuiAddress(account.slice(SUI_MAINNET_WALLET_CHAIN.length + 1)));
  if (accounts.length === 0 || accounts.some((account) => !account)) throw new Error("The wallet did not approve a Sui mainnet account.");
  return { topic: session.topic, accounts: [...new Set(accounts as string[])], methods: [...namespace.methods],
    chain: SUI_MAINNET_WALLET_CHAIN, expiresAt: new Date(session.expiry * 1000).toISOString(), walletName: session.peer.metadata.name };
}

export async function createWalletConnectTransport(options: {
  projectId: string; dataDirectory: string; metadata: { name: string; description: string; url: string };
  onSdkStart?: () => void;
}): Promise<WalletTransport> {
  if (!/^[0-9a-f]{32}$/i.test(options.projectId)) throw new Error("WalletConnect project ID format is invalid.");
  const owner = openWalletConnectStorage(options.dataDirectory);
  // SDK log bodies can contain pairing credentials and serialized requests.
  // Product failure stages are recorded by the caller without these values.
  options.onSdkStart?.();
  const client = await SignClient.init({ projectId: options.projectId, metadata: { ...options.metadata, icons: [] },
    storage: owner.storage, logger: "silent", telemetryEnabled: false });
  let stopped = false;
  const listeners = new Set<(topic: string, selectionChanged?: boolean) => void>();
  const changed = (event: { topic: string }) => { if (!stopped) for (const listener of listeners) listener(event.topic); };
  // Pinned SignClient emits session_event without changing session.namespaces.
  // Treat active account/chain changes as invalidation, not new authorization.
  const selectionChanged = (event: { topic: string; params: { event: { name: string } } }) => {
    if (!stopped && ["accountsChanged", "chainChanged"].includes(event.params.event.name)) {
      for (const listener of listeners) listener(event.topic, true);
    }
  };
  client.on("session_update", changed); client.on("session_delete", changed);
  client.on("session_expire", changed); client.on("session_event", selectionChanged);
  const current = (topic: string) => {
    if (stopped) return undefined;
    try { return sessionValue(client.session.get(topic)); } catch { return undefined; }
  };
  const requireActive = () => { if (stopped) throw new Error("WalletConnect owner stopped."); };
  return {
    async restore() {
      requireActive();
      // A pending proposal is not an approved session and must not reappear as
      // a new approval ceremony after owner replacement.
      for (const pairing of client.core.pairing.getPairings()) {
        if (!pairing.active) await client.core.pairing.disconnect({ topic: pairing.topic });
      }
      return client.session.getAll().flatMap((session) => { const value = current(session.topic); return value ? [value] : []; });
    },
    async connect() {
      requireActive();
      const connecting = await client.connect({ requiredNamespaces: { sui: {
        chains: [SUI_MAINNET_WALLET_CHAIN], methods: [SUI_SIGN_TRANSACTION_METHOD], events: ["accountsChanged", "chainChanged"]
      } } });
      const approval = connecting.approval().then(sessionValue).catch((error: unknown) => { throw transportError(error); });
      // Attach a rejection handler immediately; the backend records the same
      // promise's outcome once the private QR has been associated with its row.
      void approval.catch(() => undefined);
      if (!connecting.uri) throw new Error("The wallet pairing could not be prepared.");
      const topic = /^wc:([^@]+)@2\?/.exec(connecting.uri)?.[1];
      const pairing = topic ? client.core.pairing.getPairings().find((item) => item.topic === topic) : undefined;
      if (!pairing || !Number.isSafeInteger(pairing.expiry)) throw new Error("Wallet pairing expiry is unavailable.");
      return { uri: connecting.uri, expiresAt: new Date(pairing.expiry * 1000).toISOString(), approval };
    },
    async disconnect(topic) { requireActive(); await client.disconnect({ topic, reason: getSdkError("USER_DISCONNECTED") }); },
    async sign(input) {
      requireActive();
      const session = current(input.topic);
      if (!session?.accounts.includes(input.account) || !session.methods.includes(SUI_SIGN_TRANSACTION_METHOD)) {
        throw new Error("This wallet session cannot sign for the selected Sui account.");
      }
      return signedResponse.parse(await client.request({ topic: input.topic, chainId: SUI_MAINNET_WALLET_CHAIN,
        request: { method: SUI_SIGN_TRANSACTION_METHOD, params: { transaction: input.transactionBytesBase64, address: input.account } } }));
    },
    session: current,
    onSessionChanged(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() {
      stopped = true; listeners.clear();
      client.off("session_update", changed); client.off("session_delete", changed);
      client.off("session_expire", changed); client.off("session_event", selectionChanged);
      // SignClient has no supported complete in-process disposal. The runtime
      // ends the owner process; it must not close injected storage under timers.
    }
  };
}
