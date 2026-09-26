import { GrpcTypes } from "@mysten/sui/grpc";
import { describe, expect, it } from "vitest";
import { AggregatorQuoter, Protocol } from "@flowx-finance/sdk";
import { mainnetCoins, mainnetPools } from "@mysten/deepbook-v3";
import { SUI_TYPE_ARG, normalizeSuiAddress, normalizeStructTag } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { createDeepbookBuildClient, BUILD_CHAIN } from "./fixtures/deepbookBuildClient.js";
import { deepbookDisplayQuote } from "./fixtures/deepbookQuote.js";
import { createDeepbookSwapTransactionMaterialProducer, createDeepbookSwapTransactionMaterialDigestProducer } from "../src/adapters/deepbook/deepbookTransactionMaterialProducer.js";
import { createDeepbookSwapActionPlan } from "../src/adapters/deepbook/deepbookSwapIntent.js";
import { deriveDeepbookSwapQuotePolicy } from "../src/adapters/deepbook/deepbookQuotePolicy.js";
import { resolveDeepbookPoolForSymbols } from "../src/core/read/deepbookRegistry.js";
import { createFlowxSwapTransactionMaterialProducer, createFlowxSwapTransactionMaterialDigestProducer } from "../src/adapters/flowx/flowxSwapTransactionMaterialProducer.js";
import { createFlowxSwapActionPlan } from "../src/adapters/flowx/flowxSwapIntent.js";
import { deriveFlowxSwapQuotePolicy } from "../src/adapters/flowx/flowxSwapQuotePolicy.js";
import { resolveFlowxSwapPair, FLOWX_CLMM_MAINNET } from "../src/core/read/flowxRegistry.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import { createTransactionObjectOwnershipProducer } from "../src/core/action/transactionObjectOwnershipProducer.js";
import { createReviewTimeSimulationProducer } from "../src/core/action/reviewTimeSimulationEvidence.js";
import { createSuccessfulReviewTimeSimulationClient } from "./fixtures/reviewTimeSimulation.js";

const account = `0x${"a".repeat(64)}`;
const now = new Date("2026-05-15T00:00:29.000Z");
const sharedIds = [normalizeSuiAddress("0x6"), ...Object.values(mainnetPools).map((p) => p.address),
  ...Object.entries(FLOWX_CLMM_MAINNET.universalRouter).filter(([key]) => key.endsWith("ObjectId")).map(([, id]) => id),
  FLOWX_CLMM_MAINNET.poolRegistry.objectId, FLOWX_CLMM_MAINNET.versioned.objectId];

describe("supported adapter builders use real SDK intents and gRPC resolution", () => {
  it.each([["deepbook", false], ["flowx", false], ["deepbook", true], ["flowx", true]] as const)("%s actual build with source rejection=%s", async (protocol, rejected) => {
    const client = createDeepbookBuildClient({ expectedChainIdentifier: BUILD_CHAIN,
      ...(rejected ? { buildFailure: GrpcTypes.ExecutionError.create({ kind: GrpcTypes.ExecutionError_ExecutionErrorKind.MOVE_ABORT, description: "private protocol detail" }) } : {}),
      addressBalances: { [SUI_TYPE_ARG]: "2000000000", [normalizeStructTag(mainnetCoins.DEEP!.type)]: "1000000000000" }, coinBalances: { [SUI_TYPE_ARG]: "0", [normalizeStructTag(mainnetCoins.DEEP!.type)]: "0" }, gasPayments: [], sharedObjectIds: sharedIds });
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const options = { client, materialStore, network: "mainnet" as const, chainIdentifier: BUILD_CHAIN, expectedChainIdentifier: BUILD_CHAIN };
    const requestedIntent = { type: "swap" as const, from: { symbol: "SUI", amountDisplay: "1" }, to: { symbol: "USDC" }, maxSlippageBps: 50 };
    let built;
    if (protocol === "deepbook") {
      const plan = createDeepbookSwapActionPlan({ type: "swap", from: { symbol: "SUI", amount: "1" }, to: { symbol: "USDC" }, maxSlippageBps: 50 }, now);
      const quote = deepbookDisplayQuote();
      const quotePolicy = deriveDeepbookSwapQuotePolicy({ rawQuote: quote.rawQuote, fetchedAt: quote.fetchedAt, maxSlippageBps: 50, now });
      if (quotePolicy.status !== "ok") throw new Error("Invalid quote fixture");
      built = await createDeepbookSwapTransactionMaterialProducer(options)({ reviewSessionId: "balance-review", plan: plan as never, account, requestedIntent,
        poolResolution: resolveDeepbookPoolForSymbols({ sourceSymbol: "SUI", targetSymbol: "USDC" }), quote, quotePolicy, now });
    } else {
      const pair = resolveFlowxSwapPair({ sourceSymbol: "SUI", targetSymbol: "USDC" });
      const pool = pair.pools[0]!;
      // Synthetic quote source with a Q64 sqrt-price of 1 and a bounded range.
      // The public SDK parser creates the actual Route/Swap instances.
      const q64 = 1n << 64n;
      const sdkRoutes = new AggregatorQuoter("mainnet").fromRawQuote({
        tokenIn: pair.source.coinType, tokenOut: pair.target.coinType, amountIn: "1000000000", amountOut: "1000000",
        amountInUsd: "0", amountOutUsd: "0", priceImpact: "0", feeToken: pair.source.coinType, feeAmount: "0",
        paths: [[{ poolId: pool.poolId, source: Protocol.FLOWX_V3, sourceType: "CLMM", tokenIn: pair.source.coinType,
          tokenOut: pair.target.coinType, amountIn: "1000000000", amountOut: "1000000", extra: {
            swapXToY: pair.swapXToY, fee: pool.feeRate, nextStateSqrtRatioX64: q64.toString(), nextStateLiquidity: "1000000",
            nextStateTickCurrent: "0", minSqrtPriceHasLiquidity: (q64 - 1n).toString(), maxSqrtPriceHasLiquidity: (q64 + 1n).toString()
          } }]],
        protocolConfig: { [Protocol.FLOWX_V3.toLowerCase()]: {
          wrappedRouterPackageId: FLOWX_CLMM_MAINNET.universalRouter.wrappedRouterPackageId,
          poolRegistryObjectId: FLOWX_CLMM_MAINNET.poolRegistry.objectId, versionedObjectId: FLOWX_CLMM_MAINNET.versioned.objectId
        } }
      }).routes;
      const quotePolicy = deriveFlowxSwapQuotePolicy({ amountInRaw: "1000000000", amountOutRaw: "1000000", swapXToY: pair.swapXToY,
        fetchedAt: now.toISOString(), maxSlippageBps: 50, now });
      if (quotePolicy.status !== "ok") throw new Error("Invalid FlowX quote fixture");
      const plan = createFlowxSwapActionPlan({ type: "swap", from: { symbol: "SUI", amount: "1" }, to: { symbol: "USDC" }, maxSlippageBps: 50 }, now);
      built = await createFlowxSwapTransactionMaterialProducer(options)({ reviewSessionId: "balance-review", plan: plan as never, account, requestedIntent,
        pairEvidence: { ...pair, pinnedPoolCount: pair.pools.length }, quoteEvidence: { amountInRaw: "1000000000", amountOutRaw: "1000000",
          swapXToY: pair.swapXToY, pools: [], sdkRoutes, fetchedAt: now.toISOString() }, quotePolicy, now });
    }
    if (rejected) {
      expect(built).toMatchObject({ status: "blocked", checks: [expect.objectContaining({ message: expect.stringContaining("rejected during build-time simulation") })] });
      expect(JSON.stringify(built)).not.toContain("private protocol detail");
      expect(JSON.stringify(built)).not.toContain("objects could not be resolved");
      return;
    }
    if (built.status !== "completed") throw new Error(JSON.stringify(built));
    const stored = materialStore.getTransactionMaterial(built.evidence, now)!;
    const data = Transaction.from(stored.transactionBytes).getData();
    expect(data.gasData.payment).toEqual([]);
    expect(data.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ $kind: "FundsWithdrawal" })]));
    const digest = await (protocol === "deepbook" ? createDeepbookSwapTransactionMaterialDigestProducer : createFlowxSwapTransactionMaterialDigestProducer)({ materialStore })({ materialHandle: built.evidence, now });
    if (digest.status !== "completed") throw new Error("Missing digest");
    const owned = await createTransactionObjectOwnershipProducer({ ...options, fundingSource: client.core,
      objectSource: { getObject: async ({ objectId }) => {
        if (!sharedIds.includes(objectId)) throw new Error("Unexpected object from adapter build");
        return { object: { objectId, type: "0x2::clock::Clock", owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } } } };
      } } })({ materialHandle: built.evidence, materialDigest: digest.evidence, now });
    expect(owned.status).toBe("completed");
    const simulation = await createReviewTimeSimulationProducer({ ...options, client: createSuccessfulReviewTimeSimulationClient(account) })({
      transactionMaterial: built.evidence, transactionMaterialDigest: digest.evidence, now });
    expect(simulation.status).toBe("completed");
    expect(client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce();
  });
});
