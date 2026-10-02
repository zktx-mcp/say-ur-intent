import { decrypt, encrypt } from "@walletconnect/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { walletWorkflowFixture } from "./fixtures/walletWorkflow.js";
import { seedWalletSdk, walletRelay, sdkFixtureTopic } from "./fixtures/walletRelay.js";
import { WalletSdkProcess } from "../src/runtime/walletSdkProcess.js";
import type { WalletCommand } from "../src/runtime/walletSdkIpc.js";
import { acquireDataDirectoryOwner } from "../src/runtime/shared/ownerLease.js";
import { workflowViewSchema } from "../src/core/session/workflowView.js";

it("recovers a real SDK disconnect through SQLite failure repair and a new explicit admission without replay", async () => {
  const relay = await walletRelay(), children: ChildProcess[] = [], commands: WalletCommand["type"][] = [];
  const f = await walletWorkflowFixture({ createRuntime: async (directory) => {
    await seedWalletSdk(directory, "session");
    return new WalletSdkProcess({ dataDirectory: directory, projectId: "0".repeat(32),
      metadata: { name: "Integration fixture", description: "Actual SDK on an isolated relay", url: "https://example.invalid" },
      spawn: () => {
        const child = fork(new URL("./fixtures/walletSdkChild.ts", import.meta.url), [], { execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, FIXTURE_WALLET_RELAY: relay.url } });
        const send = child.send.bind(child);
        child.send = ((message: WalletCommand, callback: (error: Error | null) => void) => {
          commands.push(message.type); return send(message, callback);
        }) as ChildProcess["send"];
        children.push(child); return child;
      } });
  } });
  const db = new Database(join(f.directory, "activity.sqlite"));
  try {
    // A previously approved, known product connection is the independent DB
    // prerequisite. The seeded SDK session alone cannot create one.
    const observed = f.runtime.snapshot()!.sessions.find((item) => item.topic === sdkFixtureTopic)!;
    if (observed.status !== "present") throw new Error("Seeded SDK session is not usable");
    const connection = f.run(() => f.records.restoreConnection(observed.session, f.now())).connection;
    const disconnect = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    expect((await f.act(disconnect, { action: "disconnect", connectionId: connection.connectionId })).error).toBeUndefined();
    await vi.waitFor(() => expect(relay.calls.filter((call) => call.method === "irn_unsubscribe")).toHaveLength(1));
    expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(true);
    const recovery = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    db.exec("CREATE TRIGGER refuse_phase BEFORE UPDATE OF result_json ON live_read_cards WHEN json_extract(NEW.result_json,'$.phase')='starting' BEGIN SELECT RAISE(ABORT,'fixture phase failure'); END");
    expect((await f.act(recovery, { action: "restart_wallet_service" })).error).toBeUndefined();
    await vi.waitFor(() => expect(children[0]!.signalCode).toBe("SIGKILL"));
    await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
    await vi.waitFor(() => expect(f.run(() => f.records.connection(connection.connectionId)?.sdkPending)).toBe(false));
    expect(children).toHaveLength(1);
    expect((await f.read(disconnect)).snapshot.data).toMatchObject({ connection: { status: "failed", reason: expect.stringContaining("could not be confirmed") } });
    db.exec("DROP TRIGGER refuse_phase");
    expect((await f.read(recovery)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "failed" } });
    const lease = acquireDataDirectoryOwner(join(f.directory, "walletconnect/sessions.sqlite")); lease.close();
    expect(children).toHaveLength(1);
    const next = await f.run(() => f.cards.create("connect", { intent: "manage" }));
    expect((await f.act(next, { action: "restart_wallet_service" })).error).toBeUndefined();
    await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"), { timeout: 10000 });
    expect(children).toHaveLength(2);
    expect(() => acquireDataDirectoryOwner(join(f.directory, "walletconnect/sessions.sqlite"))).toThrow("runtime owner");
    expect(f.run(() => f.records.connection(connection.connectionId)?.connection.status)).toBe("failed");
    expect((await f.read(next)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "available" } });
    const connecting = await f.createConnection();
    const action = workflowViewSchema.parse(connecting.snapshot.data).automaticAction!;
    expect(action.action).toBe("connect"); expect((await f.act(connecting, action)).error).toBeUndefined();
    await vi.waitFor(async () => expect((await f.read(connecting)).walletDisplay?.pairingUri).toMatch(/^wc:/), { timeout: 10000 });
    expect(relay.calls.filter((call) => call.method === "irn_unsubscribe")).toHaveLength(1);
    // The ordinary workflow fixture's transport is not used by this real SDK.
    // Count the actual parent-to-child dispatch, not that unused transport spy.
    expect(commands.filter((command) => command === "disconnect")).toHaveLength(1);
    expect(commands.filter((command) => command === "connect")).toHaveLength(1);
    expect(commands.filter((command) => command === "sign")).toHaveLength(0);
    expect(f.submit).not.toHaveBeenCalled();
  } finally { await f.runtime.close(); db.close(); f.close(); await relay.close(); }
}, 30000);

// The external wallet and chain are fixtures. SDK, IPC, SQLite admission,
// parent cryptographic validation and single-submission authority are real.
it.each([false, true])("validates real SDK signing across IPC (wrong signer=%s)", async (wrongSigner) => {
  const relay = await walletRelay(), commands: WalletCommand["type"][] = [], output: string[] = [];
  const f = await walletWorkflowFixture({ createRuntime: async (directory, { account }) => {
    await seedWalletSdk(directory, "session", account);
    return new WalletSdkProcess({ dataDirectory: directory, projectId: "0".repeat(32),
      metadata: { name: "Signing fixture", description: "Independent wallet key", url: "https://example.invalid" },
      spawn: () => {
        const child = fork(new URL("./fixtures/walletSdkChild.ts", import.meta.url), [], { execArgv: ["--import", "tsx"],
          stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, FIXTURE_WALLET_RELAY: relay.url } });
        child.stdout!.on("data", (chunk: Buffer) => output.push(chunk.toString()));
        child.stderr!.on("data", (chunk: Buffer) => output.push(chunk.toString()));
        const send = child.send.bind(child);
        child.send = ((message: WalletCommand, callback: (error: Error | null) => void) => {
          commands.push(message.type); return send(message, callback);
        }) as ChildProcess["send"];
        return child;
      } });
  } });
  try {
    const observed = f.runtime.snapshot()!.sessions.find((item) => item.topic === sdkFixtureTopic)!;
    if (observed.status !== "present") throw new Error("Seeded session unavailable");
    const connection = f.run(() => f.records.restoreConnection(observed.session, f.now())).connection;
    await f.run(() => f.activity.setActiveAccount(f.account, "wallet_connection", f.now(), { id: connection.connectionId }));
    const review = await f.prepare(connection.connectionId);
    const requests: { method: string; transaction: string; address: string }[] = [];
    const signatures: string[] = [];
    relay.respondToPublish(async ({ topic, message }) => {
      if (topic !== sdkFixtureTopic) return undefined;
      const request = JSON.parse(decrypt({ symKey: "cd".repeat(32), encoded: message }));
      if (request.method !== "wc_sessionRequest") return undefined;
      const params = request.params.request;
      requests.push({ method: params.method, transaction: params.params.transaction, address: params.params.address });
      const signed = await (wrongSigner ? Ed25519Keypair.generate() : f.accountKey).signTransaction(Buffer.from(params.params.transaction, "base64"));
      signatures.push(signed.signature);
      return encrypt({ symKey: "cd".repeat(32), message: JSON.stringify({ jsonrpc: "2.0", id: request.id,
        result: { transactionBytes: signed.bytes, signature: signed.signature } }) });
    });
    expect((await f.act(review.card, { action: "request_signature", connectionId: connection.connectionId,
      account: f.account, reviewRevision: review.session.reviewRevision })).error).toBeUndefined();
    await vi.waitFor(() => {
      expect(relay.responseErrors).toEqual([]);
      expect(f.run(() => f.records.currentRequest(review.session.id)?.requestStatus)).toBe(wrongSigner ? "request_failed" : "completed");
    }, { timeout: 10000 });
    const admitted = f.run(() => f.records.currentRequest(review.session.id))!;
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ method: "sui_signTransaction", address: f.account });
    expect(await Transaction.from(requests[0]!.transaction).getDigest()).toBe(admitted.transactionDigest);
    expect(commands.filter((item) => item === "sign")).toHaveLength(1);
    expect(f.submit).toHaveBeenCalledTimes(wrongSigner ? 0 : 1);
    if (!wrongSigner) {
      expect(Buffer.from(f.submit.mock.calls[0]![0]).toString("base64")).toBe(requests[0]!.transaction);
      expect(f.submit.mock.calls[0]![1]).toBe(signatures[0]);
      expect(admitted.execution).toMatchObject({ status: "success", txDigest: admitted.transactionDigest });
    }
    const result = await f.run(() => f.workflow.readReview(review.session.id, true));
    expect(result?.request).toEqual(admitted); expect(f.submit).toHaveBeenCalledTimes(wrongSigner ? 0 : 1);
    expect(JSON.stringify((await f.read(review.card)).snapshot)).not.toContain(signatures[0]);
    expect(output.join("") + JSON.stringify(f.logger.error.mock.calls)).not.toContain(signatures[0]);
    expect(output.join("")).not.toContain(requests[0]!.transaction);
  } finally { await f.runtime.close(); f.close(); await relay.close(); }
}, 30000);
