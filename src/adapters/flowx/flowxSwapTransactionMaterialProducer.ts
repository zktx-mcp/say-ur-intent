import { SimulationError } from "@mysten/sui/client";
import { Trade } from "@flowx-finance/sdk";
import { bcs } from "@mysten/sui/bcs";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiObjectId } from "@mysten/sui/utils";
import type { BlockedReason, RefreshReason, ReviewCheck } from "../../core/action/types.js";
import { FLOWX_CLMM_MAINNET } from "../../core/read/flowxRegistry.js";
import {
  LocalTransactionMaterialStoreError,
  type LocalTransactionMaterialDigestCommitment,
  type LocalTransactionMaterialHandle,
  type LocalTransactionMaterialStore
} from "../../core/session/transactionMaterialStore.js";
import { suiTransactionDigestSchema } from "../../core/suiAddress.js";
import {
  failReviewCheck,
  passReviewCheck
} from "../../core/review/reviewComputationResult.js";
import type { FlowxSwapQuotePolicyOk } from "./flowxSwapQuotePolicy.js";
import type { FlowxSwapActionPlanIdentity, FlowxSwapRequestedIntent } from "./flowxSwapIntent.js";
import type { FlowxSwapPairEvidence, FlowxSwapRouteQuoteEvidence } from "./flowxSwapReviewEvidence.js";

export type FlowxSwapTransactionMaterialProducerInput = {
  reviewSessionId: string;
  plan: FlowxSwapActionPlanIdentity;
  account: string;
  requestedIntent: FlowxSwapRequestedIntent;
  pairEvidence: FlowxSwapPairEvidence;
  quoteEvidence: FlowxSwapRouteQuoteEvidence;
  quotePolicy: FlowxSwapQuotePolicyOk;
  now: Date;
};

export type FlowxSwapTransactionMaterialProducerOutcome =
  | { status: "completed"; evidence: LocalTransactionMaterialHandle; checks: ReviewCheck[] }
  | { status: "blocked"; blockedReason: BlockedReason; checks: [ReviewCheck, ...ReviewCheck[]] }
  | { status: "refresh_required"; refreshReason: RefreshReason; checks: [ReviewCheck, ...ReviewCheck[]] };

export type FlowxSwapTransactionMaterialProducer = (
  input: FlowxSwapTransactionMaterialProducerInput
) => FlowxSwapTransactionMaterialProducerOutcome | Promise<FlowxSwapTransactionMaterialProducerOutcome>;

export type FlowxSwapTransactionBytesBuilder = (input: {
  account: string;
  quotePolicy: FlowxSwapQuotePolicyOk;
  sdkRoutes: unknown;
}) => Promise<Uint8Array>;

export type FlowxSwapTransactionMaterialDigestProducerInput = {
  materialHandle: LocalTransactionMaterialHandle;
  now: Date;
};

export type FlowxSwapTransactionMaterialDigestProducerOutcome =
  | { status: "completed"; evidence: LocalTransactionMaterialDigestCommitment; checks: ReviewCheck[] }
  | { status: "blocked"; blockedReason: BlockedReason; checks: [ReviewCheck, ...ReviewCheck[]] }
  | { status: "refresh_required"; refreshReason: RefreshReason; checks: [ReviewCheck, ...ReviewCheck[]] };

export type FlowxSwapTransactionMaterialDigestProducer = (
  input: FlowxSwapTransactionMaterialDigestProducerInput
) => FlowxSwapTransactionMaterialDigestProducerOutcome | Promise<FlowxSwapTransactionMaterialDigestProducerOutcome>;

export type FlowxSwapTransactionMaterialProducerOptions = {
  client: SuiGrpcClient;
  network: "mainnet";
  chainIdentifier: string;
  expectedChainIdentifier: string;
  materialStore: LocalTransactionMaterialStore;
  /** Test seam; the default builds through the FlowX SDK Trade entity. */
  buildSwapTransactionBytes?: FlowxSwapTransactionBytesBuilder;
};

const FLOWX_SWAP_GAS_BUDGET_MIST = 50_000_000n;
const SUI_COIN_TYPE = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const SUI_CLOCK_OBJECT_ID = "0x0000000000000000000000000000000000000000000000000000000000000006";
const MOVE_STDLIB_PACKAGE_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
const SUI_FRAMEWORK_PACKAGE_ID = "0x0000000000000000000000000000000000000000000000000000000000000002";

export function createFlowxSwapTransactionMaterialProducer(
  options: FlowxSwapTransactionMaterialProducerOptions
): FlowxSwapTransactionMaterialProducer {
  const buildBytes = options.buildSwapTransactionBytes ?? sdkTradeBytesBuilder(options.client);
  return async (input) => {
    if (options.network !== "mainnet" || options.chainIdentifier !== options.expectedChainIdentifier) {
      return {
        status: "blocked",
        blockedReason: "network_mismatch",
        checks: [
          failReviewCheck(
            "flowx_transaction_material_network_mismatch",
            "Transaction material network",
            "FlowX transaction material build requires a verified Sui mainnet gRPC endpoint and matching mainnet chain identifier.",
            "network"
          )
        ]
      };
    }

    if (input.quoteEvidence.swapXToY !== input.quotePolicy.swapXToY) {
      return {
        status: "blocked",
        blockedReason: "amount_mismatch",
        checks: [
          failReviewCheck(
            "flowx_transaction_material_direction_mismatch",
            "Transaction material quote policy",
            "FlowX transaction material build requires route quote evidence and quote policy to describe the same swap direction.",
            "adapter"
          )
        ]
      };
    }

    const quoteExpiresAt = new Date(Date.parse(input.quotePolicy.fetchedAt) + input.quotePolicy.staleAfterMs);
    if (quoteExpiresAt.getTime() <= input.now.getTime()) {
      return {
        status: "refresh_required",
        refreshReason: "quote_stale",
        checks: [
          failReviewCheck(
            "flowx_transaction_material_quote_expired",
            "Transaction material quote policy",
            "FlowX transaction material was not built because the quote policy expired before build.",
            "quote"
          )
        ]
      };
    }

    try {
      const sourceAmountRaw = BigInt(input.quotePolicy.sourceAmountRaw);
      const source = input.pairEvidence.source;
      const requirements =
        source.coinType === SUI_COIN_TYPE
          ? [{ symbol: source.symbol, coinType: SUI_COIN_TYPE, decimals: source.decimals, requiredRaw: sourceAmountRaw + FLOWX_SWAP_GAS_BUDGET_MIST }]
          : [
              { symbol: source.symbol, coinType: source.coinType, decimals: source.decimals, requiredRaw: sourceAmountRaw },
              { symbol: "SUI", coinType: SUI_COIN_TYPE, decimals: 9, requiredRaw: FLOWX_SWAP_GAS_BUDGET_MIST }
            ];
      for (const requirement of requirements) {
        const balance = await options.client.core.getBalance({
          owner: input.account,
          coinType: requirement.coinType
        });
        const heldRaw = BigInt(balance.balance.balance);
        if (heldRaw < requirement.requiredRaw) {
          const isGasOnly = requirement.coinType === SUI_COIN_TYPE && source.coinType !== SUI_COIN_TYPE;
          return {
            status: "blocked",
            blockedReason: "insufficient_balance",
            checks: [
              failReviewCheck(
                "flowx_transaction_material_build_failed",
                "Transaction material build",
                `Insufficient balance: this swap needs ${displayRaw(requirement.requiredRaw, requirement.decimals)} ${requirement.symbol}${isGasOnly ? " for gas" : requirement.coinType === SUI_COIN_TYPE ? " (amount + gas)" : ""}, but the account holds ${displayRaw(heldRaw, requirement.decimals)} ${requirement.symbol}. Nothing was signed and no funds moved.`,
                "adapter"
              )
            ]
          };
        }
      }

      const transactionBytes = await buildBytes({
        account: input.account,
        quotePolicy: input.quotePolicy,
        sdkRoutes: input.quoteEvidence.sdkRoutes
      });

      const verification = await verifyFlowxSwapMaterialBytes({
        transactionBytes,
        quotePolicy: input.quotePolicy
      });
      if (verification.status === "failed") {
        return {
          status: "blocked",
          blockedReason: verification.blockedReason,
          checks: [
            failReviewCheck(
              "flowx_transaction_material_bytes_verification_failed",
              "Transaction material verification",
              verification.message,
              "adapter"
            )
          ]
        };
      }

      options.materialStore.deleteReviewSessionTransactionMaterials(input.reviewSessionId);
      const handle = options.materialStore.recordTransactionMaterial(
        {
          reviewSessionId: input.reviewSessionId,
          planId: input.plan.id,
          account: input.account,
          kind: "flowx_swap_transaction_data",
          source: "say_ur_intent_built",
          transactionBytes,
          expiresAt: quoteExpiresAt,
          redactedDiagnostics: {
            protocol: input.plan.protocol,
            adapterId: input.plan.adapterId,
            actionKind: input.plan.actionKind,
            poolKeys: input.quoteEvidence.pools.map((pool) => pool.poolKey),
            swapXToY: input.quotePolicy.swapXToY,
            quoteFetchedAt: input.quotePolicy.fetchedAt,
            quoteExpiresAt: quoteExpiresAt.toISOString(),
            sourceAmountRaw: input.quotePolicy.sourceAmountRaw,
            expectedOutRaw: input.quotePolicy.expectedOutRaw,
            minOutRaw: input.quotePolicy.minOutRaw,
            routerSlippageUnits: input.quotePolicy.routerSlippageUnits,
            deadlineMsEpoch: input.quotePolicy.deadlineMsEpoch
          }
        },
        input.now
      );

      return {
        status: "completed",
        evidence: handle,
        checks: [
          passReviewCheck(
            "flowx_transaction_material_built",
            "Transaction material build",
            "Built account-bound FlowX swap transaction material locally from the quoted route and verified inside the bytes that every Move call targets pinned FlowX packages, every shared object is a pinned FlowX config object, and the router arguments carry the policy expected-output, slippage, and deadline. The unsigned bytes stay only in the local material store until quote expiry.",
            "adapter"
          )
        ]
      };
    } catch (error) {
      const blockedReason = blockedReasonForBuildError(error);
      return {
        status: "blocked",
        blockedReason,
        checks: [
          failReviewCheck(
            "flowx_transaction_material_build_failed",
            "Transaction material build",
            buildFailureMessage(blockedReason, error),
            "adapter"
          )
        ]
      };
    }
  };
}

export function createFlowxSwapTransactionMaterialDigestProducer(options: {
  materialStore: Pick<LocalTransactionMaterialStore, "getTransactionMaterial">;
}): FlowxSwapTransactionMaterialDigestProducer {
  return async (input) => {
    const material = options.materialStore.getTransactionMaterial(input.materialHandle, input.now);
    if (!material) {
      return {
        status: "refresh_required",
        refreshReason: "quote_stale",
        checks: [
          failReviewCheck(
            "flowx_transaction_material_digest_unavailable",
            "Transaction material digest",
            "FlowX transaction material digest was not computed because the stored local material was unavailable or expired; refresh the review evidence before continuing.",
            "adapter"
          )
        ]
      };
    }

    let transactionDigest: string;
    try {
      transactionDigest = await Transaction.from(material.transactionBytes).getDigest();
    } catch {
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "flowx_transaction_material_digest_failed",
            "Transaction material digest",
            "FlowX transaction material digest could not be derived from the stored local transaction bytes.",
            "adapter"
          )
        ]
      };
    }

    const parsedDigest = suiTransactionDigestSchema.safeParse(transactionDigest);
    if (!parsedDigest.success) {
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "flowx_transaction_material_digest_invalid",
            "Transaction material digest",
            "FlowX transaction material digest did not match the pinned Sui SDK transaction digest format.",
            "adapter"
          )
        ]
      };
    }

    return {
      status: "completed",
      evidence: {
        materialId: material.materialId,
        reviewSessionId: material.reviewSessionId,
        planId: material.planId,
        account: material.account,
        kind: material.kind,
        source: material.source,
        digestKind: "sui_transaction_digest",
        transactionDigest: parsedDigest.data,
        computedAt: input.now.toISOString(),
        expiresAt: material.expiresAt
      },
      checks: [
        passReviewCheck(
          "flowx_transaction_material_digest_commitment",
          "Transaction material digest",
          "Derived a Sui transaction digest from the stored local unsigned transaction material. The digest and bytes remain internal until later review stages bind object ownership, human-readable review, and simulation evidence.",
          "adapter"
        )
      ]
    };
  };
}

function sdkTradeBytesBuilder(client: SuiGrpcClient): FlowxSwapTransactionBytesBuilder {
  return async ({ account, quotePolicy, sdkRoutes }) => {
    const trade = new Trade({
      network: "mainnet",
      sender: account,
      recipient: account,
      amountIn: quotePolicy.sourceAmountRaw,
      amountOut: quotePolicy.expectedOutRaw,
      slippage: quotePolicy.routerSlippageUnits,
      deadline: quotePolicy.deadlineMsEpoch,
      // The route entities come from the same quoter response that produced
      // the validated quote evidence; the byte verification below re-checks
      // every pinned target and policy number inside the built bytes.
      routes: sdkRoutes as ConstructorParameters<typeof Trade>[0]["routes"]
    });
    const transaction = await trade.buildTransaction({ client });
    transaction.setSenderIfNotSet(account);
    transaction.setGasBudget(FLOWX_SWAP_GAS_BUDGET_MIST);
    return transaction.build({ client });
  };
}

export type FlowxSwapMaterialBytesVerification =
  | { status: "ok" }
  | { status: "failed"; blockedReason: BlockedReason; message: string };

/**
 * Re-derive the safety-relevant facts from the built transaction bytes and
 * compare them with the pinned registry and the derived quote policy. The
 * bytes are the only authority: a mismatch blocks the review.
 */
export async function verifyFlowxSwapMaterialBytes(input: {
  transactionBytes: Uint8Array;
  quotePolicy: FlowxSwapQuotePolicyOk;
}): Promise<FlowxSwapMaterialBytesVerification> {
  let data;
  try {
    data = Transaction.from(input.transactionBytes).getData();
  } catch {
    return {
      status: "failed",
      blockedReason: "object_resolution_failed",
      message: "FlowX transaction material bytes could not be parsed as a Sui transaction."
    };
  }

  const allowedPackages = new Set(
    [
      MOVE_STDLIB_PACKAGE_ID,
      SUI_FRAMEWORK_PACKAGE_ID,
      FLOWX_CLMM_MAINNET.universalRouter.packageId,
      FLOWX_CLMM_MAINNET.universalRouter.wrappedRouterPackageId
    ].map((id) => normalizeSuiObjectId(id))
  );
  const allowedSharedObjects = new Set(
    [
      SUI_CLOCK_OBJECT_ID,
      FLOWX_CLMM_MAINNET.universalRouter.treasuryObjectId,
      FLOWX_CLMM_MAINNET.universalRouter.tradeIdTrackerObjectId,
      FLOWX_CLMM_MAINNET.universalRouter.partnerRegistryObjectId,
      FLOWX_CLMM_MAINNET.universalRouter.versionedObjectId,
      FLOWX_CLMM_MAINNET.poolRegistry.objectId,
      FLOWX_CLMM_MAINNET.versioned.objectId
    ].map((id) => normalizeSuiObjectId(id))
  );

  let routerBuildCall: { arguments: unknown[] } | undefined;
  for (const command of data.commands) {
    if (command.$kind !== "MoveCall" || !command.MoveCall) {
      continue;
    }
    const moveCall = command.MoveCall;
    const packageId = normalizeSuiObjectId(moveCall.package);
    if (!allowedPackages.has(packageId)) {
      return {
        status: "failed",
        blockedReason: "object_resolution_failed",
        message: `FlowX transaction material calls a package outside the pinned FlowX set: ${moveCall.package}::${moveCall.module}::${moveCall.function}.`
      };
    }
    if (
      packageId === normalizeSuiObjectId(FLOWX_CLMM_MAINNET.universalRouter.packageId) &&
      moveCall.module === "universal_router" &&
      moveCall.function === "build"
    ) {
      if (routerBuildCall !== undefined) {
        return {
          status: "failed",
          blockedReason: "object_resolution_failed",
          message: "FlowX transaction material contains more than one universal_router::build call."
        };
      }
      routerBuildCall = { arguments: moveCall.arguments };
    }
  }
  if (!routerBuildCall) {
    return {
      status: "failed",
      blockedReason: "object_resolution_failed",
      message: "FlowX transaction material does not contain the universal_router::build call."
    };
  }

  for (const inputEntry of data.inputs) {
    if (inputEntry.$kind !== "Object" || !inputEntry.Object) {
      continue;
    }
    const objectInput = inputEntry.Object;
    if (objectInput.$kind === "SharedObject" && objectInput.SharedObject) {
      const objectId = normalizeSuiObjectId(objectInput.SharedObject.objectId);
      if (!allowedSharedObjects.has(objectId)) {
        return {
          status: "failed",
          blockedReason: "object_resolution_failed",
          message: `FlowX transaction material references a shared object outside the pinned FlowX set: ${objectId}.`
        };
      }
    }
  }

  const expectations: { label: string; argumentIndex: number; expected: bigint }[] = [
    { label: "expected output", argumentIndex: 4, expected: BigInt(input.quotePolicy.expectedOutRaw) },
    { label: "slippage", argumentIndex: 5, expected: BigInt(input.quotePolicy.routerSlippageUnits) },
    { label: "deadline", argumentIndex: 6, expected: BigInt(input.quotePolicy.deadlineMsEpoch) }
  ];
  for (const expectation of expectations) {
    const actual = pureU64ArgumentValue(data, routerBuildCall.arguments, expectation.argumentIndex);
    if (actual === undefined) {
      return {
        status: "failed",
        blockedReason: "amount_mismatch",
        message: `FlowX transaction material router ${expectation.label} argument is not a pure u64 input.`
      };
    }
    if (actual !== expectation.expected) {
      return {
        status: "failed",
        blockedReason: "amount_mismatch",
        message: `FlowX transaction material router ${expectation.label} is ${actual}, but the derived quote policy requires ${expectation.expected}.`
      };
    }
  }

  return { status: "ok" };
}

function pureU64ArgumentValue(
  data: ReturnType<Transaction["getData"]>,
  callArguments: unknown[],
  argumentIndex: number
): bigint | undefined {
  const argument = callArguments[argumentIndex];
  if (typeof argument !== "object" || argument === null) {
    return undefined;
  }
  const argumentRecord = argument as { $kind?: string; Input?: number };
  if (argumentRecord.$kind !== "Input" || typeof argumentRecord.Input !== "number") {
    return undefined;
  }
  const inputEntry = data.inputs[argumentRecord.Input];
  if (!inputEntry || inputEntry.$kind !== "Pure" || !inputEntry.Pure) {
    return undefined;
  }
  try {
    return BigInt(bcs.U64.parse(fromBase64(inputEntry.Pure.bytes)));
  } catch {
    return undefined;
  }
}

function displayRaw(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function blockedReasonForBuildError(error: unknown): BlockedReason {
  if (error instanceof LocalTransactionMaterialStoreError) {
    return "object_resolution_failed";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/insufficient ?coin ?balance|insufficient balance/i.test(message)) {
    return "insufficient_balance";
  }
  if (/gas/i.test(message) && /insufficient|no valid|payment|budget/i.test(message)) {
    return "insufficient_gas";
  }
  return "object_resolution_failed";
}

function buildFailureMessage(blockedReason: BlockedReason, error: unknown): string {
  if (blockedReason === "insufficient_balance") {
    return "FlowX transaction material build failed before wallet handoff because the account does not have enough source or fee assets.";
  }
  if (blockedReason === "insufficient_gas") {
    return "FlowX transaction material build failed before wallet handoff because a usable gas payment could not be resolved.";
  }
  if (error instanceof SimulationError && error.executionError) {
    return "FlowX transaction was rejected during build-time simulation. Refresh the review or inspect its selected constraints. Nothing was signed or submitted.";
  }
  return "FlowX transaction material could not be built and verified. Nothing was signed or submitted.";
}
