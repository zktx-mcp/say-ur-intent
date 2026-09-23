# MCP Tools

Say Ur Intent tools are grouped by authority.

This document is the MCP API reference. It owns tool contracts, response fields, statuses, follow-up fields, and output boundaries.

It does not own installation steps or user-question playbooks. Installation and client setup live in `docs/MCP_SETUP.md`. User-question flows and response wording live in `docs/AGENT_BEHAVIOR.md`.

Tool names use dot prefixes and avoid arbitrary shell, arbitrary Move calls, and private-key handling.

## Read-Only Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `read.get_server_status` | Implemented | Returns package, version, evidence policy, network, runtime, `implementedToolsCount`, resources, prompts, and tool implementation status. |
| `read.list_supported_protocols` | Implemented | Lists current mainnet protocol surfaces and support levels. |
| `read.list_deepbook_pools` | Implemented | Lists DeepBook mainnet pools from pinned `@mysten/deepbook-v3` constants. |
| `read.list_deepbook_tokens` | Implemented | Lists DeepBook mainnet tokens from pinned `@mysten/deepbook-v3` constants. |
| `read.inspect_deepbook_orderbook` | Implemented | Uses pinned DeepBook SDK read methods over Sui gRPC simulation reads with an internal sender placeholder; `ticks` is capped at 50. |
| `read.get_deepbook_mid_price` | Implemented | Returns a DeepBook pool mid price snapshot from pinned SDK simulation reads. |
| `read.get_deepbook_usdc_price_history` | Implemented | Returns DeepBookV3 official Indexer USDC candle evidence for a requested official interval. |
| `read.get_deepbook_usdc_price_at_time` | Implemented | Returns the DeepBookV3 official Indexer USDC candle for or nearest to one target UTC time. |
| `read.quote_deepbook_action` | Implemented | Quotes raw integer DeepBook quantities through pinned SDK transaction builders and raw `u64` simulation return values with an internal sender placeholder. |
| `read.quote_deepbook_display_amount` | Implemented | Converts an explicit display source amount through pinned DeepBook token units, then returns scoped display quote facts plus raw quote evidence. |
| `read.list_flowx_pools` | Implemented | Lists pinned FlowX CLMM mainnet pools for supported pairs from the chain-verified pinned registry. |
| `read.quote_flowx_swap` | Implemented | Returns an indicative FlowX route quote for an explicit display source amount; the router-selected pool is reported as evidence and validated against the pinned registry. |
| `read.summarize_deepbook_account_inventory` | Implemented | Summarizes active-account DeepBook BalanceManager inventory through pinned SDK simulation reads. |
| `read.summarize_wallet_assets` | Implemented | Reads coin balances for an explicit address or the active account through Sui gRPC `client.core.listBalances`; accepts `cursor` for pagination. |
| `read.classify_wallet_assets` | Implemented | Classifies coin balances for an explicit address or the active account by balanceStatus and coin-balance roles; accepts `cursor` for pagination. |
| `read.list_settlement_asset_groups` | Implemented | Lists supported settlement asset groups derived from pinned mainnet SDK registries. |
| `read.summarize_settlement_asset_group_parity` | Implemented | Summarizes direct DeepBook mid-price parity across a supported settlement asset group against a declared measurement reference. |
| `read.preview_intent_evidence` | Implemented | Builds current wallet and DeepBook evidence for a natural-language settlement intent; not transaction building or signing. |
| `read.list_review_activity` | Implemented | Lists local Say Ur Intent review evidence for one account. |
| `read.summarize_review_funnel` | Implemented | Summarizes local review lifecycle counts, status distribution, and review timing. |
| `read.get_review_session_detail` | Implemented | Returns stored local evidence for one Say Ur Intent review session. |
| `read.inspect_sui_transaction` | Implemented | Looks up one Sui transaction digest and stores normalized facts only when the transaction sender or a returned balance-change owner matches a known local wallet. |
| `read.scan_sui_account_activity` | Implemented | Runs a bounded GraphQL activity scan for a known or explicit Sui account. |
| `read.summarize_sui_activity_scan` | Implemented | Runs a bounded Sui activity scan and returns requested-account facts plus deterministic normalized-fact analysis without full details. |
| `read.scan_sui_function_activity` | Implemented | Runs a bounded GraphQL scan for transactions the account sent that called one full `package::module::function`. |
| `read.summarize_sui_function_activity_scan` | Implemented | Runs the sent-function activity scan and returns requested-account facts plus deterministic normalized-fact analysis without full details. |
| `read.summarize_sui_account_activity` | Implemented | Summarizes stored normalized Sui activity facts from local SQLite. |
| `read.get_account_asset_timeline` | Implemented | Builds stored local account asset net-flow bars from normalized activity facts and optional DeepBook USDC token-denominated candle references. Not held balances or complete wallet history. |

Read-only tools split by address requirement.

Address-free reads do not need wallet identity. Examples include DeepBook pool lists, orderbook snapshots, mid price, and quote facts.

Address-scoped reads need either an explicit public Sui address supplied by the user or active account context from wallet identity.

An explicit public-address read does not prove ownership, create active account context, or authorize active-account-only tools.

Live read results include `fetchedAt` as an ISO 8601 UTC string. `fetchedAt` is a timestamp, not a freshness verdict.

## API Response Guidance

High-risk read, review, wallet identity, and execution-status responses include `userAnswerUse` when the response needs answer guidance.

USD-denominated settlement-asset responses also include `toolAvailability`.
This object repeats the current package version, evidence policy version, network, implemented tool count, and required tool availability for that response.
If `toolAvailability.requiredToolsAvailable` is `false`, do not answer the user's USD-denominated question from that response.

Use these fields before relying on prose in this document:

- `userAnswerUse.canAnswer`: question categories this one response can support.
- `userAnswerUse.cannotAnswer`: conclusions this one response does not support.
- `userAnswerUse.answerFields`: fields to use in the user-facing answer.
- `userAnswerUse.preconditionFields`: fields to check before using answer fields.
- `userAnswerUse.conclusionRuleFields`: fields that limit what the final conclusion may claim.
- `userAnswerUse.diagnosticOnlyFields`: fields for source, troubleshooting, pagination, or limitation context.
- `userAnswerUse.followUp.tool`: exact next tool when the current response is not enough.
- `userAnswerUse.followUp.inputFields`: current-response fields to pass into the follow-up tool, when the response provides them.
- `userAnswerUse.followUp.answerFields`: fields to use in the follow-up response.
- `toolAvailability.requiredTools`: tools the current response depends on for this answer class.
- `toolAvailability.requiredToolsAvailable`: whether the current server build exposes those required tools.

`quantitySemantics`, raw evidence, source fields, and protocol facts remain in the response. `userAnswerUse` does not replace them; it tells the client which returned fields belong in the answer.

DeepBook raw quote inputs use raw integer quantities as expected by the pinned SDK.

DeepBook display quote inputs are source-side display amounts. They are converted to raw integers only through pinned DeepBook token units.

DeepBook read outputs include `source.simulation: "client.core.simulateTransaction"` because the pinned SDK uses transaction simulation for these read queries.

DeepBook pool and token lists are static pinned SDK registries.

They are not live liquidity, live token discovery, or a complete list of Sui tokens.

Token list entries are keyed by SDK symbol and include the pool keys that reference that token in `mainnetPools`.

Token entries include `decimals` derived only from pinned `mainnetCoins.scalar` when every scalar is a power of ten. If that invariant fails, the token registry tool fails closed instead of guessing.

`read.get_deepbook_mid_price` returns `priceDirection: "quote_per_base"`, so a `SUI_USDC` result is USDC per SUI.

The price is the pinned SDK `midPrice` result with `source.precision: "deepbook_v3_to_fixed_9_js_number"`.

The response includes `priceSemantics` and `userAnswerUse.cannotAnswer` for unsupported conclusions. It is a DeepBook pool snapshot, not a global market price, fiat USD cash-out estimate, external market-price conversion, USDC/USD peg assumption, quote-vs-mid slippage calculation, effective quote price, price-impact calculation, venue comparison, best-route claim, route recommendation, transaction-building input, signing data, signing readiness, P&L, or cost basis.

If the SDK returns a non-positive or non-finite mid price, both `read.get_deepbook_mid_price` and `read.inspect_deepbook_orderbook` fail closed with `quote_unavailable`.

`read.get_deepbook_usdc_price_history` returns DeepBookV3 official Indexer USDC candle evidence for a requested official interval.

Inputs require `start` and `end` as canonical ISO 8601 UTC timestamps and exactly one selector: `poolName`, `assetSymbol`, or `coinType`. Optional `interval` accepts only official Indexer interval values and defaults to `15m`.

The requested range is capped at `requested.range.maxBars: 1008` candle slots for the selected interval. Larger requests return `status: "unsupported_range"` with `reason: "requested_range_exceeds_max_bars"`.

Supported successful responses return:

- `status: "ok"`;
- `pair` with the official pool name, pool id, base asset, canonical USDC quote asset, and `priceConvention: "USDC_PER_BASE"`;
- `requested.range.interval`, `requested.range.intervalDurationMs`, and `requested.range.requestedCandleSlots`;
- `bars`, where each returned candle has `timestampMs`, `start`, `end`, `open`, `high`, `low`, `close`, and `volume`;
- `candleAvailability`, which can be `available` or `no_candles_in_range`;
- `source.poolList` and `source.candles`;
- `quantitySemantics`, `responseSummary`, and `unsupportedClaims`.

Candles are returned by the DeepBookV3 official Indexer for the requested interval. The tool does not synthesize candles, interpolate, carry forward a previous candle, call the browser, use a local price database, or fall back to an on-demand chain-history scan.

`status: "unsupported_pair"` means the selector did not resolve to exactly one official USDC-quoted pool. `status: "source_unavailable"` means the official pool list or candle response was unavailable or failed validation.

`quantitySemantics.kind: "deepbook_official_indexer_candles"` and `quantitySemantics.allowedUse: "official_deepbook_usdc_candle_history"` mean this output is candle evidence only.

`source.kind: "deepbook_v3_official_indexer"` and `source.chainRecomputedBySayUrIntent: false` mean Say Ur Intent read official Indexer candles and did not independently recompute candle values from chain history for this response.

USDC in this tool is the token-denominated quote asset for the returned official DeepBookV3 Indexer candles. It is not fiat USD and not a USDC/USD peg guarantee.

This output is not a live quote, execution price, historical mid price, global market price, fiat USD cash-out estimate, external market-price conversion, USDC/USD peg assumption, route recommendation, best route, transaction-building input, signing data, signing readiness, P&L, tax evidence, cost basis, user-account transaction history, or user-account balance history.

`read.get_deepbook_usdc_price_at_time` uses the same official Indexer candle source and selector rules, but accepts one `targetTime` instead of a range. Optional `interval` defaults to `15m`. Optional `maxDistanceMinutes` limits how far from the target time the tool may select a candle.

Successful at-time responses return:

- `status: "ok"`;
- `target`, including `targetTime` and the UTC search window;
- `match.kind`, which can be `exact_bucket`, `nearest_before`, or `nearest_after`;
- `match.distanceMinutes`;
- `match.representativePrice`, whose `field` is `matchedCandle.close`;
- `matchedCandle`, an official Indexer candle;
- the same `pair`, `candleAvailability`, `source`, `quantitySemantics`, `responseSummary`, and `unsupportedClaims` boundaries as the range-history tool.

`status: "no_price_in_search_window"` means no official Indexer candle was available inside the bounded search window. The tool does not synthesize a price, interpolate, carry forward a previous candle outside the search window, or perform an on-demand chain-history scan.

Internal read cards are opened with `ui.open_account`, `ui.open_receipt`, and `ui.open_chart`. They require a client that provides MCP Apps. A client without that UI receives `ui_unavailable`; ordinary MCP read tools remain available.

| Tool | Input and result |
| --- | --- |
| `ui.open_account` | Optional Sui address; otherwise use active read context or present an address input. Shows SuiNS, coins, Display NFTs, object groups, fetched time and truncation limits. |
| `ui.open_receipt` | Optional transaction digest. Shows server-read execution facts, gas, balance changes, objects, inputs, events and the PTB graph. No wallet or active account is needed. |
| `ui.open_chart` | Optional `poolName`, official Indexer interval, UTC `startTimeMs`/`endTimeMs`, and candle `limit`. Shows one selected USDC pool as candlesticks and volume. Range shortcuts fill these query fields. The initial time axis uses the saved request boundaries, with price-free whitespace at boundaries without candles; omitted boundaries use the returned data. |

The creating response contains a `cardId`, `kind`, `state`, `revision`, timestamps, original `input`, and available `data`. `inputRemainingMs` is computed by the backend; `pollAfterMs` controls sequential observation of a running read. Card `ready` permits a read selection, not signing or payment readiness. An initial supplied input uses the same admission path as a form submission. DB states are `ready`, `running`, and `closed`, with terminal reasons `completed`, `expired`, `failed`, or `server_restarted`.

When Chart pool choices cannot be prepared, the backend creates a `closed`/`failed` card with a readable error. No selection is admitted and no candles are requested. Reading that card again returns the stored failure; retrying the source requires an explicit request for a new card. A database access or write failure is a tool error, not a successfully stored failure card.

`ui.read_card` and `ui.submit_card` are app-only operations. Permission travels in UI metadata and is absent from model content and public saved resources. Input submission carries card ID, permission, expected revision and typed input. There is no first-view ownership or open/close operation. Recreated frames and chat returns read the same DB record. Identical duplicate input returns the stored request; conflicting input returns `card_conflict` and the authenticated current snapshot in error details. Invalid input returns `invalid_card_input` without consuming a valid selection. Invalid permission exposes neither current state nor private display data.

Receipt model results retain input kinds/indices/object references and identify input values and PTB as UI-only details. The typed `say-ur-intent/receipt-display` metadata binds display data to the same card ID, transaction digest and revision. It carries individual on-chain Pure input values and the graph derived from those inputs; never a serialized transaction, signature or wallet credential. Public saved resources contain only the model projection. A missing UI detail payload means unavailable display data, not that a transaction had no inputs.

Backend expiry ends unsubmitted input. A server restart invalidates unfinished cards; stored completed results remain readable. Reset/import removes cards and their permissions with the data change. Completed input does not reopen, while still-valid unsubmitted input is unaffected by chat navigation. A lost submit response is resolved by reading the same card, without another source request.

A frame with valid UI permission confirms the current DB state even if its initial snapshot cannot be displayed. A display error does not change the stored state, repeat a submission, or start another source query. Required expiry and running-state observations still follow the backend hints. If a state read fails, automatic observation stops and the user can explicitly read the same saved state. A completed result that cannot be displayed remains stored; reopening the same card reads that stored result rather than requesting new data.

Cards provide no clipboard actions or copy buttons. Their text remains readable and selectable. Chart values remain USDC-denominated source candles, not fiat USD, peg guarantees, route advice, portfolio valuation or P&L. Cards do not fetch chain/Indexer endpoints directly or poll completed results.


`read.quote_deepbook_action` and `read.quote_deepbook_display_amount` use the pinned DeepBook transaction builder quote functions.

Input kinds:

- `read.quote_deepbook_action`: `quantitySemantics.inputAmountKind: "raw_u64"`.
- `read.quote_deepbook_display_amount`: `inputAmountKind: "display_source_amount_converted_to_raw_u64"`.

Quote responses include `quantitySemantics` before the public quote values. The same response also includes `userAnswerUse.cannotAnswer` for unsupported conclusions such as payment coverage, shortfall contribution, route-dependent payment support, fiat USD cash-out, external market conversion or lookup, USDC/USD peg assumptions, P&L, cost basis, price impact, mid-price slippage, venue comparison, and route recommendation.

`canUseForPaymentAnswer: false`, `canUseForShortfallAnswer: false`, `doNotCombineWithPaymentAnswer: true`, and `paymentAnswerUseBlockedReason` mean quote output is a price estimate only. Do not add it to the payment amount, coverage status, or shortfall amount in a user answer.

`requiredPaymentAnswerTool: "read.preview_intent_evidence"` and `requiredPaymentAnswerField: "responseSummary"` identify the tool and field to use for payment amount and shortfall answers.

The same response-local rule is also exposed as `userAnswerUse.followUp.tool: "read.preview_intent_evidence"` and `userAnswerUse.followUp.answerFields: ["responseSummary"]`.

Raw quote source:

- `rawQuote.sourceMoveFunction` is `pool::get_quote_quantity_out` for `base_to_quote`.
- `rawQuote.sourceMoveFunction` is `pool::get_base_quantity_out` for `quote_to_base`.
- Both entrypoints delegate to `rawQuote.returnValueSourceMoveFunction: "pool::get_quantity_out"`.
- The official Move source defines return values in this order: `base_quantity_out`, `quote_quantity_out`, `deep_quantity_required`.

Returned raw fields are quote evidence only. They are not final min-out values, effective prices, price-impact calculations, venue comparisons, best-route claims, transaction-building inputs, signing data, or signing readiness.

`read.quote_deepbook_display_amount` accepts `amountDisplay` as the source coin input amount for the requested `direction`.

It does not accept output target amounts or inverse quote requests.

The tool:

- resolves the input coin from the pinned DeepBook pool;
- derives decimals from pinned `mainnetCoins.scalar` through the shared scalar invariant;
- converts to a positive raw input amount that fits the SDK `u64` quote input;
- reuses the raw DeepBook quote path.

The exact converted input is returned as `inputAmount.raw`.

The public `quote` contains exact decimal display strings for `baseOut`, `quoteOut`, and `deepRequired`. They are derived from raw `u64` return values through pinned DeepBook scalars.

Returned `quantitySemantics.kind: "deepbook_quote_display_amount"` means those display fields are presentation quote facts only.

They are not raw output amounts, min-out values, liquidity verdicts, route recommendations, venue comparisons, best-route claims, effective prices, price-impact calculations, mid-price slippage calculations, funding sources, fiat USD cash-out estimates, external market-price conversions, external market lookups, USDC/USD peg assumptions, P&L, cost basis, transaction-building inputs, signing data, or signing readiness.

This quote is not a settlement asset choice.

### FlowX read tools

`read.list_flowx_pools` lists the pinned FlowX CLMM mainnet pool registry: every pool for each supported pair, one per fee tier, without ranking. The pins were read from Sui mainnet directly (package introspection, the shared `PoolRegistry` object, and its dynamic fields) and `scripts/generate-flowx-registry.ts` re-verifies them against the chain; verification failure stops the generator instead of rewriting pins. The list is static known metadata, not live liquidity, a pool ranking, or route advice.

`read.quote_flowx_swap` accepts `sourceSymbol`, `targetSymbol`, and `amountDisplay`, converts the display amount through pinned decimals, and requests a quote from the FlowX aggregator quoter restricted to FlowX CLMM single-hop routes.

The route is chosen by the FlowX router, not by this server. The response reports that choice as evidence: `routeEvidence.routeChosenBy: "flowx_router_not_this_server"` and `routeEvidence.pools` name the router-selected pool.

Every quote fails closed unless all of the following hold:

- every route hop source is FlowX CLMM;
- the route is single-hop;
- the selected pool is present in the pinned registry with the same fee rate;
- the route direction agrees with the pinned pair orientation;
- the echoed input amount equals the requested raw amount;
- the protocol config carried by the quoter response matches the pinned package and object ids (`protocolConfigPinMatch: true`).

`source.chainVerified: false` and `quantitySemantics.chainVerified: false` state that this quote comes from the FlowX quoter API over HTTPS, not from a chain read. `amountOut.indicative: true` marks the output as an indicative estimate. Signable FlowX review re-verifies the quote through review-time simulation before the account-bound review reaches `ready_for_wallet_review`.

The same payment-answer blocks as the DeepBook quotes apply: `canUseForPaymentAnswer: false`, `doNotCombineWithPaymentAnswer: true`, and `read.preview_intent_evidence` `responseSummary` stays the only payment-coverage answer source.

`read.summarize_deepbook_account_inventory` uses active account context to discover DeepBook BalanceManager addresses.

With both `poolKey` and `managerAddress`, it checks pool account existence and returns display-like account inventory:

- selected account ledger balances;
- locked balances;
- capped open order IDs.

Detailed inventory fields are answer evidence only when the same response has `detailStatus: "available"` and `userAnswerUse.canAnswer` includes `deepbook_pool_account_inventory_when_pool_and_manager_are_supplied`.

When `detailStatus` is `manager_discovery_only`, `pool_key_required`, `manager_address_required`, `manager_address_not_discovered_for_active_account`, or `account_not_found`, use `detailStatus`, `managerAddresses`, `requested`, and `accountExists` when present. Those responses do not provide detailed inventory values such as `accountSummary`, `lockedBalances`, `openOrderIds`, or `openOrderCount`.

`accountSummary.*Balances` are BalanceManager ledger and rebate balances. `lockedBalances` are balances tied to open orders in the pool.

The response includes `openOrderCount` and `openOrderIdsTruncated` because returned `openOrderIds` are capped.

The tool uses `managerAddress` as the public input and registers it as an ephemeral pinned-SDK BalanceManager key internally.

Returned `quantitySemantics.kind: "deepbook_display_number"` means these `number` fields are presentation inventory facts only.

They are not raw balances, route liquidity, funding sources, withdrawal readiness, transaction-building inputs, signing data, or signing readiness.

`read.summarize_wallet_assets` accepts an optional `account` input for public-address coin balance snapshots.

When `account` is omitted, it uses the active account read context and returns `active_account_not_set` if no active account is set.

An explicit `account` read does not prove ownership, store the address as a known wallet, or create active account context.

The response includes `quantitySemantics.kind: "sui_wallet_balance_snapshot"`.

It marks transaction history, transaction receipt proof, transaction balance deltas, acquisition source, object provenance, fiat cash-out, P&L, and cost basis as not available.

Current balances can confirm only a current coin-balance snapshot. They cannot prove that a specific digest delivered that amount or that a still-held coin came from a specific transaction.

Raw balance fields remain the pinned Sui SDK integer strings from `client.core.listBalances`.

Each balance also includes `unit`; when verified decimals are available it includes `display.amount` as presentation-only decimal text.

Display conversion uses `client.core.getCoinMetadata` and a 24 hour local metadata cache keyed by normalized coin type plus verified mainnet chain identifier.

If local metadata cache read or write fails, wallet unit reads fail with `metadata_cache_unavailable` instead of guessing or treating the unit as unavailable.

If Sui metadata is unavailable, DeepBook-registered tokens can use pinned scalar fallback.

If no verified decimals exist, `unit.status` is `unavailable` and clients must not infer decimals from the token symbol.

`read.classify_wallet_assets` reuses the same explicit-address or active-account balance, unit, display, metadata cache behavior, and wallet snapshot quantity semantics as `read.summarize_wallet_assets`.

It wraps each coin balance in `classification.assetClass: "coin_balance"`, `classification.balanceStatus`, and role labels such as `gas_candidate` or `deepbook_registered`.

It also returns `uninspectedAssetClasses` for staked or locked assets, DeepBook BalanceManager or open orders, LP or vault positions, and NFT or object assets.

These entries are explicit classifier-uninspected boundaries. They are not zero-balance claims and not spendable asset facts.

DeepBook account inventory is separate from coin-balance classification.

Inventory reporting for native staked SUI, locked or vesting assets, NFTs, generic objects, LP positions, or vault positions would not by itself make those assets funding sources.

It also would not make them route liquidity, payment readiness, portfolio completeness, transaction-building inputs, signing data, or signing readiness.

The classifier does not create funding plans, choose routes, create review sessions, return transaction bytes, or produce signing material.

`read.list_settlement_asset_groups` returns the supported natural-language settlement asset groups.

In this release, `SUI_USD_SETTLEMENT_ASSETS` maps aliases such as dollar, dollars, USD, USD-like, stablecoin, stablecoins, and Korean dollar-word wording.

The included USD-denominated assets must exist in the pinned `@mysten/deepbook-v3` mainnet token registry and be referenced by pinned DeepBook pools.

The asset group output includes included assets, excluded assets, source authority, and limitations.

This is static SDK registry evidence, not live liquidity, fiat USD support, payment execution, route recommendation, or signing readiness.

`read.summarize_settlement_asset_group_parity` returns internal parity evidence for a supported settlement asset group.

In this release it measures USD-denominated group assets against a declared reference asset. The default reference is USDC, but only as `measurement_reference_not_settlement_choice`.

The response includes:

- each inspected group asset;
- direct DeepBook pool evidence when available;
- `priceInReferenceAsset` as reference asset per group asset;
- `responseSummary` with minimum, maximum, mean, and median;
- `referenceAssetRole: "measurement_reference_not_settlement_choice"`.

Use `responseSummary` for questions about internal USD-denominated parity, highest/lowest stablecoin-like asset, or max/min/mean parity evidence.

This tool is not settlement-token choice, fiat USD cash-out, external market lookup, USDC/USD peg assumption, payment readiness, best route, route recommendation, transaction building, signing readiness, P&L, or cost basis.

`read.preview_intent_evidence` accepts natural-language settlement evidence intents.

Use it this way:

- Coverage question: `intentKind: "cover_payment_like_amount"`, `denomination: "dollar"`, and `requiredDisplayAmount: "1000"`.
- AssetGroup-total question: `intentKind: "summarize_settlement_asset_group_balance"` and `denomination: "dollar"` without a target amount.
- Account scope: explicit public `account` or active account context.

For settlement-asset-only coverage, shortfall, and balance-total answers, use `responseSummary`.

The response also exposes `userAnswerUse.answerFields` with the response-specific answer path.

`responseSummary.answerCompleteness.answerCompleteFor` names the answer class. `responseSummary.answerCompleteness.requiredAnswerFields` names the fields required for that class. Do not call quote tools for the same question when `responseSummary.doNotCallQuoteToolsForThisQuestion` is `true`. If `toolAvailability.requiredToolsAvailable` is also `true`, answer from `responseSummary` and do not call `read.classify_wallet_assets`, `read.summarize_wallet_assets`, or quote tools to look for other source tokens for that same coverage, balance-total, or shortfall question. If quote tools were already called, do not use quote output for the payment amount, coverage status, or shortfall.

`responseSummary` exposes:

- `questionKind`;
- `conclusionKind`;
- `answerCompleteness`;
- `doNotCallQuoteToolsForThisQuestion`;
- `coverageBasis: "settlement_asset_wallet_balance_only"`;
- `assetGroupId`;
- current, required, and shortfall display amounts;
- `amountsUsedForAnswer`;
- `separateQuoteOutputs`;
- `requiredUserChoices`;
- `doNotUseForConclusion`;
- `excludedFromConclusion`.

For payment coverage and shortfall conclusions, use only fields named by `responseSummary.amountsUsedForAnswer`. Treat fields named by `responseSummary.doNotUseForConclusion` or `responseSummary.excludedFromConclusion`, including separate quote results and assets outside the settlement asset group, as non-conclusion context.

Selected-target evidence is available only when `targetAssetSymbol` is paired with one of these sources:

- `targetAssetSelectionSource: "user_explicit"`;
- `targetAssetSelectionSource: "prior_user_explicit_context"`.

`targetAssetSymbol` without `targetAssetSelectionSource` is invalid.

Clients must not set a selection source for an agent-inferred target.

When the response returns `responseEvidence.mode: "selected_target_context"`, answer from the fields listed in `userAnswerUse.answerFields`, including `responseSummary`, `selectedTarget`, `candidateConversions`, and `requiredUserChoices`. Do not treat `responseSummary` alone as the complete selected-target answer.

Direct pool quote evidence for a selected target is supported only when the same response returns `responseEvidence.supportedResponseClaims` with `direct_pool_quote_evidence` and `userAnswerUse.canAnswer` with `direct_pool_quote_evidence_for_user_selected_target`. If those entries are absent, use the selected-target shortfall and required-user-choice fields only; do not claim quote evidence is available from that response.

`acceptedSourceAssetSymbols` can include only assets inside the same supported settlement asset group. Separate quote tool results for SUI, WAL, RWA, or other non-group assets do not count as payment coverage or shortfall evidence.

This tool does not silently choose USDC, USDT, or any settlement token for the user. It uses selected-target evidence only when the response has explicit selection provenance. It does not rank venues, choose routes, evaluate gas reserve, create review sessions, return transaction bytes, produce signing material, estimate fiat USD cash-out, or compute P&L.

Gas reserve remains outside the current evidence boundary. `gas_reserve_not_evaluated` is an explicit non-evaluation marker, not gas readiness or a policy result.

Review activity tools read only local Say Ur Intent review evidence.

They are not complete wallet transaction history, gas history, P&L, or external wallet activity.

The optional `account` input is a read filter and does not change the active account context. If `account` is omitted, the tools use the active account context.

Successful review activity responses include `dataScope`, `accountSource`, `lowSampleWarning`, and `lowSampleThreshold`.

The current `lowSampleThreshold` is 5 local records, from `REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD`.

When `lowSampleWarning` is true, treat counts as sparse local evidence and avoid drawing behavior patterns.

For `read.list_review_activity`, `dataScope.recordCount` is the full matching local review count.

The returned `activities` array can be shorter when `truncated.activities: true`.

`accountSource` reports how the read scope was selected; it is not proof of wallet ownership.

MCP error responses intentionally omit `structuredContent`; clients should read the JSON error payload from `content[0].text`.

`read.get_review_session_detail` transition rows include `isNoOp`.

A no-op transition is an observed lifecycle call whose stored status did not change, such as a repeated open or reconnect event.

`read.get_review_session_detail.userAnswerUse.answerFields` lists `execution` only when the response includes an `execution` object. If `execution` is absent and `userAnswerUse.cannotAnswer` includes `stored_review_execution_result_without_execution_field`, the response cannot answer a stored execution-result question.

Funnel summaries count distinct reviews and do not treat repeated no-op rows as additional completed steps.

Sui activity tools are user-requested read surfaces, not a background indexer.

Summary activity tools omit full transaction details by design. Digest-level detail is exposed by `read.inspect_sui_transaction`.

Tool roles:

- `read.inspect_sui_transaction` performs a single digest lookup.
- `read.scan_sui_account_activity` requests up to 100 account transactions for `affected` or `sent` relationship.
- `read.summarize_sui_activity_scan` reuses the live scan path and adds deterministic `analysis` without returning full `details`.
- `read.scan_sui_function_activity` and `read.summarize_sui_function_activity_scan` return transactions the selected account sent that called one full `package::module::function`.
- `read.summarize_sui_account_activity` reads only local SQLite stored facts.

This is a bounded provider page, not complete wallet history.

Affected activity means the account appeared in returned transaction effects; it does not mean the account sent the transaction.

Live account scans use the pinned GraphQL `last`/`before` connection direction for recent-to-older pagination. Returned rows are ordered newest-first by returned checkpoint and timestamp facts.

Live scan and live-summary responses return `requestedAccountTransactionFacts`. This flattened requested-account row array pairs each digest with account-scoped fields and `requestedAccountEffect`. The response also returns `transactionDetailAvailability`, which counts returned `transactions` rows with and without source details. It includes `transactions[].transactionContext` in `userAnswerUse.answerFields` only when `transactionDetailAvailability.allReturnedTransactionsHaveDetails: true`.

`transactionContext` intentionally excludes transaction-wide balance-change aggregates.

Live scan and live-summary responses return `requestedAccountTransactionFacts` as an account-scoped row surface with `requestedAccountEffect`. When `transactionContext` is present, it omits transaction-wide balance-change aggregates.

Function activity boundaries:

- The filter uses only the verified `function + sentAddress` GraphQL combination.
- The `function` input must be exactly `package::module::function`.
- Package-only, `package::module`, generic, and type-argument suffix forms are unsupported.
- Function scans do not include recipient-only activity, affected-address-only activity, affected-object-only activity, global function history, or complete dApp history.
- Empty function activity results mean no matching rows were returned in the bounded page; they do not prove no matching activity exists.
- The internal `accepted_empty` classifier result is not user-facing tool output.

Stored summary boundaries:

- Stored summaries aggregate local account-level facts from digest lookups, account scans, or sent-function scans.
- Scan kind is internal provenance.
- Stored summary input does not accept `kind`, `function`, or function-history filters.
- Legacy `summary` is the backward-compatible shallow count block.
- `analysis.overview.transactionCount` mirrors the stored count.
- `analysis.overview.analyzedTransactionCount` reports how many returned rows fed the richer aggregations.
- `transactionDetailAvailability` counts returned stored rows with `details`. `userAnswerUse.answerFields` includes `transactions[].compact` and `transactions[].details` only when `transactionDetailAvailability.allReturnedTransactionsHaveDetails: true`.

Coverage and pagination boundaries:

- `orderingVerified: false` means the provider page was not monotonic by returned checkpoint or timestamp facts.
- Treat unverified ordering as unproven coverage.
- Checkpoint bounds are inclusive user bounds translated to the pinned GraphQL API's exclusive checkpoint filters.
- Timestamp bounds are page filters and coverage signals, not GraphQL provider filters.
- Continue with `continuationCursor` until `windowComplete` proves coverage or the provider cannot continue.
- Provider retention and rate-limit behavior are endpoint/operator properties, not Say Ur Intent guarantees.
- Empty pages, bounded pages, and stored local summaries are not complete wallet or dApp history.

Local persistence boundaries:

- The default account is the active account.
- An explicit account is allowed as a read filter.
- The local DB stores only normalized facts for transactions tied to a known account by returned sender or balance-change owner facts.
- Function activity scans store only sender-matching rows for known accounts.
- Provider-returned account scan rows that cannot prove the local relation can appear in the current response but are counted as skipped for storage.
- Function activity scans drop any provider row whose sender does not match the requested account before it reaches the tool `transactions` response.
- When a known-account scan is stored, dropped function rows are counted as skipped and are not stored as transaction facts.

Detail boundaries:

- Inspect responses can include live provider detail fields for the current response, including account addresses returned by GraphQL.
- Live scan, live-summary, function-scan, and function-summary rows expose `transactionContext` for transaction-level calls, objects, events, gas, errors, truncation, and protocol labels only when source details are present.
- Inspect and stored-summary rows can include `compact` when details are available.
- `userAnswerUse.answerFields` omits `transactionContext`, `compact`, `details`, and requested-account effect fields that are absent from the current response.
- For array paths such as `transactions[].transactionContext`, `transactions[].compact`, and `transactions[].details`, `userAnswerUse.answerFields` lists the path only when every returned `transactions` row has that field. If only some rows have details, use `transactionDetailAvailability` and inspect the specific rows or follow-up digest lookup instead.
- Compact balance changes can aggregate repeated ownerless raw changes with `count`.
- Compact balance changes are transaction-level facts, not requested-wallet balance evidence.
- `analysis.coinFlows` is a transaction/page aggregate, not wallet-specific evidence.

For wallet/account-specific balance answers, use requested-account fields:

- `requestedAccountTransactionFacts`;
- `requestedAccount.coinFlows`;
- `transactions[].requestedAccountEffect`.

These fields are raw integer facts scoped to the requested account.

Row-level `requestedAccountEffect.scope` is `requested_account`.

These requested-account fields summarize the requested account's evidence for that transaction:

- `requestedAccountEffect.role`;
- `requestedAccountEffect.balanceChangeEvidence`;
- `requestedAccountEffect.balanceChangeCompleteness`;
- `requestedAccountEffect.balanceChanges`;
- `requestedAccountEffect.accountBalanceChangeInferencePolicy`;
- `requestedAccountEffect.coinFlows`;
- `requestedAccountEffect.limitations`.

`requestedAccountEffect.limitations` is part of the requested-account evidence boundary.

Incomplete balance evidence means unknown, not zero:

- `accountBalanceChangeEvidence: "incomplete_account_balance_changes"` is not zero-balance evidence.
- `accountBalanceChangeEvidence: "account_balance_changes_unavailable"` is not zero-balance evidence.
- `accountBalanceChangeInferencePolicy: "do_not_infer_from_transaction_context"` means transaction-level context, compact counts, or visible recipient patterns must not be used to infer the requested account's amount.
- Only `no_account_balance_changes_returned` with complete details supports saying no requested-account balance change was returned.
- `no_account_balance_changes_returned` is complete evidence only when requested-account balance-change evidence is complete.
- If `requestedAccount.balanceChangeCompleteness` or a row-level `requestedAccountEffect.balanceChangeCompleteness` is `truncated` or `unavailable`, the account-specific balance-change evidence is incomplete.

`analysis` aggregates only normalized facts:

- raw integer coin flows;
- gas totals;
- Move call targets;
- object and event counts;
- failure details;
- protocol counts keyed by `protocolMatches[].protocolId`.

`protocolMatches` are derived from package, module, function, event, object, or shared-object evidence already present in normalized details.

Package-derived evidence can include `mvrName` and `packageSource` when a verified MVR current package resolution was used.

Protocol matches and analysis are not a supported-protocol list, wallet position inventory, P&L, route recommendation, transaction-building input, signing data, or signing readiness.

Stored summaries return sanitized normalized details and omit non-known party account addresses.

Stored transaction details can include capped Move call targets, raw coin balance changes, object changes, event summaries, gas cost facts, execution error facts, and truncation flags when GraphQL returns them.

Balance quantities use signed raw integer strings from returned `*Raw` fields, including:

- `details.balanceChanges[].amountRaw`;
- `requestedAccount.coinFlows[].*Raw`;
- `requestedAccountTransactionFacts[].accountBalanceChanges[].amountRaw`;
- `requestedAccountTransactionFacts[].requestedAccountEffect.balanceChanges[].amountRaw`;
- `transactions[].requestedAccountEffect.balanceChanges[].amountRaw`;
- `transactions[].requestedAccountEffect.coinFlows[].*Raw`.

`requestedAccountTransactionFacts[].requestedAccountEffect.balanceChanges[].amountRaw` is one of the requested-account raw amount fields.

There is no `details.balanceChanges[].amount` field.

`requestedAccountEffect.balanceChangeEvidence` and `balanceChangeCompleteness` describe the account-scoped rows and their completeness. The corresponding flat fields are `requestedAccountTransactionFacts[].accountBalanceChangeEvidence` and `accountBalanceChangeCompleteness`.

Complete details with no rows for the requested account produce `no_account_balance_changes_returned` and `accountBalanceChangeInferencePolicy: "no_account_balance_changes_in_complete_details"`. Complete details with returned rows produce `account_balance_changes_returned`, even if a returned row has `amountRaw: "0"`. Truncated details produce `incomplete_account_balance_changes`; missing details produce `account_balance_changes_unavailable`. Neither supports a conclusion that no account balance change was returned. Use the returned raw amount rows for quantities, not the evidence or completeness labels.

Gas raw values use MIST in fields such as:

- `details.gas.netGasCostRaw`;
- `requestedAccountTransactionFacts[].transactionContext.gasNetCostRaw`;
- `analysis.gas.netGasCostRaw`.

When `gasCost` or `analysis.gas.netGasCost` is present, its `display` field is the SUI display conversion using `@mysten/sui MIST_PER_SUI`.

Summary rows can include `lastScanIncompleteReason`. When it is present, treat the row as stored evidence from an incomplete or unverified scan before using it as behavioral evidence.

Unknown explicit accounts, unrelated digest lookups, rows outside the requested window, rows that fail sender checks, rows that fail local storage-relation checks, and dropped function rows are not stored as transaction facts.

The tools do not store raw GraphQL payloads, transaction bytes, signatures, BCS payloads, non-known party account addresses, P&L, route recommendations, or signing material.

do not treat `transaction.status: "unknown"` as a not-found signal.

Protocol matches are transaction activity labels only.

Transaction activity responses include `quantitySemantics`.

They also include `userAnswerUse`. For account-specific activity answers, start with `userAnswerUse.answerFields`; it points to requested-account fields before transaction-level context.

It marks balance `amountRaw`, `increaseRaw`, `decreaseRaw`, and `netRaw` fields as raw integer facts.

It also exposes `displayConversionRequires` and `display_conversion_without_verified_decimals` boundaries for token display conversion.

Do not convert raw token amounts into display units unless the response includes verified decimals or a display amount for that asset.

Gas is the one built-in exception. `gasCost.display` and `analysis.gas.netGasCost.display`, when present, are returned SUI display facts from the pinned Sui MIST conversion.

If only raw token facts are available, answer token amounts in raw units.

For function scans, the GraphQL `sentAddress` filter is expected to return only sender-matching rows for the requested account.

The local sender check is defensive. A non-conforming provider row is dropped from the tool response before storage selection.

For a stored known-account scan, the dropped row contributes only to skipped counts. It is not treated as valid function history.

`read.scan_sui_account_activity` and `read.scan_sui_function_activity` return pagination and coverage fields:

- `hasMore`;
- `continuationCursor`;
- `windowComplete`;
- `orderingVerified`;
- optional `incompleteReason`.

`windowComplete: null` means the user asked for the latest N results without a lower bound.

`windowComplete: true` means the requested lower checkpoint or timestamp was reached, or the provider reported no more matching transactions.

`windowComplete: false` means coverage could not be proven.

Provider cursors are opaque and best-effort. Cursor rejection returns a safe error and does not create a complete-history claim.

Tool source comparison:

- `read.scan_sui_account_activity`, `read.scan_sui_function_activity`, `read.summarize_sui_activity_scan`, and `read.summarize_sui_function_activity_scan` return live GraphQL row facts.
- Those live rows include requested-account fields, transaction context, and `detailLookup` references but no full `details`.
- The summary tools also return deterministic `analysis`.
- `read.inspect_sui_transaction` is the full normalized detail path for a specific digest.
- `read.summarize_sui_account_activity` reads only stored normalized facts from local SQLite.
- `read.get_account_asset_timeline` reads only stored normalized facts from local SQLite, then can attach DeepBookV3 official Indexer USDC candle references for supported USDC-quoted assets.

If stored or summary details are missing or capped, use the digest metadata with `read.inspect_sui_transaction` instead of inferring missing calls, balances, objects, events, gas, or errors.

### Stored Account Asset Timeline

`read.get_account_asset_timeline` returns a stored local account asset-flow timeline for one account and UTC range.

Inputs:

- `account` is optional. If omitted, the tool uses active account context. Supplying an explicit public account does not create active account context or prove ownership.
- `start` and `end` are ISO 8601 UTC timestamps. The requested range is half-open: `start` is included and `end` is excluded.
- `interval` is optional and uses the same official Indexer interval values as DeepBook USDC price tools. Omitted `interval` uses `15m`.

Output fields:

- `coverage` describes whether stored scan rows prove the requested range is complete, partial, or absent.
- `status: "account_not_known"` means the explicit account is not a known local wallet in the local activity store. In that status the tool does not return `scanNeeded`.
- `scanNeeded`, when present, names `read.scan_sui_account_activity` as the bounded scan tool that can gather local evidence for a known account.
- `netFlowBars` are observed account-scoped raw token balance-change bars from stored normalized activity rows.
- `balanceStatus` is currently `unavailable_no_balance_anchor`, and `balanceBars` is empty. Do not present net-flow bars as held balances.
- `sourceTransactions` reports how many stored rows were read, returned, truncated, and detail-covered.
- `quantitySemantics` marks raw integer net-flow fields and unsupported uses.
- `usdcReferences` can attach DeepBookV3 official Indexer USDC token-denominated candle references for supported USDC-quoted assets. These references are not fiat USD value, not a USDC/USD peg guarantee, not P&L, not cost basis, not route advice, and not signing readiness.

This tool does not run scans, start a background indexer, create a price cache, prove complete wallet history, compute held balances, calculate portfolio value, compute P&L, compute tax, compute cost basis, recommend routes, build transactions, return signing data, or provide signing readiness.


## Action Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `action.prepare_sui_action_review` | Signable local review page | Creates a local review session and review URL for a supported swap action proposal. Account-bound DeepBook and FlowX reviews may build local unsigned transaction material inside the review server, internally bind a Sui transaction digest to it, and derive object ownership, quote/policy, human-readable review, review-time simulation, and PTB visualization evidence. When every required evidence stage completes, the local review page can request the digest-gated byte handoff for user-controlled wallet signing. The MCP tool does not return transaction bytes, signing data, or signing readiness. |
| `action.prepare_external_proposal_review` | Non-signable review | Creates a local review session and review URL from an untrusted structured external proposal. It does not return transaction bytes. |

`action.prepare_sui_action_review` is account-bound: a swap review computes
its evidence (balances, transaction material, digest, simulation) for a
specific sender, so the tool requires an active wallet account. Connect first
with `session.create_wallet_identity`; with no active account the tool returns
`active_account_not_set` with `details.action: "connect_wallet_identity"`
instead of creating a proposal that can never be computed or signed. The
review page reads that account from the server as the single source of truth
and never connects a wallet itself.

`action.prepare_sui_action_review` accepts a protocol-neutral swap `intent`
(`type: "swap"`, `from.symbol`, `from.amount`, `to.symbol`,
`maxSlippageBps`, optional `protocol`). The optional `protocol` field carries
the protocol slug from the adapter registry (the same slug vocabulary as the
prompt surfaces). With a single registered protocol for the action it may be
omitted; once several protocols support the same action the tool returns
`input_invalid` with `reason: "protocol_choice_required"` and
`availableProtocols`, and the caller must ask the user and retry with
`intent.protocol` set - the server never picks a venue silently. An unknown
slug returns `reason: "unknown_protocol"` with the available slugs.

`action.prepare_external_proposal_review` accepts `proposal` with `type:
"payment"` or `type: "sui_action"`.

Common required fields are `id`, `source`, `network: "sui:mainnet"`,
`createdAt`, and `purpose`. `expiresAt`, `assumptions`, and
`requiredUserChoices` are optional.

Payment proposals include `payment.amount`, `payment.recipient`, and optional
`payment.target`.

Sui action proposals include `action.actionKind`, `action.target`, optional
`action.recipient`, and optional `action.assetFlow` entries.

Proposal amount fields use `amountDisplay` and `amountKind:
"display_proposal"`. `amountDisplay` must be positive decimal display text such
as `100`, `100.25`, or `0.5`. Signs, commas, exponent notation, unit labels,
prose, and zero values are rejected. These fields are display proposal facts
only. They are not raw amounts or minimum outputs. They are not
transaction-building inputs. They are not signing data or signing readiness.

The external proposal schema is strict. Fields outside the contract, including
executable material such as transaction bytes, serialized transactions, signing
requests, private-key material, signatures, seeds, mnemonics, or a
route-selected plan, are rejected rather than stored as review authority.
Allowed text fields are also length-bounded and rejected when they contain
executable-material terms, private-key terms, signing-request terms,
route-selected-plan terms, recognized Sui private-key strings, valid English
BIP39 mnemonic phrases, long encoded payloads, or raw secret-like hex/base64
payloads in fields that are not Sui identifier fields.

Successful responses return `plans[].reviewModel`.

Use these `reviewModel` fields for the proposal review answer:

- `proposedAction`: what the external proposal asks to do;
- `assetFlow`: outgoing, expected incoming, and fee display proposal facts;
- `recipients` and `targets`: recipient or action target facts supplied by the
  proposal;
- `evidenceUsed`: local schema and proposal facts used for the review;
- `missingEvidence`: wallet, recipient, target, simulation, or adapter evidence
  not verified;
- `requiredUserChoices`: choices that remain with the user;
- `unsupportedClaims`: conclusions the review does not support;
- `freshness`: timestamp status for the proposal;
- `blockingChecks`: checks that keep the review blocked or warning-only;
- `nonSignableReason`: why the review has no sign action.

Account-bound review computation for external proposals returns `blocked` with
`blockedReason: "proposal_review_only"`. This means the local review layer
recorded the proposal facts but did not build, regenerate, simulate, or verify
transaction material.

When every review evidence stage completes, a supported account-bound DeepBook
or FlowX swap review reaches `ready_for_wallet_review` and the local review
page offers a digest-gated byte handoff, user-controlled wallet signing, and
signed-digest reporting. After the page reports the signed transaction digest,
the review server re-reads Sui mainnet and records normalized chain receipt
evidence. The local review page shows server-read chain receipt facts inline,
and a internal Receipt card reads on-chain receipt facts for any
transaction digest; both display server-read receipt facts only, not transaction
bytes or MCP execution authority.

The MCP layer never signs, executes, or returns transaction bytes; the
digest-verified bytes stay in the local review-server session and reach the
user's wallet only on the page.

After the wallet account is bound to a supported swap review session, the
review page and `session.get_review_status` may show protocol-specific quote
evidence and review-state checks for:

- resolved DeepBook direct pool or FlowX pinned pair;
- raw quote evidence;
- quote freshness;
- derived raw min-out policy;
- protocol fee evidence, such as DeepBook DEEP fee evidence or FlowX pool-fee
  evidence reflected in the quoted output;
- local unsigned transaction material build when that stage completes;
- an internal Sui transaction digest commitment bound to the stored local material when that stage completes;
- object ownership evidence derived from stored local material and Sui owner/type reads when that stage completes.
- human-readable review facts derived from the material-bound quote policy,
  object ownership evidence, and internal digest binding when that stage
  completes.
- review-time simulation evidence derived from simulating the stored local
  unsigned transaction material with validation checks enabled when that stage
  completes.

When those account-bound review stages run, `reviewState.adapterLifecycle` may
list `stageCatalogId`, `completedStages`, and `missingStages` for the
adapter-owned DeepBook or FlowX lifecycle. `stageCatalogId` identifies the
adapter-owned stage catalog; it is not a core lifecycle enum shared by every
protocol adapter.
Completed stages are review progress only. If
`transaction_material_build_or_verify` is completed, it means the local review
server built unsigned transaction material and kept the bytes internal. If
`digest_commitment` is completed, it means the server internally derived a Sui
transaction digest from that stored material; the digest value and transaction
bytes are not MCP or review-app outputs. Missing stages explain why the review
remains blocked. This lifecycle covers review evidence producer stages through
review-time simulation. Wallet handoff, wallet signing, signed-digest
reporting, and server-read chain receipt recording are not adapter lifecycle
stages; they happen after the lifecycle completes, through the digest-gated
handoff, user-controlled signing on the local review page, and server re-read
of Sui mainnet for the signed transaction digest.
Public producer projections are tied to those stage states:
`reviewState.humanReadableReview` is valid only after `human_readable_review`
is completed and not listed as missing, and `reviewState.simulation` is valid
only after `review_time_simulation` is completed and not listed as missing.

When `reviewState.humanReadableReview` is present, it is displayable review
evidence projected from verified review artifacts. Its `kind`
currently identifies the first swap review projection. Its `assetFlow` raw
amounts, coin types, decimals, minimum output, and fee facts come from the
material-bound quote policy evidence. Its target pool and direction come from
the same quote source. Its object-ownership evidence reference comes from
stored transaction material and Sui owner/type reads. Use it to explain the
current local review facts only. Do not use it as transaction bytes, public transaction digest values, signing data, signing readiness, route quality, wallet handoff, or execution readiness. Any display amount in this field is
presentation context only and is not a signing or simulation input.

When `reviewState.simulation` is present, it is a public summary projected from
private review-time simulation evidence for the stored local transaction
material. It may include provider, enabled checks, success, raw Sui gas cost
summary components, balance changes, and object changes. It
does not expose transaction bytes or the internal transaction digest. It is not
wallet handoff, not signing data, not signing readiness, not execution
readiness, and not proof that a wallet has signed or submitted anything.

If the lifecycle runs through review-time simulation and every required
evidence artifact passes contract assembly, account-bound review returns
`ready_for_wallet_review` and records the schema-validated contract in
`reviewState.walletReviewAdapterContract`.
The contract carries the transaction commitment hash only; it is not
transaction bytes, not signing data, not signing readiness, and not
execution readiness.
If contract assembly declines, the review returns `blocked` with
`blockedReason: "wallet_review_contract_emit_missing"` and a failed
adapter-prefixed check such as `deepbook_wallet_review_contract_emit_missing`
or `flowx_wallet_review_contract_emit_missing` naming the concrete reason. In
the contract-missing blocked state, wallet signature requests and execution
remain unavailable. In the `ready_for_wallet_review` state,
`reviewState.adapterLifecycle.missingStages` is empty and the human-readable
review plus simulation public summaries are present as pre-signing review
evidence. The local review page can request the byte handoff, which is refused
unless the recomputed digest of the stored bytes equals the reviewed
commitment. The
`producer_stage_missing` reason applies only when
`reviewState.adapterLifecycle.missingStages` lists at least one missing review
evidence producer stage, and public projections for missing stages must not be
present.
If transaction material cannot be built, the review fails closed with a concrete
blocked or refresh reason. The fallback
`adapter_not_implemented` state still applies when no review evidence source is
available.

Those checks and lifecycle stages are pre-signing review evidence only. They do
not expose transaction bytes, signing data, signing readiness, route
recommendations, funding readiness, or execution readiness. Only a
`ready_for_wallet_review` state with an emitted wallet review contract lets the
local review page request the digest-gated byte handoff, and that handoff is
not an MCP response.

Do not describe those checks as wallet readiness, signing readiness, route quality, or execution safety. Mention local transaction material only when `transaction_material_build_or_verify` is completed, and state that bytes remain internal. Mention digest commitment only when `digest_commitment` is completed, and state that it is an internal binding to stored material, not a public signing artifact.

In the current release, prepared review plans label `assetFlowPreview` entries with `amountKind: "display_intent"`.

Nested `assetFlowPreview.amount` strings remain display-intent text and are not raw signable quantities.

These amounts are explanation/display context only, including unresolved placeholders such as `amount: "unknown", approx: true`.

They are not minimum outputs, simulation results, or transaction-building inputs.

DeepBook transaction material build uses the derived raw quote policy in the
account-bound review layer, not `assetFlowPreview.amount` display strings.

Any adapter that returns a signable review contract must keep a separate
contract before any wallet handoff exists. The source-level contract is
`src/core/action/signableAdapterContract.ts`; the explanatory contract document
is `docs/SIGNABLE_ADAPTER_CONTRACT.md`.

That contract requires input provenance, source-of-truth records, typed evidence
claims for each safety-critical fact, raw integer amounts with verified
decimals, gas from review-time simulation, expiry checked at review time,
slippage or min-out policy when quote evidence is used, object ownership
evidence, simulation evidence, and the same human-readable review field concepts
exposed by `plans[].reviewModel`.

Payload fields in that contract must reference typed evidence claims.
The claims must resolve to source-of-truth records through the
`SAFETY_CRITICAL_FACT_MATRIX`; source id presence alone is not enough.

The contract also defines `PtbVisualizationArtifact`. A PTB visualization
artifact may expose Mermaid `flowchart` text, diagnostics, `generatedAt`,
`source`, and unsupported-use fields. It must report
`executableMaterial.included: false`.

PTB visualization is explanatory evidence only. It is not transaction-building
authority or wallet authorization. It is not signing data, not signing
readiness, not payment execution readiness, not route recommendation, and not a
replacement for review-time simulation.

The graph is decoded from the stored transaction bytes by the pinned
deterministic renderer with no AI or model input, and only after those bytes
recompute to the bound commitment; the Mermaid source keeps raw package
addresses for independent cross-check.

The review layer renders the artifact when an account-bound review emits the
wallet review contract and the pinned renderer succeeds. The artifact is
returned as `reviewState.ptbVisualization` next to
`reviewState.walletReviewAdapterContract`. A renderer failure adds a warning
`deepbook_ptb_visualization_unavailable` check instead and does not invalidate
the emitted contract. PTB visualization is not a transaction builder,
not wallet handoff, and not a signing data source.
It is not a signing readiness signal. Review-state checks are pre-signing review evidence; wallet signing happens afterward on the local review page under the user's control.

## Session Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `session.create_wallet_identity` | Implemented | Creates a local wallet identity session and wallet URL for the same machine's system browser. |
| `session.get_wallet_identity` | Implemented | Polls a wallet identity session status; use `account.get_active_account` to confirm current active account context. |
| `session.wait_wallet_identity` | Implemented | Waits briefly for a wallet identity session to reach a terminal status. |
| `session.get_interaction_status` | Implemented | Reads active account context and pending shared wallet or review interactions. |
| `session.get_review_status` | Implemented | Reads internal and public review status for a `reviewSessionId`. |
| `session.get_execution_result` | Implemented | Reads public execution polling status and any recorded result for a `reviewSessionId`. |
| `session.wait_execution_result` | Implemented | Waits briefly for execution polling status to reach a wait-stopping status. |

Wallet identity URLs include a short-lived fragment token and are scoped to the local loopback review server.

Open them in the same machine's system browser, not in an MCP client sidebar or webview.

Wallet identity polling uses a 5 second interval because it waits on user wallet interaction. Execution polling remains separate.

Wait tools keep pending state in memory only. They return `timed_out` when the user has not finished yet and do not provide push notifications.

If the host forwards cancellation, wait tools return `request_aborted`. A local MCP server restart interrupts pending waits.

`session.get_interaction_status` returns active account context plus the latest five pending wallet and review interactions by `lastActivityAt`, with `limit` and `truncated` fields for each list.

For review interactions, pending means the review session is not in a final execution status. `pendingReviewSessions.items[].statusCategory` may be `non_terminal`, `awaiting_chain_result`, or `user_action_required`. Final statuses `success`, `failure`, and `expired` are excluded from `pendingReviewSessions`.

`session.get_review_status` returns both `pollingStatus` and `statusCategory` for the requested review session, so a client can distinguish final results from statuses that still require user or review-flow action.

For execution waits, use `statusCategory` and the execution `pollingHint` fields instead of treating every wait stop as a final result.

`pollingHint.waitStoppingStatuses` lists statuses where wait tools may stop returning `timed_out`.

`pollingHint.finalStatuses` lists final result statuses: `success`, `failure`, and `expired`.

`pollingHint.userActionRequiredStatuses` lists statuses that require user or review-flow action: `refresh_required` and `blocked`.

For execution waits, `signed_pending_result` is categorized as `awaiting_chain_result`.

That means signing has already happened and the local server is waiting for
the server re-read of the signed transaction digest from Sui mainnet. Result
reads and waits may lazily retry that read while the session remains pending.

When the server verifies a chain receipt with successful effects, execution
polling can return `success` with `executionResult.chainReceipt`. When Sui
mainnet reports failed effects, execution polling can return `failure` with
`failureReason: "chain_execution_failed"` and a chain receipt. When the digest
cannot be found before the local lookup window ends, execution polling can
return `failure` with `failureReason: "chain_receipt_unavailable"`. When the
chain transaction fails digest, sender, or receipt validation checks, execution
polling can return `failure` with
`failureReason: "receipt_verification_failed"`.

The local review page shows server-read receipt facts inline on terminal
sessions, and a internal Receipt card reads on-chain receipt facts by
transaction digest for browser inspection of server-read receipt facts. Neither
is a wallet action, MCP execution path, route verdict, or signing-readiness
signal.

`executionResult.chainReceipt` is a server-read execution fact for the reported
transaction digest. It is not transaction bytes, not raw BCS, not wallet
signatures, not signing data, not signing readiness, not an execution
guarantee, not route quality, not fiat value, not P&L, not tax evidence, not
best-price evidence, and not peg evidence.

`blocked` and `refresh_required` are wait-stopping statuses, but they are not final success or failure.

Execution result transitions are owned by the local review server. The browser
reports only signed pending digests or local pre-chain failures; MCP wait tools
observe stored transitions and may trigger the same lazy server re-read path,
but they do not sign, submit, or produce signing results.

Session status and wait tools may lazily mark expired local sessions while reading, so session lifecycle tools are annotated `readOnlyHint: false`.

`read.summarize_wallet_assets` and `read.classify_wallet_assets` may populate the local positive coin metadata cache while reading balances, so they are also annotated `readOnlyHint: false`.

These tools still do not execute transactions, sign, create custody, or produce signing material.

Wallet identity, interaction status, review status, and execution polling responses expose `userAnswerUse` when the response needs user-answer guidance. For those responses, use status and polling fields only for local read-context or review-flow state. Do not turn them into login, wallet authorization, execution guarantees, signing data, or signing readiness.

The following remain read-only product evidence tools:

- `read.preview_intent_evidence`;
- `read.list_settlement_asset_groups`;
- `read.quote_deepbook_display_amount`;
- `read.summarize_deepbook_account_inventory`;
- `account.get_active_account`.

They only expose current read evidence, active account context, static SDK registry metadata, or pinned SDK simulation facts. Any metadata-cache population is implementation-local and does not expand product authority.

## Account Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `account.get_active_account` | Implemented | Reads the active wallet-account read context. |
| `account.clear_active_account` | Implemented | Clears the active wallet-account read context. |

## Settings Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `settings.create_local_settings_session` | Implemented | Creates a same-machine local settings page session. |
| `settings.get_local_settings` | Implemented | Reads local Say Ur Intent settings, including effective Sui gRPC and GraphQL endpoint sources. |

Settings MCP tools are session-gateway/read tools, not direct mutators.

The settings page can change local settings after settings-token validation:

- stored Sui gRPC or GraphQL endpoint;
- default endpoint restoration;
- active account read context clearing;
- logical local data reset;
- local data export;
- replace-only local data import.

These actions do not sign, execute, create custody, or produce signing material.

Endpoint changes apply after MCP server restart.

Custom providers can affect read data quality, so use trusted mainnet providers.

## Resources

| URI | Purpose |
| --- | --- |
| `sayurintent://docs/readme` | Public entry document: product purpose, current release boundary, setup path, and documentation map. |
| `sayurintent://docs/mcp-setup` | Setup guide: installation, MCP client connection, first-use flow, settings, and troubleshooting. |
| `sayurintent://docs/mcp-tools` | API reference: tool contracts, response fields, statuses, follow-up fields, and output boundaries. |
| `sayurintent://docs/wallet-identity` | Wallet identity reference: active-account read context and same-machine capture boundaries. |
| `sayurintent://docs/agent-behavior` | Answer playbook: user-question flows, tool selection, and response wording boundaries. |
| `sayurintent://protocols/deepbook-v3` | Protocol reference only; use MCP tool responses and `read.list_supported_protocols` for current support. |
| `sayurintent://protocols/deepbook-margin` | Protocol reference only; no margin MCP read tools or signable actions are exposed in this release. |

Only allowlisted mainnet protocol references are exposed as MCP resources.

Protocol resources are not runtime registries, supported-protocol lists, live liquidity sources, route recommendations, or signing-readiness signals. Use `read.get_server_status`, `read.list_supported_protocols`, concrete tool schemas, and concrete tool responses for current product support.

MCP resources are runtime-facing references that connected AI clients can read.

They are different from contributor-only documents such as `AGENTS.md`, `docs/AGENT_DEVELOPMENT_POLICY.md`, implementation architecture notes, utility indexes, and ignored local planning notes.

If an answer behavior must affect AI clients, it belongs in server instructions, an MCP resource, an MCP prompt, schemas, or returned evidence fields, with tests.

Do not rely on contributor-only documents as the runtime source of agent behavior.

## Prompts

| Prompt | Purpose |
| --- | --- |
| `inspect-supported-sui-actions` | Guides a user through checking server status and supported mainnet surfaces. |
| `prepare-reviewable-sui-action` | Guides a user through the review-session flow without claiming unsupported signing support. |
| `swap-deep` | Prepares a reviewable DeepBook swap from a one-line intent argument (any language), e.g. `10 sui to usdc`. |
| `swap-flowx` | Prepares a reviewable FlowX CLMM swap from a one-line intent argument (any language), e.g. `10 sui to usdc`. |
| `swap` | Bare-action prompt, always registered. With one protocol it routes straight there; with several it takes an optional `protocol` argument (completion suggests the slugs) and instructs the model to list the options and ask the user - never to pick a venue silently. |

Adapter prompt surfaces are declared per adapter in
`src/adapters/adapterPromptSurfaces.ts` and validated against
`adapterPromptSurfaceSchema`. Names are action-first
(`<action>-<protocolSlug>`, e.g. `swap-deep`), so autocomplete groups by what
the user wants to do; the bare action prompt stays registered as protocols
are added, and once several protocols share an action it asks the user to
choose (optional `protocol` argument with completion), so it never silently
picks a venue. Each surface takes exactly one
free-text `intent` argument so MCP clients can pass the whole request in one
line; the model parses the intent, the server never does. Platform boundary
language (no signing data, no transaction bytes, local-review-only signing) is
appended at registration time and cannot be weakened by an adapter. Prompts
are standard MCP `prompts/list` entries, so any MCP client that surfaces
prompts (Claude Desktop, Claude Code, and others) exposes them without extra
configuration.

Prompts are explicit runtime-facing workflows. Tool descriptions remain concise, literal, and instruction-free; do not move behavioral policy into tool descriptions.
