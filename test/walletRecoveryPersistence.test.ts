import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { WalletSdkProcess } from "../src/runtime/walletSdkProcess.js";
import type { WalletCommand, WalletEvent } from "../src/runtime/walletSdkIpc.js";
import { workflowViewSchema } from "../src/core/session/workflowView.js";
import { waitForWalletConnection } from "../src/core/session/wait.js";
import { walletWorkflowFixture } from "./fixtures/walletWorkflow.js";

// Only the OS/IPC peer is synthetic. Admission, supervisor, Workflow, SQLite,
// projection and waits are the product path. Real SDK/process integration is separate.
class Peer extends EventEmitter {
  connected = true; pid = 123; exitCode: number | null = null; signalCode: string | null = null;
  killMode: "exit" | "false" | "throw" | "hold" = "exit";
  kills = 0; commands: WalletCommand[] = [];
  constructor(private readonly startup: "ready" | "fail" | "hold") { super(); }
  send(command: WalletCommand, callback: (error: Error | null) => void) {
    this.commands.push(command); callback(null);
    if (command.type !== "init") throw new Error("Unexpected wallet command in the persistence fixture");
    if (this.startup === "hold") return true;
    queueMicrotask(() => this.emit("message", this.startup === "fail"
      ? { protocolVersion: 1, runId: command.runId, type: "failure", reason: "initialization_failed" } satisfies WalletEvent
      : { protocolVersion: 1, runId: command.runId, type: "snapshot", ready: true,
        snapshot: { runId: command.runId, sequence: 1, observedAt: new Date().toISOString(), sessions: [] } } satisfies WalletEvent));
    return true;
  }
  kill() {
    this.kills++;
    if (this.killMode === "throw") throw new Error("Fixture signal failure");
    if (this.killMode === "false") return false;
    if (this.killMode === "exit") queueMicrotask(() => this.finish());
    return true;
  }
  finish() { if (this.signalCode) return; this.connected = false; this.signalCode = "SIGKILL"; this.emit("exit", null, "SIGKILL"); }
}
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const peers: Peer[] = [], startups: ("ready" | "fail" | "hold")[] = [];
  const f = await walletWorkflowFixture({ createRuntime: (directory) => new WalletSdkProcess({ dataDirectory: directory,
    projectId: "0".repeat(32), metadata: { name: "Fixture", description: "Synthetic OS peer", url: "https://example.invalid" },
    spawn: () => { const peer = new Peer(startups.shift() ?? "ready"); peers.push(peer); return peer as unknown as ChildProcess; }
  }) });
  const db = new Database(join(f.directory, "activity.sqlite"));
  cleanup.push(async () => { for (const peer of peers) { peer.killMode = "exit"; peer.finish(); } await f.runtime.close(); db.close(); f.close(); });
  const manage = () => f.run(() => f.cards.create("connect", { intent: "manage" }));
  const restart = async (card: Awaited<ReturnType<typeof manage>>) => {
    try { expect((await f.act(card, { action: "restart_wallet_service" })).error).toBeUndefined(); }
    catch (error) { expect(String(error)).toContain("fixture storage refusal"); }
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.acceptedInput?.action)).toBe("restart_wallet_service");
  };
  return { ...f, peers, startups, db, manage, restart };
}
const reject = (phase: "starting" | "failed") => `CREATE TRIGGER reject_${phase} BEFORE UPDATE OF result_json ON live_read_cards
  WHEN json_extract(NEW.result_json,'$.${phase === "starting" ? "phase" : "outcome"}')='${phase}'
  BEGIN SELECT RAISE(ABORT,'fixture storage refusal'); END`;

it.each([false, true])("ends a failed replacement before startup, including failure-result refusal=%s", async (refuseResult) => {
  const f = await fixture(), card = await f.manage(), oldRun = f.runtime.runId;
  f.db.exec(reject("starting")); if (refuseResult) f.db.exec(reject("failed"));
  await f.restart(card);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
  expect(f.peers[0]!.signalCode).toBe("SIGKILL"); expect(f.peers).toHaveLength(1); expect(f.runtime.runId).toBe(oldRun);
  if (refuseResult) {
    expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.state.data)).toMatchObject({ phase: "stopping" });
    await expect(f.read(card)).rejects.toThrow("fixture storage refusal");
    f.db.exec("DROP TRIGGER reject_failed");
  }
  f.db.exec("DROP TRIGGER reject_starting");
  const result = await f.read(card);
  expect(result.snapshot).toMatchObject({ state: "closed", reason: "failed", data: { runtimeRecovery: { outcome: "failed" }, progress: { status: "idle" } } });
  expect(await f.read(card)).toEqual(result); expect(f.peers).toHaveLength(1);
  expect(f.run(() => f.workflow.pendingConnections())).toEqual([]);
  expect((await f.run(() => waitForWalletConnection(f.cards, card.snapshot.cardId))).waitOutcome).toBe("status_reached");
  const next = await f.manage(); expect(workflowViewSchema.parse(next.snapshot.data).allowedActions).toContain("restart_wallet_service");
  await f.restart(next); await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.peers).toHaveLength(2); expect(f.peers[0]!.kills).toBe(1);
  const historical = (await f.read(card)).snapshot;
  expect(workflowViewSchema.parse(historical.data).runtimeRecovery).toEqual(workflowViewSchema.parse(result.snapshot.data).runtimeRecovery);
  expect(historical.revision).toBe(result.snapshot.revision);
});

it("preserves a failed startup outcome instead of superseding it when new controls are opened first", async () => {
  const f = await fixture(), card = await f.manage();
  const connection = f.run(() => f.records.restoreConnection({ topic: "fixture-record", accounts: [f.account], methods: ["sui_signTransaction"],
    chain: "sui:mainnet", expiresAt: new Date(f.now().getTime() + 60000).toISOString() }, f.now())).connection;
  const current = await f.read(card);
  f.startups.push("fail"); f.db.exec(reject("failed"));
  await f.restart(current);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
  await vi.waitFor(() => expect(f.peers[1]!.signalCode).toBe("SIGKILL"));
  expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.state.data)).toMatchObject({ phase: "starting" });
  // Admission incremented once; failure publication must roll back with its outcome.
  expect(f.run(() => f.records.connection(connection.connectionId)?.connection.revision)).toBe(connection.revision + 1);
  await expect(f.read(card)).rejects.toThrow("fixture storage refusal");
  expect(f.run(() => f.records.connection(connection.connectionId)?.connection.revision)).toBe(connection.revision + 1);
  const failedAt = f.now().toISOString(); f.advance(5000);
  f.db.exec("DROP TRIGGER reject_failed");
  const next = await f.manage(), failed = await f.read(card);
  expect(failed.snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "failed", updatedAt: failedAt, message: "The wallet connection service could not start." }, observe: false });
  await f.restart(next); await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  const after = await f.read(card);
  expect(workflowViewSchema.parse(after.snapshot.data).runtimeRecovery).toEqual(workflowViewSchema.parse(failed.snapshot.data).runtimeRecovery);
  expect(after.snapshot.revision).toBe(failed.snapshot.revision); expect(f.peers).toHaveLength(3);
  expect(f.peers.flatMap((peer) => peer.commands.map((command) => command.type))).toEqual(["init", "init", "init"]);
});

it.each(["false", "throw"] as const)("keeps a living child fenced when kill returns %s, and retries only on a new admission", async (mode) => {
  const f = await fixture(), card = await f.manage(), peer = f.peers[0]!;
  peer.killMode = mode; await f.restart(card);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
  const failed = await f.read(card);
  expect(failed.snapshot).toMatchObject({ state: "closed", data: { runtimeRecovery: { outcome: "failed" } } });
  expect(peer.signalCode).toBeNull(); expect(f.peers).toHaveLength(1);
  await f.read(card); expect(peer.kills).toBe(1);
  peer.killMode = "hold"; const next = await f.manage(); await f.restart(next);
  expect(f.peers).toHaveLength(1); expect(peer.kills).toBe(2);
  peer.finish(); await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.peers).toHaveLength(2);
});

it("repairs a pending failure before direct new admission and requires the changed revision to be confirmed", async () => {
  const f = await fixture(), card = await f.manage(); f.startups.push("hold");
  await f.restart(card); await vi.waitFor(() => expect(f.peers).toHaveLength(2));
  const next = await f.manage(), runId = f.runtime.runId;
  f.db.exec(reject("failed"));
  f.peers[1]!.emit("message", { protocolVersion: 1, runId, type: "failure", reason: "restoration_failed" } satisfies WalletEvent);
  expect(f.runtime.availability().status).toBe("unavailable");
  f.db.exec("DROP TRIGGER reject_failed");
  const conflict = await f.act(next, { action: "restart_wallet_service" });
  expect(conflict.error?.code).toBe("card_conflict"); expect(f.peers).toHaveLength(2);
  const prior = await f.read(card);
  expect(prior.snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "failed", message: "Wallet connections could not be restored." } });
  await f.restart(await f.read(next)); await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(workflowViewSchema.parse((await f.read(card)).snapshot.data).runtimeRecovery).toEqual(workflowViewSchema.parse(prior.snapshot.data).runtimeRecovery);
});

it("discards failed recovery writes on a committed data replacement without recreating the old card", async () => {
  const f = await fixture(), card = await f.manage();
  f.startups.push("fail"); f.db.exec(reject("failed")); await f.restart(card);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
  f.db.exec("DROP TRIGGER reject_failed");
  await f.run(() => f.localData.resetLocalData());
  expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toBeUndefined();
  const next = await f.manage(); await f.restart(next);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toBeUndefined();
});

it.each(["reset", "import"] as const)("keeps pending failure evidence when %s rolls back", async (operation) => {
  const f = await fixture(), card = await f.manage();
  const backup = await f.run(() => f.localData.exportLocalData());
  f.startups.push("fail"); f.db.exec(reject("failed")); await f.restart(card);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
  f.db.exec("CREATE TRIGGER reject_replace BEFORE DELETE ON live_read_cards BEGIN SELECT RAISE(ABORT,'fixture replacement refusal'); END");
  await expect(f.run(() => operation === "reset" ? f.localData.resetLocalData() : f.localData.importLocalDataReplace(backup))).rejects.toThrow("fixture replacement refusal");
  expect(f.run(() => f.cardRecords.get(card.snapshot.cardId)?.state.state)).toBe("running");
  f.db.exec("DROP TRIGGER reject_replace; DROP TRIGGER reject_failed");
  expect((await f.read(card)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "failed" } });
  expect(f.peers).toHaveLength(2);
});

it("does not let a cancelled replacement continue into a new data generation", async () => {
  const f = await fixture(), card = await f.manage(), old = f.peers[0]!;
  old.killMode = "hold"; await f.restart(card);
  expect(f.runtime.availability().status).toBe("recovering");
  await f.run(() => f.localData.resetLocalData());
  const next = await f.manage(); await f.restart(next);
  expect(f.peers).toHaveLength(1);
  old.finish(); await vi.waitFor(() => expect(f.runtime.availability().status).toBe("available"));
  expect(f.peers).toHaveLength(2); expect(old.kills).toBe(1);
  expect(f.run(() => f.cardRecords.get(card.snapshot.cardId))).toBeUndefined();
  expect((await f.read(next)).snapshot.data).toMatchObject({ runtimeRecovery: { outcome: "available" } });
});

it("lets the next owner end a pending failure record without replaying the previous owner's memory", async () => {
  const f = await fixture(), card = await f.manage();
  f.startups.push("fail"); f.db.exec(reject("failed")); await f.restart(card);
  await vi.waitFor(() => expect(f.runtime.availability().status).toBe("unavailable"));
  f.workflow.stop(); await f.runtime.close(); f.db.exec("DROP TRIGGER reject_failed");
  f.run(() => f.cardRecords.recover("next-owner", f.now()));
  const saved = f.run(() => f.cardRecords.get(card.snapshot.cardId))!;
  const nextRecords = f.run(() => f.activity.createWalletWorkflowStore("next-owner"));
  expect(saved.state).toMatchObject({ state: "closed", reason: "server_restarted" });
  expect(f.run(() => nextRecords.walletRecovery(saved))).toMatchObject({ outcome: "server_restarted" });
  expect(f.peers).toHaveLength(2);
});
