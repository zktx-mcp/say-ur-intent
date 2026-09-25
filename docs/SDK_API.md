# SDK API Verification

This document records the pinned SDK APIs used by the current runtime. The source of truth is the installed package source in `node_modules`, not memory or external summaries.

## Package Versions

- `@modelcontextprotocol/ext-apps`: `1.7.5`
- `@modelcontextprotocol/sdk`: `1.29.0`
- `@mysten/sui`: `2.17.0`
- `@mysten/deepbook-v3`: `1.3.6`
- `@flowx-finance/sdk`: `2.1.0`
- `@walletconnect/sign-client`, `@walletconnect/types`, `@walletconnect/utils`: `2.23.10`
- `qrcode`: `1.5.4`
- `@zktx.io/ptb-model`: `0.5.0`
- `mermaid`: `11.12.0`

## MCP Apps

`@modelcontextprotocol/ext-apps` is pinned to `1.7.5`, with MCP SDK `1.29.0`. The server uses `registerAppTool`, `registerAppResource` and `getUiCapability`; the view uses `App` for host-mediated calls and teardown. Account, Receipt, Chart, Connect and Review are separate self-contained resources, so an account card does not load the PTB or chart renderer. The server keeps app-only permissions out of model content.

The shared server uses the pinned MCP SDK Streamable HTTP transport behind authenticated loopback access. Stdio clients forward tool, resource and prompt requests with their original client identity and capabilities. Ordinary MCP input schemas remain unchanged by the transport; the 64 KiB card/HTTP input limit includes the card call envelope.

## Sui gRPC Client

Verified from `node_modules/@mysten/sui/src/grpc/index.ts`, `client.ts`, `core.ts`, and `node_modules/@mysten/sui/src/client/types.ts`.

- Import path: `@mysten/sui/grpc`
- Client: `SuiGrpcClient`
- Constructor input includes:
  - `network`
  - `baseUrl`
  - optional `fetchInit`
  - or custom `transport`
- Runtime construction:

```ts
new SuiGrpcClient({
  baseUrl: "https://fullnode.mainnet.sui.io:443",
  network: "mainnet"
});
```

Confirmed methods:

| Method | Signature Source | Notes |
| --- | --- | --- |
| `client.core.getChainIdentifier()` | `GrpcCoreClient.getChainIdentifier(_options?)` | Returns `{ chainIdentifier: string }`. |
| `client.core.listBalances(options)` | `GrpcCoreClient.listBalances(options)` | `options.owner` is required; `options.cursor` and `options.limit` are available. Returns `{ balances, hasNextPage, cursor }`. |
| `client.core.getCoinMetadata(options)` | `GrpcCoreClient.getCoinMetadata(options)` | `options.coinType` is required. Returns `{ coinMetadata }`; metadata can be `null`. The gRPC implementation resolves type through MVR before calling `stateService.getCoinInfo`; the pinned gRPC implementation catches `getCoinInfo` failures and returns `coinMetadata: null`, so callers cannot distinguish those failures from missing metadata through this method alone. |
| `client.core.simulateTransaction(options)` | `GrpcCoreClient.simulateTransaction(options)` | Accepts `transaction`, optional `include`, optional `checksEnabled`. |

`SimulateTransactionOptions.checksEnabled` defaults to enabled and can be set to `false` for debug/read inspection. Read-only DeepBook SDK methods use simulation internally and must not be presented as signing readiness.

For review-time transaction simulation, use the runtime gRPC `client.core.simulateTransaction(...)` path with validation checks enabled. The required first-route review include set is `effects`, `balanceChanges`, `objectTypes`, and `transaction`: those fields provide status, gas used, changed-object context, raw balance deltas, sender, gas config, inputs, and command shape. Missing required fields must fail closed; do not infer readiness from partial simulation data. Do not request `bcs` for product-facing or stored review evidence, because raw transaction bytes are not an MCP or review-app output. `commandResults` remains scoped to read-only DeepBook raw quote extraction and is not swap review simulation evidence. Failed simulations are blocked pre-signing review facts, not wallet rejection, transaction submission failure, or automatic transient retry evidence. A thrown simulation call is refreshable only when it is classified as a transport, RPC, timeout, or endpoint availability failure; malformed transaction material, request-shape bugs, incomplete SDK results, and adapter defects must remain blocked.

## DeepBook Read Methods

Verified from `node_modules/@mysten/deepbook-v3/src/client.ts` and `node_modules/@mysten/deepbook-v3/src/types/index.ts`.

- Import path: `@mysten/deepbook-v3`
- Client: `DeepBookClient`
- Constructor requires:
  - `client`
  - `address`
  - `network`
- Constructor also accepts optional configured `balanceManagers`; Say Ur Intent uses this only to register a user-supplied `managerAddress` as an ephemeral SDK BalanceManager key for account-bound inventory detail reads.

The `address` is used by the SDK as the transaction simulation sender for read queries. For sender-independent DeepBook orderbook, raw-quantity quote, and display-amount quote reads, Say Ur Intent supplies an internal mainnet placeholder address. This placeholder is not user identity and must not be represented as wallet authorization.

Account-bound DeepBook reads, such as `read.summarize_deepbook_account_inventory`, use the active account address as the simulation sender. The product filters manager detail reads through on-chain `getBalanceManagerIds(owner)` discovery before calling account-bound detail methods; this is active read context, not signing authorization or custody.

Confirmed methods:

| Method | Return Type | Used For |
| --- | --- | --- |
| `midPrice(poolKey)` | `Promise<number>` | Orderbook context. |
| `poolBookParams(poolKey)` | `Promise<PoolBookParams>` | Tick, lot, and min size context. |
| `getLevel2TicksFromMid(poolKey, ticks)` | `Promise<Level2TicksFromMid>` | Bid/ask levels around mid price. |
| `deepBook.getQuoteQuantityOut(poolKey, baseQuantity)` | Transaction builder thunk | Base-to-quote quantity quote. Say Ur Intent passes positive raw input quantities that fit the SDK `u64` argument and parses the simulated raw `u64` return values directly. |
| `deepBook.getBaseQuantityOut(poolKey, quoteQuantity)` | Transaction builder thunk | Quote-to-base quantity quote. Say Ur Intent passes positive raw input quantities that fit the SDK `u64` argument and parses the simulated raw `u64` return values directly. |
| `getBalanceManagerIds(owner)` | `Promise<string[]>` | Active-account BalanceManager discovery. |
| `accountExists(poolKey, managerKey)` | `Promise<boolean>` | Gate before account-bound detail reads. |
| `account(poolKey, managerKey)` | `Promise<AccountInfo>` | Display-like account ledger and rebate inventory. Not raw/signable quantity. |
| `lockedBalance(poolKey, balanceManagerKey)` | `Promise<LockedBalances>` | Display-like balances tied to open orders. Not withdrawable/spendable readiness. |
| `accountOpenOrders(poolKey, managerKey)` | `Promise<string[]>` | Open order ID inventory; Say Ur Intent caps returned IDs in its public response. |

Relevant return shapes:

```ts
type PoolBookParams = {
  tickSize: number;
  lotSize: number;
  minSize: number;
};

type Level2TicksFromMid = {
  bid_prices: number[];
  bid_quantities: number[];
  ask_prices: number[];
  ask_quantities: number[];
};

type QuoteQuantityOut = {
  baseQuantity: number;
  baseOut: number;
  quoteOut: number;
  deepRequired: number;
};

type BaseQuantityOut = {
  quoteQuantity: number;
  baseOut: number;
  quoteOut: number;
  deepRequired: number;
};
```

The pinned SDK accepts `number | bigint` quote inputs. Its high-level quote query objects include an input echo field (`baseQuantity` or `quoteQuantity`) produced with `Number(inputRaw)`, plus display quote fields (`baseOut`, `quoteOut`, and `deepRequired`) produced after scalar division and `Number(...)` conversion. Say Ur Intent does not use those high-level query objects as the canonical quote source for adapter preparation. It uses the pinned SDK transaction builder quote functions, requests `client.core.simulateTransaction` command results, and parses raw `u64` return values. The simulated public Move entrypoint is `pool::get_quote_quantity_out` for base-to-quote reads and `pool::get_base_quantity_out` for quote-to-base reads; both delegate to `pool::get_quantity_out`, whose official Move source defines the return order as `base_quantity_out`, `quote_quantity_out`, and `deep_quantity_required`. Public `quote` fields are exact decimal display strings derived from those raw values through pinned DeepBook scalars; `rawQuote` carries the raw evidence. `read.quote_deepbook_action` marks the input as raw `u64`, while `read.quote_deepbook_display_amount` marks the input as a source display amount converted to raw `u64`. Raw quote evidence is not an effective price, price-impact calculation, quote-vs-mid slippage calculation, venue comparison, best-route claim, fiat cash-out estimate, external market lookup, USDC/USD peg assumption, P&L, cost basis, final min-out, signing data, or signing readiness. The account-bound DeepBook review may derive a fresh raw quote policy from this evidence and use that derived policy for local unsigned transaction material build, while keeping bytes private to the backend until a scoped user selection admits a WalletConnect request for that reviewed revision. MCP and ordinary review-status outputs still do not contain transaction bytes, signing data, or signing readiness. When the digest commitment stage completes, it is derived from the locally stored transaction bytes through pinned SDK `Transaction.from(...).getDigest()` and remains an internal binding, not a public signing artifact.

## Runtime Boundary

- JSON-RPC client imports are not used.
- Sui gRPC and GraphQL endpoints are resolved from local SQLite settings by default. `SUI_GRPC_URL` and `SUI_GRAPHQL_URL` are advanced temporary overrides and do not mutate stored settings.
- Sui gRPC URLs must include an explicit port and no credentials, path, query string, or fragment.
- Sui GraphQL URLs must use `https` and must not include credentials, query string, or fragment.
- The gRPC endpoint is verified during runtime startup. The GraphQL endpoint is verified when saved, imported, or first used by Sui activity tools.
- `fetchedAt` fields are ISO 8601 UTC strings produced by `new Date().toISOString()`.
- Read-only tools may inspect mainnet state but must not create signable transaction material.

## WalletConnect and signature verification

The owner initializes pinned SignClient with its public `storage` injection,
private session persistence, silent SDK logging and telemetry disabled. It uses
`connect`, `session.get`, `session_update/session_delete/session_expire` events,
and `request` on chain `sui:mainnet`, method `sui_signTransaction`.
Pinned `session_event` does not update approved namespaces itself: account/chain
selection events explicitly invalidate stored review/submission authority even
when the approved account set stays unchanged. Requests carry
`{ transaction: <stored BCS base64>, address }`; responses require
`{ transactionBytes: <BCS base64>, signature }`. No SDK source patch or automatic
sign-and-execute fallback is used.

The backend reconstructs the returned transaction with `Transaction.from`,
recomputes its digest and calls pinned `verifyTransactionSignature` with the
admitted address and verified Sui client (including schemes requiring online
verification). Submission uses `client.core.executeTransaction` exactly once
per admitted attempt. `waitForTransaction` supplies separately verified chain
facts; its absence/timeout does not prove execution failure.

SDK session storage persists only the pinned connection namespaces. History,
requests and unknown queue keys are volatile. The SDK has no supported complete
in-process disposal; its owner process lifetime bounds callbacks and storage.
Actual target-wallet acceptance of the serialization is an integration
requirement, not something inferred from these SDK APIs or a rejected request.
