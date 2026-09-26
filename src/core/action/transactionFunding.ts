import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import { deriveDynamicFieldID, fromBase58, fromHex, normalizeSuiAddress, toHex, SUI_TYPE_ARG } from "@mysten/sui/utils";
import { normalizeCoinType } from "../read/coinMetadata.js";
import { normalizedSuiAddressSchema } from "../suiAddress.js";
import { makeCanonicalRawU64StringSchema } from "../numeric/rawU64.js";

const raw = makeCanonicalRawU64StringSchema("funding amount");
const address = normalizedSuiAddressSchema;
const coinType = z.string().refine((value) => {
  try { return normalizeCoinType(value) === value; } catch { return false; }
});
const reference = z.object({ objectId: address, version: raw, digest: z.string() }).strict();
const expiration = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("epoch"), epoch: raw }).strict(),
  z.object({ kind: z.literal("valid_during"), minEpoch: raw, maxEpoch: raw,
    chain: z.string().min(1), nonce: z.number().int().min(0).max(0xffffffff) }).strict()
]);
export const transactionFundingDescriptionSchema = z.object({
  sender: address, gasOwner: address, chainIdentifier: z.string().min(1),
  gasBudgetRaw: raw, gasPriceRaw: raw,
  gasMode: z.enum(["coin_objects", "address_balance", "coin_reservation"]),
  gasPayments: z.array(reference),
  gasObjectIds: z.array(address),
  reservations: z.array(z.object({ objectId: address, amountRaw: raw, epoch: raw }).strict()),
  withdrawals: z.array(z.object({ inputIndex: z.number().int().min(0), owner: address,
    coinType, maxAmountRaw: raw }).strict()),
  expiration
}).strict();
export type TransactionFundingDescription = z.infer<typeof transactionFundingDescriptionSchema>;

const addressBalance = z.object({ owner: address, coinType,
  // A holding can exceed the u64 limit of an individual transaction input.
  balanceRaw: z.string().regex(/^(0|[1-9][0-9]*)$/), requiredRaw: z.string().regex(/^(0|[1-9][0-9]*)$/)
}).strict();
export const transactionFundingEvidenceSchema = transactionFundingDescriptionSchema.extend({
  observedEpoch: raw.optional(), addressBalances: z.array(addressBalance)
}).superRefine((value, ctx) => {
  try { assertFundingEvidence(value); }
  catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid funding evidence" }); }
});
export type TransactionFundingEvidence = z.infer<typeof transactionFundingEvidenceSchema>;

export type TransactionFundingSource = {
  getBalance(input: { owner: string; coinType: string }): Promise<{
    balance: { coinType: string; addressBalance: string }
  }>;
  getCurrentSystemState(): Promise<{ systemState: { epoch: string } }>;
};

export class TransactionFundingError extends Error {
  constructor(readonly kind: "invalid" | "unavailable" | "insufficient_balance" | "insufficient_gas", message: string) {
    super(message);
  }
}

// Reservation-format portions are adapted from Mysten Labs (Apache-2.0).
// Copyright (c) Mysten Labs, Inc. See LICENSES/@mysten-sui-2.17.0-Apache-2.0.txt.
// Sui mainnet-v1.72.5 coin_reservation.rs and @mysten/sui 2.17.0
// utils/coin-reservation.ts define this layout. The SDK helper is not exported.
// Decode only: coin selection and reservation creation remain SDK/node work.
export function readCoinReservation(digest: string): { amountRaw: string; epoch: string } | undefined {
  const bytes = fromBase58(digest);
  if (bytes.length !== 32) throw new Error("Invalid payment reference digest length");
  if (!bytes.slice(12).every((byte) => byte === 0xac)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { amountRaw: view.getBigUint64(0, true).toString(), epoch: view.getUint32(8, true).toString() };
}

function reservationId(owner: string, chain: string): string {
  const key = TypeTagSerializer.parseFromStr("0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>");
  const id = deriveDynamicFieldID(normalizeSuiAddress("0xacc"), key, bcs.Address.serialize(owner).toBytes());
  const result = fromHex(id.slice(2)), mask = fromBase58(chain);
  if (mask.length !== 32) throw new Error("Invalid funding chain identifier");
  for (let i = 0; i < result.length; i++) result[i] = result[i]! ^ mask[i]!;
  return normalizeSuiAddress(toHex(result));
}

type FundingTransaction = {
  sender?: string | null | undefined;
  gasData: { owner?: string | null | undefined; budget?: string | number | null | undefined; price?: string | number | null | undefined; payment?: readonly unknown[] | null | undefined };
  inputs: readonly unknown[];
  expiration?: unknown;
};

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") throw new Error("Missing funding transaction field");
  return value as Record<string, any>;
}

export function describeTransactionFunding(data: FundingTransaction, account: string, chainIdentifier: string): TransactionFundingDescription {
  if (!data.sender || !data.gasData.owner || !Array.isArray(data.gasData.payment)) throw new Error("Missing sender, gas owner or gas payments");
  const sender = normalizeSuiAddress(data.sender), gasOwner = normalizeSuiAddress(data.gasData.owner);
  if (sender !== account || gasOwner !== account) throw new Error("Transaction funding must belong to the reviewed account");
  const gasPayments = data.gasData.payment.map((item) => reference.parse(item));
  const gasObjectIds: string[] = [], reservations: TransactionFundingDescription["reservations"] = [];
  for (const payment of gasPayments) {
    const reserved = readCoinReservation(payment.digest);
    if (reserved) {
      if (payment.objectId !== reservationId(account, chainIdentifier) || reserved.amountRaw === "0") throw new Error("Invalid account-bound SUI reservation");
      reservations.push({ objectId: payment.objectId, ...reserved });
    } else gasObjectIds.push(payment.objectId);
  }
  if (new Set(gasPayments.map((item) => item.objectId)).size !== gasPayments.length) throw new Error("Duplicate gas payment reference");
  const withdrawals: TransactionFundingDescription["withdrawals"] = [];
  for (const [inputIndex, input] of data.inputs.entries()) {
    const item = record(input);
    if (item.$kind === "FundsWithdrawal" || "FundsWithdrawal" in item) {
      const withdrawal = record(item.FundsWithdrawal);
      if (withdrawal.withdrawFrom?.Sender !== true || withdrawal.reservation?.MaxAmountU64 === undefined ||
        typeof withdrawal.typeArg?.Balance !== "string") throw new Error("Unsupported address-balance withdrawal");
      const maxAmountRaw = raw.parse(withdrawal.reservation.MaxAmountU64);
      if (maxAmountRaw === "0") throw new Error("Address-balance withdrawal must be positive");
      withdrawals.push({ inputIndex, owner: account, coinType: normalizeCoinType(withdrawal.typeArg.Balance), maxAmountRaw });
    }
  }
  let expiry: TransactionFundingDescription["expiration"] = { kind: "none" };
  if (data.expiration) {
    const value = record(data.expiration);
    if (value.ValidDuring) {
      const during = value.ValidDuring;
      if (during.minTimestamp != null || during.maxTimestamp != null) throw new Error("Timestamp expiration is unsupported");
      expiry = expiration.parse({ kind: "valid_during", minEpoch: during.minEpoch, maxEpoch: during.maxEpoch, chain: during.chain, nonce: during.nonce });
      if (expiry.kind !== "valid_during" || expiry.chain !== chainIdentifier || BigInt(expiry.maxEpoch) < BigInt(expiry.minEpoch) ||
        BigInt(expiry.maxEpoch) > BigInt(expiry.minEpoch) + 1n) throw new Error("Invalid mainnet epoch window");
    } else if (value.Epoch !== undefined) {
      const epoch = value.Epoch;
      // The pinned SDK's BCS Epoch decoder returns a number, unlike ValidDuring.
      if (typeof epoch === "number" && (!Number.isSafeInteger(epoch) || epoch < 0)) {
        throw new Error("Transaction expiration epoch must be a non-negative safe integer");
      }
      expiry = expiration.parse({ kind: "epoch", epoch: typeof epoch === "number" ? String(epoch) : epoch });
    } else if (!value.None) throw new Error("Unsupported transaction expiration");
  }
  const gasMode = gasPayments.length === 0 ? "address_balance" : reservations.length ? "coin_reservation" : "coin_objects";
  if (gasMode === "address_balance" && expiry.kind !== "valid_during") throw new Error("Address-balance gas requires ValidDuring expiration");
  const description = transactionFundingDescriptionSchema.parse({ sender, gasOwner, chainIdentifier,
    gasBudgetRaw: data.gasData.budget, gasPriceRaw: data.gasData.price, gasMode, gasPayments, gasObjectIds, reservations, withdrawals, expiration: expiry });
  if (BigInt(description.gasBudgetRaw) === 0n || BigInt(description.gasPriceRaw) === 0n) throw new Error("Gasless transactions are unsupported");
  return description;
}

export function addressFundingRequirements(funding: TransactionFundingDescription): Map<string, bigint> {
  const amounts = new Map<string, bigint>();
  for (const withdrawal of funding.withdrawals) amounts.set(withdrawal.coinType,
    (amounts.get(withdrawal.coinType) ?? 0n) + BigInt(withdrawal.maxAmountRaw));
  const gasReservation = funding.gasMode === "address_balance" ? BigInt(funding.gasBudgetRaw)
    : funding.reservations.reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
  if (gasReservation > 0n) amounts.set(SUI_TYPE_ARG, (amounts.get(SUI_TYPE_ARG) ?? 0n) + gasReservation);
  return amounts;
}

function assertFundingEvidence(value: TransactionFundingEvidence): void {
  if (value.sender !== value.gasOwner) throw new Error("Funding account mismatch");
  const objects: string[] = [], reservations: TransactionFundingDescription["reservations"] = [];
  for (const payment of value.gasPayments) {
    const reserved = readCoinReservation(payment.digest);
    if (reserved) {
      if (payment.objectId !== reservationId(value.sender, value.chainIdentifier) || reserved.amountRaw === "0") throw new Error("Invalid funding reservation");
      reservations.push({ objectId: payment.objectId, ...reserved });
    } else objects.push(payment.objectId);
  }
  const mode = value.gasPayments.length === 0 ? "address_balance" : reservations.length ? "coin_reservation" : "coin_objects";
  if (value.gasMode !== mode || !isDeepStrictEqual(objects, value.gasObjectIds) || !isDeepStrictEqual(reservations, value.reservations) ||
    new Set(value.gasPayments.map((item) => item.objectId)).size !== value.gasPayments.length ||
    new Set(value.withdrawals.map((item) => item.inputIndex)).size !== value.withdrawals.length ||
    value.withdrawals.some((item) => item.owner !== value.sender || item.maxAmountRaw === "0") ||
    value.gasBudgetRaw === "0" || value.gasPriceRaw === "0") throw new Error("Inconsistent funding description");
  const expected = addressFundingRequirements(value);
  if (value.addressBalances.length !== expected.size || new Set(value.addressBalances.map((item) => item.coinType)).size !== expected.size) throw new Error("Incomplete address-balance evidence");
  for (const balance of value.addressBalances) {
    if (balance.owner !== value.sender || expected.get(balance.coinType)?.toString() !== balance.requiredRaw || BigInt(balance.balanceRaw) < BigInt(balance.requiredRaw)) throw new Error("Address-balance evidence does not cover the transaction");
  }
  const epoch = value.observedEpoch === undefined ? undefined : BigInt(value.observedEpoch);
  for (const reserved of value.reservations) {
    if (epoch === undefined || (epoch !== BigInt(reserved.epoch) && epoch !== BigInt(reserved.epoch) + 1n)) throw new Error("Coin reservation epoch expired");
  }
  const expiry = value.expiration;
  if (value.gasMode === "address_balance" && expiry.kind !== "valid_during") throw new Error("Missing funding epoch window");
  if (expiry.kind === "valid_during" && (expiry.chain !== value.chainIdentifier || BigInt(expiry.maxEpoch) < BigInt(expiry.minEpoch) ||
    BigInt(expiry.maxEpoch) > BigInt(expiry.minEpoch) + 1n)) throw new Error("Invalid funding epoch window");
  if (expiry.kind === "valid_during" && (epoch === undefined || epoch < BigInt(expiry.minEpoch) || epoch > BigInt(expiry.maxEpoch))) throw new Error("Funding epoch window expired");
  if (expiry.kind === "epoch" && (epoch === undefined || epoch > BigInt(expiry.epoch))) throw new Error("Transaction epoch expired");
}

export async function readTransactionFunding(description: TransactionFundingDescription, source?: TransactionFundingSource): Promise<TransactionFundingEvidence> {
  const addressBalances: TransactionFundingEvidence["addressBalances"] = [];
  let observedEpoch: string | undefined;
  try {
    if (description.expiration.kind !== "none" || description.reservations.length) {
      if (!source) throw new Error("Funding source unavailable");
      observedEpoch = raw.parse((await source.getCurrentSystemState()).systemState.epoch);
    }
    for (const [coinType, required] of addressFundingRequirements(description)) {
      if (!source) throw new Error("Funding source unavailable");
      const response = (await source.getBalance({ owner: description.sender, coinType })).balance;
      if (normalizeCoinType(response.coinType) !== coinType || !/^(0|[1-9][0-9]*)$/.test(response.addressBalance)) throw new Error("Invalid address-balance response");
      if (BigInt(response.addressBalance) < required) throw new TransactionFundingError(
        coinType === SUI_TYPE_ARG && !description.withdrawals.some((item) => item.coinType === coinType) ? "insufficient_gas" : "insufficient_balance",
        "The reviewed account's address balance does not cover the transaction's withdrawal and gas reservations. Nothing was submitted.");
      addressBalances.push({ owner: description.sender, coinType, balanceRaw: response.addressBalance, requiredRaw: required.toString() });
    }
  } catch (error) {
    if (error instanceof TransactionFundingError) throw error;
    throw new TransactionFundingError("unavailable", "Transaction funding could not be verified from mainnet balance and epoch reads. Nothing was submitted.");
  }
  return transactionFundingEvidenceSchema.parse({ ...description, ...(observedEpoch === undefined ? {} : { observedEpoch }), addressBalances });
}

export function assertTransactionFundingMatches(description: TransactionFundingDescription, evidence: TransactionFundingEvidence | TransactionFundingDescription): void {
  if (!isDeepStrictEqual(description, transactionFundingDescriptionSchema.parse(
    Object.fromEntries(Object.keys(transactionFundingDescriptionSchema.shape).map((key) => [key, (evidence as Record<string, unknown>)[key]]))
  ))) throw new Error("Transaction funding evidence does not match stored transaction material");
}

export function transactionFundingSummary(funding: TransactionFundingEvidence): string {
  transactionFundingEvidenceSchema.parse(funding);
  const gas = funding.gasMode === "address_balance" ? "the reviewed account's SUI address balance"
    : funding.gasMode === "coin_objects" ? "the reviewed account's SUI coin objects"
    : funding.gasObjectIds.length ? "an address-balance reservation and SUI coin objects belonging to the reviewed account"
    : "the reviewed account's SUI address-balance reservation";
  return `Gas payment uses ${gas}. ${funding.withdrawals.length ? "Transaction inputs also reserve funds from the reviewed account's address balances." : "There are no explicit address-balance input withdrawals."} These are review-time funding facts, not guaranteed execution.`;
}
