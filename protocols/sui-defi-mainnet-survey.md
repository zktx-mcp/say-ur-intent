# Sui DeFi Mainnet Contract Survey

Status: GitHub-tracked protocol research note. This file is not an npm package
document, not an MCP resource, not a registry allowlist, not a supported-protocol
list, not a live liquidity source, not a quote source, not a route
recommendation source, not signing readiness, and not a safety guarantee.

Use this note as a starting point for transaction-activity interpretation and
future read-only inventory planning. Before any entry is used in a registry,
adapter, signable review path, or user-facing support claim, re-check the
official protocol source, verify the connected chain identifier is Sui mainnet,
inspect the package or object onchain, and compare the result with the pinned
SDK/source that this repository actually uses.

For the normalized research shape, promotion gates, and cross-protocol comparison
matrix, see `protocols/sui-defi-research-spec.md`. For the first transaction
activity classifier candidate rules, see
`protocols/sui-defi-activity-classifier-spec.md`.

## Current Product Boundary

Current transaction activity tools may expose called Move packages, modules,
functions, raw balance changes, object changes, events, gas facts, execution
errors, and conservative `compact.protocolMatches` labels from user-requested
bounded scans. This research note can help a human or agent review the evidence
behind those labels. It does not add wallet position discovery, staked or LP
inventory, route comparison, payment readiness, transaction building, signing,
or execution.

`compact.protocolMatches` is a transaction activity label only. It is not a
supported-protocol list, protocol registry, shared-object verification, wallet
position inventory, P&L, route quality, transaction-building input, signing
data, or signing readiness.

## Source Priority

1. Verified Move Registry name resolution for current package IDs when the
   protocol has an official or otherwise verified MVR name.
2. Official protocol documentation or official dynamic config endpoint.
3. Official Move contract, interface, or SDK GitHub repository.
4. Published SDK constants only when the protocol points developers to that SDK.

When a current package or object address is not exposed by a directly
verifiable source, this note marks the gap instead of filling it from memory.
MVR resolves packages and types; it does not replace shared object verification
for pools, vaults, market objects, registries, caps, or per-user state.

## MVR Resolution Source

Resolution source: direct POST to `https://mainnet.mvr.mystenlabs.com/v1/resolution/bulk`.

| MVR name | Resolved current package | Survey use |
| --- | --- | --- |
| `@deepbook/core` | `0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e` | Pinned SDK/local registry DeepBook package. The newer Sui docs package remains a conflict until reconciled deliberately. |
| `@deeptrade/deeptrade-core` | `0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695` | DeepTrade Core current package. |
| `@cetuspackages/clmm` | `0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3` | Cetus CLMM current package. |
| `@suilend/core` | `0xe53906c2c058d1e369763114418f3c144d1b74960d29b2785718a782fec09b61` | Suilend current MVR package; the recorded market type package remains separate evidence. |
| `@cetuspackages/dlmm` | `0x42e80880109d67373e4c7ca1dd4d148dcc71ae7354b2e07f642165bc32ac472d` | Recorded as future Cetus non-CLMM evidence only; not used by the first classifier pass. |
| `@cetuspackages/dca` | `0xcf80e234b4b19afedf71817bb2325b34624b8aeebfd50e635f94181cffc08504` | Recorded as future Cetus non-CLMM evidence only; not used by the first classifier pass. |

The same probe did not resolve the guessed names `@deeptrade/core`,
`@aftermath/afsui`, `@aftermath/aftermath`, `@aftermath/staking`,
`@aftermath/liquid-staking`, or `@aftermath-finance/afsui`. Do not add an MVR
name for those surfaces without a verified source or a successful resolution.

## Snapshot Maintenance

This survey records source snapshot status for transaction activity labels only.
It is not a supported-protocol inventory and does not create runtime registry
authority. Treat package addresses below as static reviewed snapshots until a
deliberate refresh compares current MVR resolution, historical package IDs, and
the source material named in each row.

MVR current package resolution is package provenance, not a freshness guarantee
for future labels. Shared objects require separate source or mainnet object
verification because MVR does not verify registries, pools, vaults, markets,
caps, or protocol configuration objects. Changing a package, shared object,
source note, or label claim must be paired with classifier docs/tests before it
is treated as current activity-label evidence.

## Survey Table

### DeepBook V3 and DeepBook Margin

Research sources:

- Sui DeepBook V3 contract information.
- Sui DeepBook Margin contract information.
- MystenLabs DeepBook source.
- This repository's pinned `@mysten/deepbook-v3@1.3.6` snapshot.

Mainnet addresses recorded in the research snapshot:

| Surface | Address | Source note |
| --- | --- | --- |
| DeepBook V3 MVR current package | `0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e` | `@deepbook/core`, recorded mainnet MVR resolution. |
| DeepBook V3 current package, version 6 | `0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497` | Sui docs current version in the recorded source material. |
| DeepBook V3 registry | `0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d` | Sui docs. |
| DeepBook Margin current package, version 3 | `0xfbd322126f1452fd4c89aedbaeb9fd0c44df9b5cedbe70d76bf80dc086031377` | Sui docs current version in the recorded source material. |
| DeepBook Margin registry | `0x0e40998b359a9ccbab22a98ed21bd4346abf19158bc7980c8291908086b3a742` | Sui docs. |

Important repository discrepancy: `registry/generated/deepbook-mainnet.json` and
the installed `@mysten/deepbook-v3@1.3.6` snapshot still use
`DEEPBOOK_PACKAGE_ID = 0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e`.
The current read tools follow the pinned SDK/local registry path. Do not make a
new DeepBook execution or registry assumption from the newer documentation
address until the pinned SDK and local registry are deliberately reconciled.

Surfaces identified by the research snapshot:

- DeepBook V3: central limit order book pool, limit order, market order, order
  modification, cancellation, settled amount withdrawal, orderbook read, quote
  quantity read, swap, rebate, referral, permissionless pool creation, flash
  loan entry point in the pinned SDK, governance and staking entry points.
- DeepBook Margin: leveraged position, borrow, margin pool, supplier deposit,
  collateral and risk parameters, interest accrual, conditional order, and
  liquidation mechanism.

### DeepTrade Core

DeepTrade has a separate tracked deep-dive note in
`protocols/deeptrade-core-research.md`.

Research sources:

- DeeptradeProtocol GitHub organization.
- DeeptradeProtocol/deeptrade-core README, examples, and docs.
- DeepTrade web app.
- Direct Sui mainnet object lookup. This was evidence collection only and is not
  a Sui MCP runtime path.

Mainnet addresses recorded in the research snapshot:

| Surface | Address | Source note |
| --- | --- | --- |
| DeepTrade Core current package | `0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695` | `@deeptrade/deeptrade-core`, recorded mainnet MVR resolution; official examples/constants and direct mainnet object lookup. |
| Treasury object | `0xb90e2d3de41817016b7d39f49c724c5b0616bd30f1d5e6383048efafabe6232b` | Shared `::treasury::Treasury`; `allowed_versions=[1]` at lookup time. |
| AdminCap | `0xe92f79ac54409c9eecfd77ce1089edd9b424b87c6cba8aa99c8fedb64d0e0b8b` | README and direct object lookup. |
| UpgradeCap | `0x331c41b3587619223c8ccf44b2aa9ad683fae7b536d6b5ed96fc94fe9a8d4278` | README and direct object lookup. |
| PoolCreationConfig | `0xe6a7158cbbee252f2ef9488663d91b42d84b3933609c3f891937240f4be65086` | Shared `::dt_pool::PoolCreationConfig`. |
| TradingFeeConfig | `0xcb757e55db3a502dc826c40b8ced507d017b41d926c5bf554e69855510bb855e` | Shared `::fee::TradingFeeConfig`. |
| LoyaltyProgram | `0x6a06100001533356fb2e9f68ee299c15565777dfb28c741ec440cb08b168cbff` | Shared `::loyalty::LoyaltyProgram`. |
| LoyaltyAdminCap | `0xdbd798144ab62ec0a47634ca01c53464327f35f04f44a443fbceadfd1ab59b4a` | Shared `::loyalty::LoyaltyAdminCap`. |
| MultisigConfig | `0x1c5ed495552bb63cc46bf513a577b9e63c8f1cc7f9f472109a86f6d0a660e8a4` | Shared `::multisig_config::MultisigConfig`, threshold `3` at lookup time. |
| MultisigAdminCap | `0x28137b5c913874f74615def7237243d066f52d6199dda8672f0e74daafa0951e` | Direct object lookup. |

Surfaces identified by the research snapshot:

- DeepBook order book wrappers: limit order, market order, whitelisted order,
  input-coin-fee order, cancellation, and fee settlement.
- Input coin fee swaps and output coin protocol fee handling.
- DEEP fee abstraction across user DEEP, BalanceManager DEEP, Treasury DEEP
  reserve, and SUI-paid DEEP reserve coverage fee.
- Per-user FeeManager, unsettled maker fees, protocol fee settlement, storage
  rebate claim.
- Dynamic taker and maker protocol fees, loyalty discounts, permissionless
  DeepBook pool creation wrapper, protocol creation fee, multisig, timelock, and
  version allowlist administration.

The DeepTrade app also shows Margin and Earn surfaces. The research snapshot
does not prove those are supported by DeepTrade Core alone; they may require
DeepBook Margin package and registry verification.

### Cetus

Research sources:

- Cetus CLMM contract docs and getting-started docs.
- Cetus CLMM interface GitHub.
- Cetus CLMM SDK GitHub.
- Cetus contracts GitHub.

Mainnet addresses recorded in the research snapshot:

| Surface | Address | Source note |
| --- | --- | --- |
| CLMM current package | `0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3` | `@cetuspackages/clmm`, recorded mainnet MVR resolution; Cetus CLMM docs, MVR version 14. |
| CLMM global config object | `0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f` | Cetus getting-started docs. |
| CLMM pools table object | `0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0` | Cetus getting-started docs, mainnet tab. |

Surfaces identified by the research snapshot:

- Concentrated liquidity market maker pool.
- Swap, pool data read, position and liquidity management, fee and reward
  collection, liquidity math, tick math, sqrt price math, and coin amount
  conversion helpers.
- DCA, limit order, farming, vaults, LP burn, dividends, and xCETUS interfaces
  exist in related repositories, but this note does not claim current mainnet
  package addresses for those modules.

### Turbos

Research sources:

- Turbos SDK contract config endpoint.
- Turbos CLMM SDK GitHub.
- Turbos Sui Move interface GitHub.
- Turbos via-contract getting-started docs.

Mainnet addresses recorded from the official contract config endpoint:

| Surface | Address |
| --- | --- |
| PackageId | `0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64` |
| PackageIdOriginal | `0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1` |
| PoolConfig | `0xc294552b2765353bcafa7c359cd28fd6bc237662e5db8f09877558d81669170c` |
| Positions | `0xf5762ae5ae19a2016bb233c72d9a4b2cba5a302237a82724af66292ae43ae52d` |
| Versioned | `0xf1cf0e81048df168ebeb1b8030fad24b3e0b53ae827c25053fff0779c1445b6f` |
| PoolTableId | `0x08984ed8705f44b6403705dc248896e56ab7961447820ae29be935ce0d32198b` |
| VaultPackageId | `0x0ca0dbe2da5ea7c7b0d0d0796e7918413f9328c4e4bf72e2f6bcd8bf3c993c45` |
| VaultGlobalConfig | `0x2994c75a2ab419adfe16e143bf45ad44c3a5ccfc07c8fe8e31f7c883c8d84c2b` |
| VaultRewarderManager | `0xd6f48ae5fb5c5b8404d6611edab042254b95f22c24499099026c8740ae73d2f8` |
| AclConfig | `0x0302b15f040b008a1bc011cd85231605299ceaac2f9699e4e826ade0a61f3fbe` |

Surfaces identified by the research snapshot:

- CLMM DEX modules for contract, trade, pool, position, account, and math.
- Swap result computation and swap transaction construction in protocol SDK
  material. This note does not make that transaction construction available in
  Sui MCP.
- Pool config and fee read, position and liquidity operations, vault and
  rewarder surfaces.

### Kriya

Research sources:

- Kriya CLMM SDK functions docs.
- Published `kriya-v3-sdk` package.
- Published SDK constants from `kriya-v3-sdk@2.0.23`.

Mainnet addresses recorded from `kriya-v3-sdk@2.0.23` constants:

| Surface | Address |
| --- | --- |
| `ModuleConstants.packageId` | `0xbd8d4489782042c6fafad4de4bc6a5e0b84a43c6c00647ffd7062d1e2bb7549e` |
| `ModuleConstants.publishedAt` | `0xf6c05e2d9301e6e91dc6ab6c3ca918f7d55896e1f1edd64adc0e615cde27ebf1` |
| ACL object | `0x4b1ba97539f6b318cc4dc633a51ed00ea4a81267451d09c887e605f442b18cc9` |
| Global config object | `0x894169fc766e4ed899691c049034a01124e74164a99de117425992fd28a05399` |
| Version object | `0xf5145a7ac345ca8736cf8c76047d00d6d378f30e81be6f6eb557184d9de93c78` |
| Slippage check package | `0x7da285c2233a9479f27f5129b3c6e529642119841b999f928c719f39c7d45342` |

The research pass did not confirm an official Kriya contract GitHub repository.
Treat these SDK constants as integration clues only, not as signing or registry
policy authority.

Surfaces identified by the research snapshot:

- CLMM pool read and swap functions.
- Liquidity and position operations.
- Tick, sqrt price, and liquidity math helpers.

### NAVI Protocol

Research sources:

- NAVI developer docs.
- NAVI package API.
- NAVI config API for production SDK config.
- NAVI monorepo lending package.
- Legacy NAVI SDK GitHub.

Mainnet addresses recorded in the research snapshot:

| Surface | Address | Source note |
| --- | --- | --- |
| Package API current package | `0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb` | NAVI package API. |
| SDK config package | `0x81c408448d0d57b3e371ea94de1d40bf852784d3e225de1e74acab3e8395c18f` | NAVI config API for `env=prod&sdk=1.0.6`; package API marks this version outdated. |
| Storage object | `0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe` | Config API. |
| Incentive V3 object | `0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80` | Config API. |
| Price oracle object | `0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef` | Config API. |
| Reserve parent object | `0xe6d4c6610b86ce7735ea754596d71d72d10c7980b5052fc3c8cdf8d09fea9b4b` | Config API. |
| Flashloan config object | `0x3672b2bf471a60c30a03325f104f92fb195c9d337ba58072dce764fe2aa5e2dc` | Config API. |
| E-mode registry package | `0xe98ff1aab2414aa2e60d0561284d011b3c486d47313b51700a2691ad4d37b162` | Config API. |
| E-mode registry object | `0xe0f80dc29181b193ba5ca4e97e2ec5eac1bfc46abb64c1c096281908ce4384e4` | Config API. |

The package API and SDK config API disagree about the package value. Any NAVI
integration must first decide which source is canonical for the chosen SDK and
transaction surface.

Surfaces identified by the research snapshot:

- Lending deposit, withdraw, borrow, repay, liquidation, account management,
  pool operation, rewards, flash loan, oracle and price feed read, and e-mode
  configuration.
- NAVI bridge, DEX aggregator, DCA, and wallet-client packages are separate from
  the lending package surface recorded here.

### Scallop

Research sources:

- Scallop mainnet package address docs.
- Scallop docs source for mainnet addresses.
- Scallop lending protocol GitHub.

Mainnet addresses recorded in the research snapshot:

| Surface | Address |
| --- | --- |
| Version object | `0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7` |
| Market object | `0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9` |
| Coin decimal registry object | `0x200abe9bf19751cc566ae35aa58e2b7e4ff688fc1130f8d8909ea09bc137d668` |
| xOracle object | `0x93d5bf0936b71eb27255941e532fac33b5a5c7759e377b4923af0a1359ad494f` |
| Protocol initial package ID | `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf` |
| Query package | `0xbd4f1adbef14cf6ddf31cf637adaa7227050424286d733dc44e6fd3318fc6ba3` |
| Scoin package id | `0x80ca577876dec91ae6d22090e56c39bc60dce9086ab0729930c6900bc4162b4c` |

Surfaces identified by the research snapshot:

- Over-collateralized lending market.
- Supply, withdraw, borrow, repay, obligation, liquidation, reserve, and
  interest-rate surfaces.
- sCoin supplied-asset positions.
- Oracle and query packages for protocol state reads.

### Suilend

Research sources:

- Suilend SDK types reference.
- Suilend contract GitHub.

Mainnet addresses recorded in the research snapshot:

| Surface | Address |
| --- | --- |
| MVR current package (`@suilend/core`) | `0xe53906c2c058d1e369763114418f3c144d1b74960d29b2785718a782fec09b61` |
| Main market object | `0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1` |
| Main market type package | `0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf` |
| Main market owner cap | `0xf7a4defe0b6566b6a2674a02a0c61c9f99bd012eed21bc741a069eaa82d35927` |

Surfaces identified by the research snapshot:

- Money market lending: deposit, withdraw, borrow, repay, liquidation, and
  reward event surfaces.
- Reserve, obligation, obligation owner cap, fee receiver, cToken mint/redeem,
  interest update, isolated asset, and risk configuration.
- SpringSui and STEAMM are separate product surfaces and are not implied by the
  main market addresses above.

### Aftermath Finance

Research sources:

- Aftermath afSUI contract docs.
- Aftermath pool contract docs.
- Aftermath TypeScript SDK GitHub.

Mainnet addresses recorded in the research snapshot:

| Surface | Address |
| --- | --- |
| afSUI liquid staking/events package | `0x7f6ce7ade63857c4fd16ef7783fed2dfc4d7fb7e40615abdb653030b76aef0c6` |
| afSUI package | `0x1575034d2729907aefca1ac757d6ccfcd3fc7e9e77927523c06007d8353ad836` |
| stakedSuiVault object | `0x2f8f6d5da7f13ea37daa397724280483ed062769813b6f31e9788e59cc88994d` |
| stakedSuiVaultState object | `0x55486449e41d89cfbdb20e005c1c5c1007858ad5b4d5d7c047d2b3b592fe8791` |
| afSUI treasury object | `0xd2b95022244757b0ab9f74e2ee2fb2c3bf29dce5590fa6993a85d64bd219d7e8` |
| AMM package | `0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c` |
| AMM interface package | `0x0625dc2cd40aee3998a1d6620de8892964c15066e0a285d8b573910ed4c75d50` |
| Pool registry object | `0xfcc774493db2c45c79f688f88d28023a3e7d98e4ee9f48bbf5c7990f651577ae` |

Surfaces identified by the research snapshot:

- afSUI liquid staking: stake, unstake, exchange-rate read, epoch handling,
  referral, and treasury components.
- The first transaction activity classifier pass uses the afSUI package rows
  only for event/object/package evidence until callable entrypoints are
  verified.
- AMM pool, liquidity provider position, pool registry, protocol fee vault,
  treasury, insurance fund, and LP coin table.
- Routing, DCA, limit order, farm, perpetual, and dynamic gas surfaces require
  separate package and object verification.

### Bluefin Spot

Research sources:

- Bluefin Spot contract interface GitHub.
- Bluefin GitHub organization.

Mainnet address recorded in the research snapshot:

| Surface | Address |
| --- | --- |
| Bluefin Spot onchain contract package | `0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267` |

Surface identified by the research snapshot:

- Sui Move contract interface for Bluefin spot protocol integration.

The broader Bluefin material covers spot, perpetuals, and lending, but this
entry only records the spot contract interface package above.

## Partial Follow-Up Targets

| Protocol | Research snapshot fact | Follow-up needed |
| --- | --- | --- |
| Haedal | Official docs and app describe SUI liquid staking and haSUI output. The official GitHub organization is `haedallsd`, and a Move interface repository exists. | Verify the current mainnet staking package and object IDs through official docs, SDK, Move Registry, and onchain package metadata. |
| Cetus non-CLMM modules | The official interface repository lists DCA, farming, limit order, vault, LP burn, dividends, and xCETUS integration surfaces. | Resolve current mainnet packages through Move Registry before use. |
| Aftermath non-afSUI/non-AMM modules | Product docs describe routing, DCA, limit order, farm, perpetual, and dynamic gas. | Verify each product's current mainnet package and object IDs separately. |

## Implementation Rules For Future Work

- Do not add adapters, registry entries, or MCP tools from this note alone.
- Re-query official sources and onchain state immediately before implementation.
- Compare official docs with the pinned SDK/source used by this repository. If
  they disagree, document the discrepancy and choose the source that matches the
  implementation path.
- Treat decimals, raw amounts, display amounts, quotes, slippage, fees, borrow
  amounts, supply shares, LP positions, liquidation values, and reward quantities
  as financial data with explicit source, unit, and precision boundaries.
- Keep account-independent planning separate from account-bound review. Do not
  put wallet balances, gas checks, coin selection, transaction simulation, or
  wallet-specific checks into account-independent plans.
