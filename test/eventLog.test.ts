import { describe, expect, it } from "vitest";
import { redactEvent } from "../src/core/eventlog/sink.js";

describe("event log redaction", () => {
  it("keeps only the allowed event fields", () => {
    const redacted = redactEvent({
      type: "state.computed",
      sessionId: "session_1",
      planId: "plan_1",
      walletAddressHash: "sha256:8d8b3cc160bb728e13db1c032741ad9566b3affd16fc0c805d3caf863694643e",
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      txDigest: "digest",
      status: "ready_for_wallet_review",
      at: new Date(0).toISOString(),
      token: "secret"
    } as Parameters<typeof redactEvent>[0] & { token: string; walletAddress: string });

    expect(redacted).toEqual({
      type: "state.computed",
      sessionId: "session_1",
      planId: "plan_1",
      walletAddressHash: "sha256:8d8b3cc160bb728e13db1c032741ad9566b3affd16fc0c805d3caf863694643e",
      txDigest: "digest",
      status: "ready_for_wallet_review",
      at: new Date(0).toISOString()
    });
    expect("token" in redacted).toBe(false);
    expect("walletAddress" in redacted).toBe(false);
  });

  it("drops unexpected raw wallet addresses instead of logging plaintext", () => {
    const redacted = redactEvent({
      type: "wallet.connected",
      sessionId: "session_1",
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      at: new Date(0).toISOString()
    } as Parameters<typeof redactEvent>[0] & { walletAddress: string });

    expect(redacted).toEqual({
      type: "wallet.connected",
      sessionId: "session_1",
      at: new Date(0).toISOString()
    });
    expect("walletAddress" in redacted).toBe(false);
    expect("walletAddressHash" in redacted).toBe(false);
  });
});
