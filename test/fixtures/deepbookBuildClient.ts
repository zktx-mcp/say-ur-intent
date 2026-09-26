import { vi } from "vitest";
import { GrpcTypes, SuiGrpcClient } from "@mysten/sui/grpc";
import { mainnetCoins, mainnetPools } from "@mysten/deepbook-v3";
import { normalizeSuiAddress, normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";

export const BUILD_CHAIN = "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S";
const gasCoinId = `0x${"b".repeat(64)}`;
const coinsByType = new Map(Object.values(mainnetCoins).map((coin, index) => [normalizeStructTag(coin.type), {
  objectId: normalizeStructTag(coin.type) === SUI_TYPE_ARG ? gasCoinId : normalizeSuiAddress((100 + index).toString(16)),
  version: "1", digest: "7".repeat(44), balance: "1000000000000", coinType: normalizeStructTag(coin.type)
}]));
const sharedIds = new Set([normalizeSuiAddress("0x6"), ...Object.values(mainnetPools).map((pool) => normalizeSuiAddress(pool.address))]);

// Only source responses are simulated. The real SDK intent and gRPC resolution
// plugins consume them; this fixture never changes TransactionData directly.
export function createDeepbookBuildClient(input: {
  expectedChainIdentifier: string;
  buildError?: Error | undefined;
  buildFailure?: GrpcTypes.ExecutionError;
  addressBalances?: Record<string, string>;
  coinBalances?: Record<string, string>;
  gasPayments?: GrpcTypes.ObjectReference[];
  sharedObjectIds?: string[];
}) {
  const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://unused.invalid" });
  const balanceFor = (coinType: string) => ({
    coin: input.coinBalances?.[coinType] ?? "1000000000000",
    address: input.addressBalances?.[coinType] ?? "0"
  });
  vi.spyOn(client.core, "getBalance").mockImplementation(async ({ coinType = SUI_TYPE_ARG }) => {
    const type = normalizeStructTag(coinType), held = balanceFor(type);
    return { balance: { coinType: type, balance: (BigInt(held.coin) + BigInt(held.address)).toString(),
      coinBalance: held.coin, addressBalance: held.address } };
  });
  vi.spyOn(client.core, "listCoins").mockImplementation(async ({ coinType = SUI_TYPE_ARG, owner }) => {
    const type = normalizeStructTag(coinType), coin = coinsByType.get(type);
    if (!coin) throw new Error("Missing fixture coin type");
    const held = balanceFor(type);
    return { objects: held.coin === "0" ? [] : [{ ...coin, balance: held.coin, type: `0x2::coin::Coin<${type}>`, owner: { $kind: "AddressOwner" as const, AddressOwner: owner } }], hasNextPage: false, cursor: null };
  });
  vi.spyOn(client.core, "getCurrentSystemState").mockResolvedValue({ systemState: { epoch: "1", referenceGasPrice: "1" } } as never);
  vi.spyOn(client.core, "getChainIdentifier").mockResolvedValue({ chainIdentifier: input.expectedChainIdentifier });
  vi.spyOn(client.transactionExecutionService, "simulateTransaction").mockImplementation((request) => {
    if (input.buildError) return Promise.reject(input.buildError) as never;
    const transaction = structuredClone(request.transaction!);
    if (transaction.kind?.data.oneofKind !== "programmableTransaction") throw new Error("Expected fixture PTB");
    const ptb = transaction.kind.data.programmableTransaction;
    for (const item of ptb.inputs) {
      if (!item.objectId || item.version !== undefined) continue;
      if (!sharedIds.has(normalizeSuiAddress(item.objectId)) && !input.sharedObjectIds?.includes(normalizeSuiAddress(item.objectId))) {
        throw new Error("Unknown fixture object");
      }
      item.kind = GrpcTypes.Input_InputKind.SHARED;
      item.version = 1n;
      item.mutable ??= normalizeSuiAddress(item.objectId) !== normalizeSuiAddress("0x6");
    }
    transaction.gasPayment = { owner: transaction.sender!, price: 1n, budget: transaction.gasPayment!.budget!,
      objects: input.gasPayments ?? [{ objectId: gasCoinId, version: 1n, digest: "7".repeat(44) }] };
    transaction.expiration = transaction.gasPayment.objects.length === 0
      ? { kind: GrpcTypes.TransactionExpiration_TransactionExpirationKind.VALID_DURING,
          minEpoch: 1n, epoch: 2n, chain: input.expectedChainIdentifier, nonce: 7 }
      : { kind: GrpcTypes.TransactionExpiration_TransactionExpirationKind.NONE };
    return Promise.resolve({ response: { transaction: { transaction, effects: { status: input.buildFailure ? { success: false, error: input.buildFailure } : { success: true } } } } }) as never;
  });
  return client;
}

// The declared coin catalog is independent of transactions returned by the SDK.
export function buildFixtureCoin(coinType: string) {
  const coin = coinsByType.get(normalizeStructTag(coinType));
  if (!coin) throw new Error("Missing fixture coin");
  return { ...coin };
}
