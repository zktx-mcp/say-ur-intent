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

Address-free reads do not need wallet connection. Examples include DeepBook pool lists, orderbook snapshots, mid price, and quote facts.

Current asset reads need either an explicit public Sui address supplied by the user or a selected account with a usable current wallet connection. Stored activity and transaction-result reads retain their own read-context rules.

An explicit public-address read does not prove ownership, create active account context, or authorize active-account-only tools.

Live read results include `fetchedAt` as an ISO 8601 UTC string. `fetchedAt` is a timestamp, not a freshness verdict.

## API Response Guidance

High-risk read, review, wallet connection, and execution-status responses include `userAnswerUse` when the response needs answer guidance.

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
| `ui.open_account` | Optional explicit Sui address; otherwise use the selected read account only when its wallet connection is currently usable. Missing input returns `input_required` with no card or source query. Shows name, address, coin totals, Display NFTs, other-object count, fetched time and enumeration limits; no address form. |
| `ui.open_receipt` | A transaction digest is required for a query. Omission returns `input_required` with no card or source query. The result view shows execution outcome, balance changes, net gas, sender, digest and fetched time; no hash form. No wallet or active account is needed. Normalized receipt evidence and private display metadata remain available under their existing boundaries. |
| `ui.open_chart` | Optional `poolName`, official Indexer interval, UTC `startTimeMs`/`endTimeMs`, and candle `limit`. Shows one selected USDC pool as candlesticks and volume. Range shortcuts fill these query fields. The initial time axis uses the saved request boundaries, with price-free whitespace at boundaries without candles; omitted boundaries use the returned data. |

A missing Account/Receipt target returns `data: { kind, status: "input_required", field, message }`, with no permission, card ID, saved resource or query. A host-rendered view shows the message without input controls or polling. Other errors remain errors.

A successful card-creating response contains a `cardId`, `kind`, `state`, `revision`, timestamps, original `input`, and available `data`. `inputRemainingMs` is computed by the backend; `pollAfterMs` controls sequential observation of a running read. Card `ready` permits a read selection, not signing or payment readiness. An initial supplied input uses the same admission path as a form submission. DB states are `ready`, `running`, and `closed`, with terminal reasons `completed`, `expired`, `failed`, or `server_restarted`.

When Chart pool choices cannot be prepared, the backend creates a `closed`/`failed` card with a readable error. No selection is admitted and no candles are requested. Reading that card again returns the stored failure; retrying the source requires an explicit request for a new card. A database access or write failure is a tool error, not a successfully stored failure card.

`ui.read_card` and `ui.submit_card` are app-only operations. Permission travels in UI metadata and is absent from model content and public saved resources. Input submission carries card ID, permission, expected revision and typed input. There is no first-view ownership or open/close operation. Recreated frames and chat returns read the same DB record. Identical duplicate input returns the stored request; conflicting input returns `card_conflict` and the authenticated current snapshot in error details. Invalid input returns `invalid_card_input` without consuming a valid selection. Invalid permission exposes neither current state nor private display data.

Receipt model results retain input kinds/indices/object references and identify input values and PTB as UI-only details. This is a privacy-channel designation, not a promise that the standalone Receipt summary displays those details. Review can display them in its Transaction details disclosure. Do not tell users that the standalone Receipt card has input or graph controls. The typed `say-ur-intent/receipt-display` metadata binds display data to the same card ID, transaction digest and revision. It carries individual on-chain Pure input values and the graph derived from those inputs; never a serialized transaction, signature or wallet credential. Public saved resources contain only the model projection. A missing UI detail payload means unavailable display data, not that a transaction had no inputs.

Backend expiry ends unsubmitted input. A server restart invalidates unfinished cards; stored completed results remain readable. Reset/import removes cards and their permissions with the data change. Completed input does not reopen, while still-valid unsubmitted input is unaffected by chat navigation. A lost submit response is resolved by reading the same card, without another source request.

A frame with valid UI permission confirms the current DB state even if its initial snapshot cannot be displayed. A display error does not change the stored state, repeat a submission, or start another source query. Required expiry and running-state observations still follow the backend hints. If a state read fails, automatic observation stops and the user can explicitly read the same saved state. A completed result that cannot be displayed remains stored; reopening the same card reads that stored result rather than requesting new data.

Review displays one current wallet candidate without a dropdown; an explicit card button selects that target. Multiple candidates still require selection. Normal display never starts preparation or signing. Completed Review cards lead with actual chain facts and keep earlier estimates in Reviewed conditions.

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

### DeepBook account inventory

`read.summarize_deepbook_account_inventory` uses the selected account only when its current wallet connection is usable, to discover DeepBook BalanceManager addresses. It has no explicit public-address input. Without a usable default, a missing selection returns `active_account_not_set`, and a stored but ineligible selection returns `input_invalid`; both carry `details.reason: "connected_account_required"` and `details.followUp` naming `session.get_interaction_status` and its connection/availability/pending/default-account fields. These responses do not request an address. Unavailable wallet operations return `wallet_unavailable` with the existing safe reason and recovery message.

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

When `account` is omitted, it uses the same connection-qualified default as `session.get_interaction_status.assetReadAccount`. No stored selection returns `active_account_not_set` with `details.action: "provide_account"`; a stored but ineligible selection returns `input_invalid` with `details.reason: "address_required"`. Both request an explicit address. SDK unavailability is not reported as absence of a stored account.

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
- Account scope: explicit public `account` or a selected account with a usable current wallet connection.

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
| `action.prepare_sui_action_review` | Signable internal Review card | Creates a local review session and internal Review card for a supported swap action proposal. Account-bound DeepBook reviews may build local unsigned transaction material inside the review server, internally bind a Sui transaction digest to it, and derive object ownership, quote/policy, human-readable review, review-time simulation, and PTB visualization evidence. When every required evidence stage completes, an explicit Review card selection can admit backend-mediated WalletConnect approval for that exact transaction. The MCP tool does not return transaction bytes, signing data, or signing readiness. |
| `action.prepare_external_proposal_review` | Non-signable review | Creates a local review session and internal Review card from an untrusted structured external proposal. It does not return transaction bytes. |

`action.prepare_sui_action_review` is account-bound: a swap review computes
its evidence (balances, transaction material, digest, simulation) for a
specific sender, so the tool requires an active wallet account. Connect first
with `session.create_wallet_connection`; with no active account the tool returns
`active_account_not_set` with `details.action: "connect_wallet_connection"`
instead of creating a proposal that can never be computed or signed. The
Review card reads that account from the server as the single source of truth
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

Complete supported DeepBook review reaches ready_for_wallet_review. This
is review evidence, not transaction authority. A scoped user selection admits
one request; the backend sends the stored bytes through WalletConnect, verifies
the returned digest and signer, and submits once. It independently reads chain
effects and records them separately from request status. The Review and Receipt
cards display those facts; neither the model nor the card receives bytes or
signatures. Ordinary MCP calls cannot authorize signing or submission.

After the wallet account is bound to a supported swap review session, the
Review card and `session.get_review_status` may show protocol-specific quote
evidence and review-state checks for:

- resolved DeepBook direct pool;
- raw quote evidence;
- quote freshness;
- derived raw min-out policy;
- protocol fee evidence, including DeepBook DEEP fee evidence;
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
adapter-owned DeepBook lifecycle. `stageCatalogId` identifies the
adapter-owned stage catalog; it is not a core lifecycle enum shared by every
protocol adapter.
Completed stages are review progress only. If
`transaction_material_build_or_verify` is completed, it means the local review
server built unsigned transaction material and kept the bytes internal. If
`digest_commitment` is completed, it means the server internally derived a Sui
transaction digest from that stored material; the digest value and transaction
bytes are not MCP or review-app outputs. Missing stages explain why the review
remains blocked. This lifecycle covers review evidence producer stages through
review-time simulation. Wallet requests, signature verification, submission and
chain observation are platform responsibilities after review, separate from
adapter lifecycle stages. Only a user selection and wallet approval admit that
backend path; ordinary model calls do not authorize it.
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
`reviewState.transactionReviewData`.
The contract carries the transaction commitment hash only; it is not
transaction bytes, not signing data, not signing readiness, and not
execution readiness.
If contract assembly declines, the review returns `blocked` with
`blockedReason: "wallet_review_contract_emit_missing"` and a failed
adapter-prefixed check such as `deepbook_wallet_review_contract_emit_missing`
naming the concrete reason. In
the contract-missing blocked state, wallet signature requests and execution
remain unavailable. In the `ready_for_wallet_review` state,
`reviewState.adapterLifecycle.missingStages` is empty and the human-readable
review plus simulation public summaries are present as pre-signing review
evidence. The backend verifies stored bytes against that digest before requesting
a wallet signature, then checks returned bytes and signer before submission.
The card never receives the bytes.

Those checks and lifecycle stages are pre-signing review evidence only. They do
not expose transaction bytes, signing data, signing readiness, route
recommendations, funding readiness, or execution readiness. Only a
`ready_for_wallet_review` state with an emitted wallet review contract lets the
backend admit a user-selected WalletConnect request; its byte transfer is
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
`reviewState.transactionReviewData`. A renderer failure adds a warning
`deepbook_ptb_visualization_unavailable` check instead and does not invalidate
the emitted contract. PTB visualization is not a transaction builder,
not wallet handoff, and not a signing data source.
It is not a signing readiness signal. Review-state checks are pre-signing review evidence; wallet signing happens afterward on the internal Review card under the user's control.

## Session Tools

| Tool | Input and result |
| --- | --- |
| `session.create_wallet_connection` | Opens an internal card for connection, disconnection and approved-account selection. Opening the card starts none of those operations; the user acts in the card. Disconnection requires target-specific confirmation and does not revoke onchain permissions. |
| `session.get_wallet_connection` | Reads one `cardId`; public response excludes pairing and permission. |
| `session.wait_wallet_connection` | Waits on one `cardId`, with an optional timeout up to 55 seconds; stops when user input is needed or the admitted connection/disconnection operation ends. |
| `session.open_review_management` | Opens management for exact `reviewSessionId` + `attemptId`; no refresh or signing authority. |
| `session.get_interaction_status` | Stored `activeAccount`, current-owner `connections`, `assetReadAccount`, wallet availability, and bounded pending connection/review lists. `assetReadAccount` is `available` with an account only when that selected address has a usable current connection; otherwise `address_required`. Stored `activeAccount` does not prove a live connection. `address_required` reports that no implicit default is available; it does not add an address input to connected-account-only tools. When wallet availability is unavailable, connection rows are last recorded facts, not proof of presence or absence. |
| `session.get_review_status` | Current preparation status, review revision, optional current request and chain execution. |
| `session.get_execution_result` | Observes the current explicitly referenced attempt and may read its known digest; never submits again. |
| `session.wait_execution_result` | Bounded wait on the same request, separate from its signing and chain-observation deadlines. |

`pendingWalletConnections.items[].status` is `input_required`,
`awaiting_approval`, or `disconnect_pending`. The last value describes an
admitted, running disconnect card, not a new wallet connection state. In card
workflow data, a connection's optional `pendingAction: "disconnect"` is derived
from that stored card operation. Its `status` remains the last confirmed
connection fact. Such a connection is unavailable for a new account selection,
review or signature request. `observe` remains true while disconnection can be
observed, and becomes false on completion or unavailable wallet progress.
While its SDK callback remains pending, unavailable progress preserves the
operation and its last recorded connection state. Repeating the same selection
does not send another SDK request.

`session.get_interaction_status` reconciles stored connections against current SDK sessions before reading dependent review/request facts. This can record a connection change and invalidate a review or interrupt an unsubmitted request under the existing rules. It preserves the stored account selection and submitted chain results; it does not start pairing, SDK disconnect, signing or submission.

When a disconnect callback ended but its completion write failed, current reads
reconcile that stored operation without another SDK disconnect. If the SDK is
unavailable, an unconfirmed failure is distinct from verified disconnection.
`pendingReviewSessions` includes live Review input or ongoing preparation,
request or explicit result observation. Cancelled/expired input alone is not a
pending interaction, even when the stored review is proposed or ready. Closing
the original input does not remove an admitted request that is still waiting.
`submitting` permits observation of the admitted digest during the same initial
window as `awaiting_chain_result`, without waiting for the submission response.
A stored chain result can therefore precede that response.

An unadmitted ready Review may include `nextStateReadAfterMs`, a server-computed
interval until its verified review material must be checked again. A positive
value schedules a same-card state read; an absent or zero value schedules no
additional wake-up. It is separate from `actionRemainingMs` (card authority),
the signing wait and the chain observation window. Only the backend changes
the stored review to `refresh_required`; the hint never authorizes a request,
extends validity or refreshes a quote. Admitted requests and their management
views do not use it to expire historical review facts.

Current card and session responses describe one backend evaluation of stored
facts. Their action choices and remaining times do not authorize a later
command: admission rechecks the selected account, revision, material and expiry
against current stored data. If review data changes during verification and
requires a new verification, the read returns `invalid_session_transition` with
`details.reason: "review_changed_during_verification"` and a safe message.
Read the same state again; do not resend a financial action. This conflict is
neither a completed result nor a wait timeout. A command already committed
before its response fails remains recorded and is recovered by reading it.

Unavailable wallet setup distinguishes missing configuration, invalid project
ID format, and backend initialization failure. A failed Connect card preserves
its safe reason on subsequent reads. Connection-restoration or event-subscription
failure disables wallet operations and returns a restart explanation. Neither
failure starts a pairing or signature request, and ordinary evidence reads
remain available. SDK error bodies and configuration values are not returned.

Review status is preparation state (`proposed`, `awaiting_wallet`,
`wallet_connected`, `ready_for_wallet_review`, `blocked`, `refresh_required`,
`expired`). `requestStatus`, when present, is `awaiting_signature`, `submitting`,
`awaiting_chain_result`, `stopped`, `request_failed`, `outcome_unknown`, or
`completed`. `pollingStatus` uses the current request when there is one and
otherwise the preparation state. Preparation needs user action; it is not an
already pending wallet signature.

A review's bound account is fixed; changing the active read account does not
rebind it. Preparation choices and final admission use the same account rule.
To update a review bound to A, select A again in a new Connect card. To review
for B, request a new Review. An absent or incompatible read account removes the
preparation choice without recording a preparation failure. The existing
`review.error` card text distinguishes `Current account selection` guidance from
a stored `Previous review update` error. It does not decide permissions. Changing
read context alone does not revoke an already valid A review's signing choice.
Once a signing request consumes its card, retrying needs a new Review; a
management card only refers to its existing exact attempt.

Only `completed` has `executionResult`, with `attemptId`, review/plan IDs,
`status: success | failure`, the exact digest, verified `chainReceipt` and time.
Only failed chain effects have `failureReason: chain_execution_failed`. Wallet
rejection, local timeout, unavailable receipts and lost submission responses
never fabricate a chain failure. An unknown result retains the digest for later
reads. An explicit user stop after submission stops observation, not an on-chain
transaction. Wallet connection changes or a requested disconnect stop pending
submission permission with their own recorded reason; they do not claim that the
user stopped waiting or that disconnection already succeeded. After submission,
those connection events preserve independent observation of the same digest,
including the first lookup after the submit response. They neither stop that
observation nor resume observation the user explicitly stopped.

The original request's stored deadlines are unchanged by a management card.
A new signature requires a newly reviewed revision and explicit selection.
Identical duplicate selections return the admitted attempt; no response-loss
path replays a financial request. Model tools may open/read cards; only scoped
app-only `ui.act_card` performs a user selection. UI permission and pairing QR
travel in private metadata. Bytes/signatures never reach the card or model.

Connection observation uses 5 seconds and request observation 3 seconds.
Session responses and workflow card data expose `walletAvailability` separately
from stored review, request and chain facts. It is either `{status: "available"}`
or `{status: "unavailable", reason, message}`. Reasons are
`initialization_failed`, `restoration_failed`, and `wallet_state_unavailable`.
Initialization failure includes a missing backend wallet workflow or transport;
the product supplies its WalletConnect identifier without a user setting.
Availability describes the backend dependency, not account ownership, wallet
approval or signing readiness.

Target-specific `progress.status` is `idle`, `waiting`, or `unavailable`. The last
includes `reason: "wallet_unavailable"` and a safe message. A wait returns
`unavailable` when a nonterminal wallet operation cannot be observed; it retains
the saved facts. Completed requests return `status_reached` immediately, even
when the wallet dependency is unavailable. Already submitted requests can still
be observed by their exact digest independently of WalletConnect. These runtime
fields do not change request states or activity counts.

Wallet-dependent commands rejected for dependency failure use the error kind
`wallet_unavailable`, with a safe reason and message. Invalid input and domain
conflicts retain their own meaning. Validated app actions can also return a
current snapshot with `error.code: "wallet_unavailable"`; invalid permissions
and storage failures do not receive a success snapshot. Review creation can
still display non-signable proposal facts and stored request management.

Wait `timed_out` is only a local wait outcome. Reads may update stored expiry or
receipt facts, so these session tools are annotated `readOnlyHint: false`.
Their effects do not include signing or submission. The returned `pollingHint`
and `statusCategory` distinguish required user action, pending observation and
local request closure; closure alone does not prove chain success or failure.

A request's `reason` distinguishes a directly confirmed transaction-digest
mismatch from submission checks that could not be completed. Incomplete SDK,
network or storage checks do not prove a wrong signer, wallet rejection or chain
failure. Backend-authored domain reasons remain specific; raw SDK/RPC/database
errors are not exposed. Already committed signature-verification facts are
retained when a later submission-admission check fails.

### Stored review activity

`read.list_review_activity` accepts account/time/limit and independent ANDed
`reviewStatus`, `requestStatus`, `executionStatus` filters. One row represents
one review session and its explicit current attempt, including optional
`currentAttemptId`, `reviewRevision`, `transactionDigest`, request and chain
status. `dataScope.recordCount` counts the complete filtered scope before limit.

`read.summarize_review_funnel` keeps the session denominator. `reviewStatusCounts`
is the preparation distribution; `requestStatusCounts` is a list of
`{ requestStatus, count }` entries (including zero counts); `executionStatusCounts`
has success/failure counts. Status strings are data values, not secret-like JSON
field names. Request counts plus `withoutRequest` equal total. Chain counts plus
`withoutExecutionResult` equal total. Wallet rejection is not chain failure.

`opened` counts first authenticated normal Review-card state reads, not frames,
model creation or wallet approval. walletConnected/stateComputed and review
states reached are distinct-session history. `everAwaitedChainResult` counts
sessions that reached that request stage; `expiredWithoutExecutionResult` counts
expired reviews with no result in any attempt. Timing fields
`avgCreatedToSignatureVerifiedSeconds` and `avgOpenedToSignatureVerifiedSeconds`
use each review's first backend-verified signature time, or null when absent.
Overlapping history stages must not be summed as a denominator.
A request can move directly from `submitting` to `completed` when its receipt is
observed before the submission response or after a failed follow-up write. That
result counts as completed and as its verified chain outcome, but does not count
as `everAwaitedChainResult` unless the session actually reached that stage in an
attempt. This metric is neither a submission total nor a mandatory funnel step.

`read.get_review_session_detail` returns the current `request`, full
`requestCount`, capped `requests`, revision-bound state snapshots and transitions
with `domain` and optional attemptId. Each request may contain a verified
`execution`; absent execution does not imply failure. Current request is returned
even if the history list is truncated. Historical attempts remain evidence after
live cleanup or public backup import, never authority to manage or sign.
Response-local `userAnswerUse` only enables execution answers where execution
facts actually exist.

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
| `sayurintent://docs/wallet-connection` | Wallet connection reference: active read context, private SDK ownership and user-approved transaction requests. |
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

### Funding facts in supported swap reviews

The human review's `transaction_funding` evidence describes the verified funding
form of the stored transaction: actual coin objects, address balances, or a mix.
`gas.gasObjects` describes real gas coins only and can be absent for address-balance
gas or reservation-only funding. Absence of a gas object does not establish a
balance shortfall. Source verification failure is distinct from confirmed
insufficient balance. Use the review's checks and stored status for those facts.

Wallet balance responses retain total, coin-object and address-balance values.
They remain balance snapshots, not payment or signing readiness. Receipt gas
costs remain independently read chain facts; a reservation identifier is never
presented as a real gas payment object.

Storage rebates can exceed simulated gas costs when coin objects are merged.
In that case, the optional unsigned `transactionReviewData.gas.gasUsedRaw` is
absent, not zero. The gas budget, simulation cost/rebate components and signed
balance changes remain available; the Review card displays the signed net cost.

A deterministic protocol rejection during SDK build-time simulation is reported
as a simulation rejection, not proof of missing account objects or funds. Refresh
or a new user-selected constraint does not establish success until the complete
review is recomputed. The backend does not relax slippage to make a build pass.
