import type { SuiClientTypes } from "@mysten/sui/client";
import { assertNoForbiddenMcpFields } from "./forbiddenFields.js";
import {
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE,
  type SuiChainReceiptAccountBalanceChange,
  type SuiChainReceiptEvidence,
  type SuiChainReceiptIncludeField,
  suiChainReceiptEvidenceSchema
} from "./suiChainReceiptEvidence.js";
import { normalizeCoinType } from "../read/coinMetadata.js";
import { parseSuiAddress, suiTransactionDigestSchema } from "../suiAddress.js";
import {
  effectsStatusFromSdk,
  isReceiptNotFoundError,
  objectTypesFromSdk,
  packageCallsFromTransaction,
  receiptErrorMessage,
  requireReceiptAddress
} from "./suiChainReceiptMapping.js";

type ChainReceiptInclude = { [Field in SuiChainReceiptIncludeField]: true };

export const SUI_CHAIN_RECEIPT_GET_TRANSACTION_INCLUDE = includeObjectFromFields(
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE
);

// Bounded per-read wait for the known digest to become visible on this node.
// This existing 12-second source-read window is independent of the backend's
// 10-minute initial observation deadline. A missing receipt does not establish
// whether a prior submit (including one with a lost reply) executed.
export const SUI_CHAIN_RECEIPT_WAIT_TIMEOUT_MS = 12_000;

// waitForTransaction aborts with a DOMException named "TimeoutError" when its wait window elapses.
// Treat that exactly like not_found — the transaction is simply not readable here yet — so the
// session stays pending for a retry rather than being marked a verification failure.
function isWaitTimeoutError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError";
}

export type SuiChainReceiptVerifierClient = {
  core: {
    getChainIdentifier(): Promise<SuiClientTypes.GetChainIdentifierResponse>;
    getTransaction(
      options: SuiClientTypes.GetTransactionOptions<ChainReceiptInclude>
    ): Promise<SuiClientTypes.TransactionResult<ChainReceiptInclude>>;
    waitForTransaction(
      options: SuiClientTypes.WaitForTransactionOptions<ChainReceiptInclude>
    ): Promise<SuiClientTypes.TransactionResult<ChainReceiptInclude>>;
  };
};

export type VerifySuiChainReceiptInput = {
  txDigest: string;
  reviewedTransactionDigest: string;
  account: string;
  now: Date;
};

export type VerifySuiChainReceiptOptions = {
  client: SuiChainReceiptVerifierClient;
  network: "mainnet";
  expectedChainIdentifier: string;
};

export type SuiChainReceiptVerificationResult =
  | {
      status: "verified_success";
      receipt: SuiChainReceiptEvidence;
    }
  | {
      status: "verified_failure";
      failureReason: "chain_execution_failed";
      message: string;
      receipt: SuiChainReceiptEvidence;
    }
  | {
      status: "not_found";
      failureReason: "chain_receipt_unavailable";
      message: string;
    }
  | {
      status: "verification_failed";
      failureReason: "receipt_verification_failed";
      message: string;
    };

export async function verifySuiChainReceipt(
  options: VerifySuiChainReceiptOptions,
  input: VerifySuiChainReceiptInput
): Promise<SuiChainReceiptVerificationResult> {
  const parsedInput = parseVerifierInput(input);
  if (!parsedInput.ok) {
    return verificationFailed(parsedInput.message);
  }

  if (options.network !== "mainnet") {
    return verificationFailed("Chain receipt verification requires a verified Sui mainnet endpoint.");
  }

  let chainIdentifier: string;
  try {
    const chainIdentifierResult = await options.client.core.getChainIdentifier();
    chainIdentifier = chainIdentifierResult.chainIdentifier;
  } catch (error) {
    return verificationFailed(receiptErrorMessage(error, "Sui mainnet chain identifier lookup failed."));
  }
  if (chainIdentifier !== options.expectedChainIdentifier) {
    return verificationFailed("Chain receipt verification requires a verified Sui mainnet endpoint.");
  }

  let result: SuiClientTypes.TransactionResult<ChainReceiptInclude>;
  try {
    // The signed transaction was just submitted: it is on chain but may not yet be queryable on
    // this server's fullnode (checkpoint-propagation lag). Wait for it instead of returning a
    // premature not_found, so a single review-page poll resolves straight to the final receipt.
    result = await options.client.core.waitForTransaction({
      digest: parsedInput.txDigest,
      include: SUI_CHAIN_RECEIPT_GET_TRANSACTION_INCLUDE,
      timeout: SUI_CHAIN_RECEIPT_WAIT_TIMEOUT_MS
    });
  } catch (error) {
    if (isReceiptNotFoundError(error) || isWaitTimeoutError(error)) {
      return {
        status: "not_found",
        failureReason: "chain_receipt_unavailable",
        message: "Sui mainnet did not return a transaction for the signed digest within the wait window."
      };
    }
    return verificationFailed(receiptErrorMessage(error, "Sui mainnet transaction lookup failed."));
  }

  try {
    const transaction = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
    const receipt = createSuiChainReceiptEvidenceFromTransaction({
      transaction,
      txDigest: parsedInput.txDigest,
      reviewedTransactionDigest: parsedInput.reviewedTransactionDigest,
      account: parsedInput.account,
      chainIdentifier,
      fetchedAt: parsedInput.now
    });
    if (!receipt.effectsStatus.success) {
      return {
        status: "verified_failure",
        failureReason: "chain_execution_failed",
        message: "Sui mainnet verified the transaction receipt and reported failed execution effects.",
        receipt
      };
    }
    return { status: "verified_success", receipt };
  } catch (error) {
    return verificationFailed(receiptErrorMessage(error, "Sui mainnet transaction receipt could not be verified."));
  }
}

function includeObjectFromFields(fields: readonly SuiChainReceiptIncludeField[]): ChainReceiptInclude {
  return Object.fromEntries(fields.map((field) => [field, true])) as ChainReceiptInclude;
}

function parseVerifierInput(input: VerifySuiChainReceiptInput):
  | { ok: true; txDigest: string; reviewedTransactionDigest: string; account: string; now: Date }
  | { ok: false; message: string } {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    return { ok: false, message: "Chain receipt fetchedAt time must be a valid Date." };
  }
  const txDigest = suiTransactionDigestSchema.safeParse(input.txDigest);
  if (!txDigest.success) {
    return { ok: false, message: "Signed transaction digest is not a valid Sui transaction digest." };
  }
  const reviewedTransactionDigest = suiTransactionDigestSchema.safeParse(input.reviewedTransactionDigest);
  if (!reviewedTransactionDigest.success) {
    return { ok: false, message: "Reviewed transaction digest is not a valid Sui transaction digest." };
  }
  const account = parseSuiAddress(input.account);
  if (!account) {
    return { ok: false, message: "Reviewed account is not a valid Sui address." };
  }
  return {
    ok: true,
    txDigest: txDigest.data,
    reviewedTransactionDigest: reviewedTransactionDigest.data,
    account,
    now: input.now
  };
}

function createSuiChainReceiptEvidenceFromTransaction(input: {
  transaction: SuiClientTypes.Transaction<ChainReceiptInclude>;
  txDigest: string;
  reviewedTransactionDigest: string;
  account: string;
  chainIdentifier: string;
  fetchedAt: Date;
}): SuiChainReceiptEvidence {
  if (input.txDigest !== input.reviewedTransactionDigest) {
    throw new Error("Signed transaction digest does not match the reviewed transaction digest.");
  }
  if (input.transaction.digest !== input.txDigest) {
    throw new Error("Sui mainnet returned a transaction digest that does not match the signed digest.");
  }
  const transactionData = input.transaction.transaction;
  if (!transactionData) {
    throw new Error("Sui mainnet receipt is missing parsed transaction data.");
  }
  const effects = input.transaction.effects;
  if (!effects) {
    throw new Error("Sui mainnet receipt is missing transaction effects.");
  }
  if (effects.transactionDigest !== input.txDigest) {
    throw new Error("Sui mainnet receipt effects digest does not match the signed digest.");
  }
  const sender = requireReceiptAddress(transactionData.sender, "Sui mainnet receipt is missing a valid sender.");
  if (sender !== input.account) {
    throw new Error("Sui mainnet receipt sender does not match the reviewed account.");
  }
  if (!input.transaction.balanceChanges) {
    throw new Error("Sui mainnet receipt is missing balance changes.");
  }
  if (!input.transaction.objectTypes) {
    throw new Error("Sui mainnet receipt is missing object type map.");
  }

  const receipt = {
    kind: "sui_chain_receipt_v1",
    source: {
      method: "client.core.getTransaction",
      network: "sui:mainnet",
      chainIdentifier: input.chainIdentifier,
      fetchedAt: input.fetchedAt.toISOString(),
      include: [...SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE]
    },
    txDigest: input.txDigest,
    sender,
    effectsStatus: effectsStatusFromSdk(effects.status),
    packageCalls: packageCallsFromTransaction(transactionData),
    accountBalanceChanges: accountBalanceChangesFromSdk(input.transaction.balanceChanges, input.account),
    objectTypes: objectTypesFromSdk(input.transaction.objectTypes)
  } satisfies SuiChainReceiptEvidence;
  const parsed = suiChainReceiptEvidenceSchema.parse(receipt);
  assertNoForbiddenMcpFields(parsed);
  return parsed;
}

function accountBalanceChangesFromSdk(
  balanceChanges: SuiClientTypes.BalanceChange[],
  account: string
): SuiChainReceiptAccountBalanceChange[] {
  return balanceChanges.flatMap((change, index) => {
    const address = requireReceiptAddress(
      change.address,
      "Sui mainnet receipt contains a balance change with an invalid address."
    );
    if (address !== account) {
      return [];
    }
    const amount = BigInt(change.amount);
    return [{
      index,
      coinType: normalizeCoinType(change.coinType),
      amountRaw: amount.toString(),
      direction: amount > 0n ? "increase" : amount < 0n ? "decrease" : "zero"
    }];
  });
}

function verificationFailed(message: string): SuiChainReceiptVerificationResult {
  return {
    status: "verification_failed",
    failureReason: "receipt_verification_failed",
    message
  };
}

