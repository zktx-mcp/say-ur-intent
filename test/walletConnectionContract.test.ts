import { expect, it } from "vitest";
import { walletConnectionSchema } from "../src/core/session/walletConnection.js";
const connection = { connectionId: "fixture", status: "connected", revision: 0, chain: "sui:mainnet",
  accounts: [`0x${"a".repeat(64)}`], methods: ["sui_signTransaction"], createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(), expiresAt: new Date(1000).toISOString() };
it("accepts only the current connection model and valid mainnet account identity", () => {
  expect(walletConnectionSchema.parse(connection)).toEqual(connection);
  for (const delta of [{ chain: "sui:testnet" }, { accounts: ["not-an-address"] }, { status: "opened" }, { signature: "private" }, { topic: "private" }]) {
    expect(walletConnectionSchema.safeParse({ ...connection, ...delta }).success).toBe(false);
  }
});
