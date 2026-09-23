# Sui DeFi Protocol Research Spec

Status: GitHub-tracked research specification. This file is not an npm package
document, not an MCP resource, not a runtime registry, not a registry allowlist,
not a supported-protocol list, and not a source of live balances, liquidity,
quotes, or route decisions, and not signing readiness.

Use this spec to decide how protocol research must be structured before any part
becomes code, a JSON registry, a classifier, a read tool, or a local database
table. The current product stores user-requested transaction activity facts and
local review evidence. It does not store this static protocol survey in the
local user database.

## Purpose

Sui DeFi protocols share some concepts, such as packages, shared objects, pools,
markets, positions, fees, events, and reward state. They also differ sharply:
order books, CLMM pools, lending markets, liquid staking, margin, wrappers, and
vaults do not expose the same user state or risk model.

This spec exists so future work does not hardcode one protocol's shape into a
generic DeFi analysis path. It separates:

- Static protocol research.
- Runtime transaction facts observed through GraphQL or gRPC.
- Optional Sui CLI development evidence for digest effects, object inspection,
  replay traces, and gas profiles.
- Local user wallet facts.
- Current derived protocol classification through `compact.protocolMatches`.
- Future account-bound position or risk reads.

## Non-Goals

This spec does not approve:

- A JSON registry entry.
- A package or object allowlist.
- Protocol support claims or position classification from research alone.
- Wallet position discovery.
- Complete DeFi portfolio inventory.
- P&L, tax, or valuation analysis.
- Transaction building, signing, execution, route recommendation, or settlement
  choice.

## Required Workflow

Every protocol must move through this order:

1. Record a human-readable research note with sources, addresses, functional
   surfaces, conflicts, and unsupported surfaces.
2. Record any verified Move Registry name for each package when the protocol has
   one. Resolve the name through the pinned Sui SDK or the mainnet MVR endpoint
   and keep the name and resolved current package address together. MVR is the
   preferred source for the current package address when a verified name exists.
   Keep package records for transaction interpretation separate from current
   package claims.
3. Fit the protocol into the normalized research record in this spec.
4. Compare it against at least two different activity categories to avoid a
   protocol-specific data model disguised as a generic one.
5. Decide whether the next product behavior is:
   - transaction activity labeling,
   - account-bound position inventory,
   - live quote or state read,
   - dApp/package/function activity diagnostics,
   - registry/policy,
   - or no implementation.
6. Only then design code, storage, or registry changes.

Skipping from a research note directly to runtime code or JSON policy is out of
scope.

## Boundary And Storage Decision

- Official package and object research:
  Do not store at runtime. Keep it in Git-tracked Markdown research notes for human and agent planning.
- Policy allowlists used by code:
  Do not derive them from this file. A future reviewed JSON registry would become local policy and needs tests.
- Observed transaction facts:
  Store only when a known-wallet relation is proven. Local SQLite activity tables already own this boundary.
- Raw provider payloads:
  Do not store. Raw payload storage is intentionally avoided.
- Sui CLI digest, object, replay, trace, and gas-profile output:
  Do not store as runtime data by default. Keep it as documented utility output or ignored local artifacts.
  CLI output is development/debug evidence, not MCP runtime source of truth, signing readiness, registry data, or wallet authorization evidence.
- Derived protocol labels for a transaction:
  Store as derived response facts only when normalized details are available.
  Use `compact.protocolMatches` with classifier version and source reference.
  This is transaction labeling only, not protocol support, position inventory, P&L, signing, or routing.
- User protocol positions:
  Not implemented. Future support needs protocol-specific state reads and unit boundaries.
- Live balances, liquidity, APR, borrow limits, or quotes:
  Do not store statically. Use live read tools only if that support is implemented.

## Promotion Gates

Research can be promoted only when the target product behavior is explicit.

- Transaction activity labeling:
  Needs exact package/module/function or object/event matching rules, false-positive cases, classifier version, and tests using current transaction detail facts.
- dApp/package/function activity diagnostics:
  Needs pinned GraphQL `TransactionFilter.function` behavior, bounded pagination, normalized detail reuse, and deterministic summary output.
  Optional Sui CLI cross-checks must be read/debug-only, record CLI version, and reject arbitrary shell, Move calls, package calls, signing, execution, and key handling.
- Account-bound position inventory:
  Needs a user state model, live read source, unit/decimal source, ownership proof, pagination rule, and unsupported-position behavior.
- JSON registry or local policy:
  Needs an official source, mainnet onchain verification, generated/manual ownership decision, overclaim-prevention tests, and docs explaining the policy boundary.
- MCP read tool:
  Needs input schema, output schema, source of truth, error mapping, rate/limit behavior, privacy boundary, and focused tests.
- Review/signable adapter:
  Needs separate architecture inventory, source refs, state/input/error matrix, object resolution, simulation, and review-state mapping.
  This spec alone is insufficient.

If a protocol record cannot pass the gate for the intended behavior, keep it as
research only.

## Current Promotion Boundary

The product behavior promoted from this research is transaction activity
labeling through `compact.protocolMatches`. This research is not a runtime
registry and not a protocol position read tool.

Current scope constraints:

- The immediate user problem is interpreting recent Sui DeFi transactions:
  called contracts, transaction type, asset flow, gas, failures, and candidate
  protocol surface.
- The implemented activity detail facts already expose Move call
  package/module/function, object changes, event types, raw balance changes, gas,
  and execution errors.
- A registry would be local policy and could imply support before matching rules
  are proven.
- A read tool for positions would require protocol-specific live state reads,
  ownership proofs, pagination rules, and financial unit boundaries. Those
  requirements are not closed by this research spec.

External ecosystem ranking sources such as DeFiLlama can be used only as a
prioritization signal. They are not authority for package IDs, object IDs, Move
interfaces, wallet ownership, balances, liquidity, or execution semantics.

### Diversity-First Selection Rule

Do not choose protocols only by popularity or by how much source material is
already recorded. For classifier and research-model validation, choose
protocols that stress different data shapes:

- one CLOB / order book surface,
- one CLMM / AMM surface,
- one lending market surface,
- one liquid staking surface,
- then one wrapper or advanced trading surface only when the baseline surfaces
  prove the model.

This selection is meant to reduce model bias. A classifier that starts with only
trading protocols can accidentally encode "DeFi activity" as swaps and orders.
That would miss obligations, receipt tokens, interest indices, liquidation risk,
LP positions, delayed unstake state, and reward accounting.

Source signals used for the current selection:

- DeFiLlama Sui rankings and category pages as ecosystem relevance signals.
- Official protocol docs or contract/interface repositories for functional
  shape.
- Existing transaction detail facts in this repository: Move call targets,
  object changes, event types, raw balance changes, gas, and execution errors.

Strategic protocol relationships do not change the evidence bar. When a
strategic protocol overlaps a selected surface assetGroup, include it as a
named fixture and keep the overlap explicit instead of pretending it adds a new
DeFi assetGroup.

### First Promotion Target

The first promotion target is a versioned transaction activity classifier over
stored or live transaction detail facts already available in activity scans. It
must not infer wallet positions, P&L, portfolio exposure, route quality, or
signing readiness.

Current classifier design and implementation boundary note:
`protocols/sui-defi-activity-classifier-spec.md`.

Current diversity seed set plus one strategic fixture:

1. DeepBook V3:
   CLOB/order-book baseline. Existing product work already has read-only DeepBook context.
   Promotion target: classifier rules for package/module/function, pool object, BalanceManager-related calls, and DEEP fee/rebate signals.
   Not promoted yet: new registry entry, signable review, and route recommendation.
2. Cetus CLMM:
   Concentrated-liquidity AMM shape. It tests pool, tick/range, LP position, and fee/reward concepts that CLOBs do not have.
   Promotion target: classifier rules for package calls, pool/table objects, position object changes, and fee/reward events.
   Not promoted yet: position inventory, DCA/farming/limit/vault/xCETUS modules.
3. Suilend Lending:
   Lending-market shape. It tests reserves, obligations, cTokens, borrow/supply, and health/liquidation concepts.
   Promotion target: classifier rules for lending calls, reserve/obligation object changes, and deposit/borrow/repay/liquidation events.
   Not promoted yet: position inventory, interest/APY, health factor, P&L, and liquidation advice.
4. Aftermath afSUI:
   Liquid-staking shape. It tests receipt token, exchange-rate, epoch, stake/unstake, and delayed/instant redemption concepts.
   Promotion target: classifier rules for afSUI event/object/package evidence and vault/treasury object use.
   Direct stake/unstake action labels require callable entrypoint or event-semantics verification.
   Not promoted yet: live exchange-rate read, unstake availability, and staking recommendation.
5. DeepTrade Core:
   Strategic fixture despite CLOB overlap. Existing research covers wrapper fees, FeeManager, DEEP reserve coverage, loyalty, and admin/version gates.
   Promotion target: classifier rules for DeepTrade package calls, fee manager calls, Treasury/TradingFeeConfig objects, reserve coverage, and loyalty/fee signals.
   Not promoted yet: Margin/Earn support, live fee quote, signable adapter, and protocol relationship claims.

Additional classifier candidates:

| Priority | Protocol / surface | Current prerequisite | Promotion target |
| --- | --- | --- | --- |
| 6 | Bluefin Spot | Focused function, event, and object signal evidence. | Classifier rules for spot package calls and event/object signals. |
| 7 | Turbos CLMM/Vault | CLMM plus vault/rewarder evidence that stays separate from the baseline AMM model. | Classifier rules for Turbos package calls, vault/rewarder object use, CLMM position activity. |

### Account-Bound Position Inventory Research

Account-bound position inventory research is separate from registry policy and
separate from transaction activity labeling.

Current candidate set:

| Priority | Protocol / surface | Current prerequisite | Required before read tool |
| --- | --- | --- | --- |
| 1 | Suilend | Main market object/type facts are recorded. | Obligation ownership model, reserve state reads, cToken/share units, interest/price source, pagination. |
| 2 | NAVI Lending | Package API and SDK config package conflict remains open. | Canonical package decision, account/obligation state model, oracle and reserve source, reward units. |
| 3 | Scallop Lending | Lending plus sCoin supplied-asset position model. | Obligation/sCoin ownership model, decimal registry source, market/query package read path. |
| 4 | Aftermath afSUI / Haedal | Liquid-staking receipt-token accounting surface. | Current staking package/object recheck, exchange-rate source, delayed unstake model, receipt token units. |

### Unsupported Promotion Paths

| Path | Current status |
| --- | --- |
| JSON registry | Unsupported by this research spec. Matching rules are not product policy. |
| New protocol-specific MCP read tool | Unsupported by this research spec. Protocol-specific live read source, input schema, error mapping, and account-bound state model are not closed here. Existing transaction activity tools may expose `compact.protocolMatches` labels only. |
| Runtime DB tables for protocol research | Unsupported. Static protocol research is not user-local data. |
| Signable/review adapter | Unsupported. This research boundary is read-only transaction interpretation and inventory planning. |

### Research Status Matrix

| Protocol / surface | Current status | Current constraint |
| --- | --- | --- |
| DeepBook V3 | Diversity seed classifier candidate. | CLOB/order book baseline; existing product context and transaction-level facts can identify package/module/function and BalanceManager-related activity without new live position reads. |
| Cetus CLMM | Diversity seed classifier candidate. | Different from CLOB: CLMM position/range/liquidity/fee concepts are required to avoid a swap-only classifier model. |
| Suilend | Diversity seed classifier candidate and first position-inventory research candidate. | Different from trading: lending obligations, reserves, cTokens, health/liquidation, and interest concepts are user-relevant and structurally distinct. |
| Aftermath afSUI | Diversity seed classifier candidate and liquid-staking inventory research candidate. | Different from CLOB/CLMM/lending: receipt token and exchange-rate accounting tests a separate assetGroup. |
| DeepTrade Core | Strategic fixture in the first classifier pass. | Deep-dive evidence already covers package, core objects, fees, and wrapper semantics. It overlaps the CLOB assetGroup, so the overlap must stay explicit. |
| Bluefin Spot | Focused research, then classifier candidate. | Trading relevance is high, but the current survey only records the spot package and it overlaps the trading assetGroup. Function/event/object signals need a focused pass. |
| Turbos CLMM/Vault | Research backlog. | Similar CLMM assetGroup, with vault/rewarder surfaces that add separate user-state concepts. |
| Kriya CLMM | Research backlog. | Current evidence is SDK-constant based; official contract source authority is weaker than the first CLMM candidate. |
| NAVI Lending | Position-inventory research candidate with an open canonical package conflict. | Package API and SDK config disagree. |
| Scallop Lending | Position-inventory research candidate. | sCoin and obligation state need a separate ownership/unit model. |
| Aftermath AMM | Classifier/position candidate. | AMM package and pool registry are recorded, but routing/farm/perp/dynamic gas surfaces remain separate. |
| Haedal | Research only. | Current package/object IDs are not sufficiently verified in the survey. |

## Normalized Research Record Contract

Each protocol record should be expressible with the following fields before any
runtime use is considered.

| Field | Meaning | Required before implementation |
| --- | --- | --- |
| `protocolId` | Stable local identifier, for example `cetus-clmm` or `navi-lending`. | Yes. |
| `displayName` | Human name. | Yes. |
| `network` | Product network. Public product data must be mainnet-only. | Yes. |
| `evidenceSources` | Official docs, dynamic endpoint, GitHub source, SDK constants, or onchain lookup. | Yes. |
| `verificationStatus` | One of `research_snapshot`, `official_current`, `pinned_sdk_current`, `onchain_verified`, or `conflict_open`. | Yes. |
| `mvrNames` | Verified Move Registry names and their resolved current package IDs, for example `@cetuspackages/clmm -> 0x...`. Keep absent names explicit as `not_verified`, not guessed. | When package names are relevant. |
| `packages` | Current package IDs, published-at IDs, package records for transaction interpretation, and discrepancies. Current package records should reference the matching MVR name when one is verified. Package records for transaction interpretation remain separate from current package claims. | When relevant. |
| `sharedObjects` | Protocol config, registry, pool, market, oracle, version, cap, or vault objects. | When relevant. |
| `activityCategories` | Functional asset groups such as order book, CLMM, lending, LST, margin, vault, fee, rewards. | Yes. |
| `userStateModel` | How user state appears: coin, LP position, obligation, BalanceManager, FeeManager, vault share, sCoin, cToken, or object ownership. | Before any wallet inventory work. |
| `transactionSignals` | Move call packages/modules/functions, event types, object types, balance deltas, and gas/error facts useful for activity analysis. | Before any classifier work. |
| `financialUnits` | Raw amount units, decimals source, bps/scaling constants, share accounting, interest index, price source. | Before user-facing numeric interpretation. |
| `riskModel` | Liquidation, bad debt, oracle, withdrawal delay, slippage, pool/version gate, admin/cap risks. | Before risk or review explanation. |
| `unsupportedSurfaces` | Related protocol surfaces that are known but not verified or not implemented. | Yes. |
| `openQuestions` | Items that must be rechecked before code or registry promotion. | Yes. |

MVR resolves package names and type names. It does not by itself verify shared
objects such as pools, vaults, markets, registries, caps, or per-user state.
Those objects still require protocol docs, official SDK/config sources, or
direct mainnet object inspection.

## Surface AssetGroup Comparison

| Surface assetGroup | Shared concepts | Different concepts to model explicitly | Examples from current survey |
| --- | --- | --- | --- |
| CLOB / order book | Package, pool, base/quote types, order placement, cancellation, settlement, fees, rebates | BalanceManager, Trade Cap, order ID, self-match behavior, maker/taker fee lifecycle | DeepBook V3, DeepTrade Core wrapper |
| CLMM / AMM | Package, pool object/table, tick/sqrt price, liquidity position, fee/reward collection | Position object model, concentrated range math, vault/rewarder overlays, pool registry semantics | Cetus, Turbos, Kriya, Aftermath AMM |
| Lending market | Market/storage object, reserve, obligation, borrow/supply, interest, liquidation, oracle | Obligation ownership, cToken/sCoin/share accounting, e-mode, isolated asset, reward program | NAVI, Scallop, Suilend |
| Liquid staking | Staking package, vault, treasury, exchange-rate state, epoch handling | Receipt token semantics, delayed unstake, validator strategy, referral/treasury state | Aftermath afSUI, Haedal follow-up |
| Margin / leverage | Margin pool, collateral, borrow, risk parameters, conditional orders, liquidation | Health/risk formula, oracle source, funding/interest, liquidation fee, withdrawal limits | DeepBook Margin, DeepTrade Earn/Margin follow-up |
| Fee/reward systems | Fee config, rewarder, protocol fee, storage rebate, loyalty/discount state | Dynamic fee tables, unsettled fee objects, per-user fee managers, reward claim object graph | DeepTrade, Turbos vault, Cetus fee/reward collection |
| Admin/versioning | Version object, registry, cap, timelock, multisig, allowed versions | Upgrade caps vs protocol version gates, disabled versions, governance/staking modules | DeepBook, DeepTrade, Scallop, Suilend |

## Spec Seed Records

These seed records test whether the model handles different protocol shapes. They
are not runtime data and do not imply support. They are examples for validating
the spec shape, not accepted implementation records.

### DeepBook V3

| Field | Value |
| --- | --- |
| `protocolId` | `deepbook-v3` |
| `activityCategories` | CLOB / order book, swap, pool creation, fee/rebate, governance/staking. |
| `verificationStatus` | `conflict_open`: Sui docs list a newer package than the pinned SDK/local registry. |
| `mvrNames` | `@deepbook/core -> 0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e` from the recorded mainnet MVR source. |
| `packages` | See `protocols/sui-defi-mainnet-survey.md`; do not resolve from memory. |
| `sharedObjects` | Registry and pool objects through pinned SDK/local registry path for current tools. |
| `userStateModel` | BalanceManager, open orders, settled balances, locked balances. |
| `transactionSignals` | DeepBook package calls, pool object, balance manager object, order IDs, base/quote balance deltas, DEEP fee/rebate. |
| `financialUnits` | Base/quote lot size, tick size, raw quantities, DEEP fee, rebates. |
| `unsupportedSurfaces` | Signable swap/order review, execution, wallet signing. |

### DeepTrade Core

| Field | Value |
| --- | --- |
| `protocolId` | `deeptrade-core` |
| `activityCategories` | DeepBook wrapper, order book, swap, fee, loyalty, pool creation, admin/versioning. |
| `verificationStatus` | `research_snapshot`: package and core objects recorded from official source material plus direct mainnet object lookup; package also resolved through MVR. |
| `mvrNames` | `@deeptrade/deeptrade-core -> 0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695` from the recorded mainnet MVR source. |
| `packages` | Core package records are in `protocols/deeptrade-core-research.md`. |
| `sharedObjects` | Treasury, TradingFeeConfig, PoolCreationConfig, LoyaltyProgram, MultisigConfig. |
| `userStateModel` | BalanceManager, Trade Cap, FeeManager, FeeManagerOwnerCap, unsettled fee objects. |
| `transactionSignals` | DeepTrade package calls, DeepBook dependency calls, Treasury object, fee manager calls, loyalty/fee events, DEEP and SUI fee deltas. |
| `financialUnits` | DeepBook fee, DeepTrade protocol fee, input coin fee, output coin fee, DEEP reserve coverage fee, bps/scaling constants. |
| `unsupportedSurfaces` | Margin and Earn until DeepBook Margin package/object boundary is verified. |

### Cetus CLMM

| Field | Value |
| --- | --- |
| `protocolId` | `cetus-clmm` |
| `activityCategories` | CLMM / AMM, swap, liquidity position, fee/reward collection. |
| `verificationStatus` | `research_snapshot`: official docs and interface repositories recorded a package and global config objects; package also resolved through MVR. |
| `mvrNames` | `@cetuspackages/clmm -> 0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3` from the recorded mainnet MVR source. |
| `packages` | CLMM published-at package in the survey, matching the verified MVR resolution. |
| `sharedObjects` | Global config object, pools table object. |
| `userStateModel` | CLMM position/liquidity object, coin deltas, fee/reward claim state. |
| `transactionSignals` | Cetus package calls, pool object/table, position object changes, fee/reward events, base/quote deltas. |
| `financialUnits` | Tick index, sqrt price, liquidity, coin amount conversion, fee and reward raw amounts. |
| `unsupportedSurfaces` | DCA, farming, limit order, vault, dividends, xCETUS until separately verified. |

### NAVI Lending

| Field | Value |
| --- | --- |
| `protocolId` | `navi-lending` |
| `activityCategories` | Lending market, oracle, rewards, flash loan, e-mode. |
| `verificationStatus` | `conflict_open`: package API and SDK config package differ in the research snapshot. |
| `packages` | Package API current package and SDK config package are both recorded in the survey. |
| `sharedObjects` | Storage, incentive, price oracle, reserve parent, flashloan config, e-mode registry. |
| `userStateModel` | Account/obligation state, supplied assets, borrowed assets, reward state. |
| `transactionSignals` | Deposit, withdraw, borrow, repay, liquidation, flash loan calls; obligation/reserve object changes; oracle usage. |
| `financialUnits` | Borrow/supply raw amounts, interest index, oracle price, liquidation threshold, reward units. |
| `unsupportedSurfaces` | Bridge, DEX aggregator, DCA, wallet-client package surfaces. |

### Scallop Lending

| Field | Value |
| --- | --- |
| `protocolId` | `scallop-lending` |
| `activityCategories` | Lending market, supplied-asset token, oracle/query package. |
| `verificationStatus` | `research_snapshot`: docs and docs-source package addresses recorded. |
| `packages` | Protocol initial package, query package, sCoin package in the survey. |
| `sharedObjects` | Version object, market object, coin decimal registry, xOracle. |
| `userStateModel` | Obligation state and sCoin supplied-asset position. |
| `transactionSignals` | Supply, withdraw, borrow, repay, liquidation calls; sCoin mint/burn; obligation and reserve changes. |
| `financialUnits` | Raw coin amounts, sCoin amount, borrow/supply index, interest rate, oracle price. |
| `unsupportedSurfaces` | Any surface not covered by the recorded lending protocol package/object set. |

### Aftermath afSUI And AMM

| Field | Value |
| --- | --- |
| `protocolId` | `aftermath-afsui-amm` |
| `activityCategories` | Liquid staking, AMM, LP position, registry, treasury. |
| `verificationStatus` | `research_snapshot`: afSUI and pool contract docs recorded package and object addresses. |
| `packages` | afSUI packages, AMM package, AMM interface package in the survey. |
| `sharedObjects` | stakedSuiVault, stakedSuiVaultState, afSUI treasury, pool registry. |
| `userStateModel` | afSUI receipt token, LP coin/position, pool ownership and fee vault state. |
| `transactionSignals` | afSUI event/object/package evidence, vault and treasury object changes, pool/liquidity calls, and LP coin changes. Direct stake/unstake call labels require callable entrypoint verification. |
| `financialUnits` | SUI/afSUI raw amounts, exchange rate, LP share amount, pool token amounts, fees. |
| `unsupportedSurfaces` | Routing, DCA, limit order, farm, perpetual, dynamic gas until separately verified. |

## Classifier Match Shape

Protocol labels derived from transaction activity must use the versioned
`ProtocolActivityClassifierMatch` shape from
`protocols/sui-defi-activity-classifier-spec.md` and
`src/core/activity/transactionActivityClassifier.ts`. Do not duplicate that
TypeScript shape here; it already defines the current `classifierVersion`,
`primaryAction`, `matchBasis`, package evidence fields such as `packageSource`
and `mvrName`, `relatedProtocols`, and `limitations`.

Rules:

- A package match can identify a candidate protocol, but it must not imply user
  position ownership or portfolio exposure by itself.
- A shared object match can identify the protocol surface used by a transaction,
  but it must not imply all affected assets were user-owned.
- A balance delta can show raw asset flow for a known wallet, but it must not
  produce P&L, valuation, or tax interpretation.
- Position ownership requires a protocol-specific user state model, not just a
  transaction call.

## Acceptance Criteria Before More Research Is Added

Before adding another protocol-specific deep-dive, check that the new record:

- Names the exact product behavior it could support, or states that no behavior
  is proposed yet.
- Fits the normalized research record without adding protocol-only fields to the
  core contract.
- Separates static package/object research from live user position data.
- Separates transaction-level evidence from wallet-level position ownership.
- Marks conflicts between official docs, SDK constants, and onchain state.
- Lists unsupported related surfaces instead of implying broad protocol support.

## Next Research Pass

The next detailed research pass should fill the same fields for Turbos, Kriya,
Suilend, Bluefin Spot, Haedal, Cetus non-CLMM modules, and Aftermath non-afSUI
modules. For each protocol, record:

- The official source used.
- The exact package and object addresses found.
- The user state model.
- The transaction signals that can be recognized from current activity details.
- The financial units and decimals source.
- Unsupported or ambiguous related surfaces.

Do not create runtime storage, JSON policy, new MCP tools, or new MCP output
fields beyond the existing `compact.protocolMatches` label unless this model has
enough verified entries to justify a concrete product behavior.
