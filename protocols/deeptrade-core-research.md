# DeepTrade Core Research Note

Status: GitHub-tracked protocol research note. This file is not an npm package
document, not an MCP resource, not a registry allowlist, not a supported-protocol
list, not a live liquidity source, not a quote source, not a route
recommendation source, not signing readiness, and not a safety guarantee.

Use this note only as a starting point for future read-only attribution,
inventory planning, or adapter design review. Before implementation, verify the
official sources again, inspect all packages and shared objects on Sui mainnet,
and compare the result with the pinned SDK/source path used by this repository.

## Product Boundary

The relevant Sui MCP problem is explaining DeepTrade or DeepBook-based
actions before authorization. DeepTrade Core appears to add fee, reserve,
loyalty, governance, and UI-adjacent surfaces on top of DeepBook. This note does
not add DeepTrade execution, custody, signing, quotes, route selection, or
portfolio support.

Do not merge the DeepBook, DeepBook Margin, and DeepTrade Core package/object
boundaries. If a user transaction calls a DeepTrade package, the review or
analysis layer must still verify the exact package, module, function, objects,
fees, and account-bound effects from live data.

## Research Sources

- DeeptradeProtocol GitHub organization.
- DeeptradeProtocol/deeptrade-core README.
- DeeptradeProtocol/deeptrade-core `Move.toml`.
- DeeptradeProtocol/deeptrade-core examples/constants.
- DeeptradeProtocol/deeptrade-core fee design, treasury DEEP reserve, unsettled
  fee, loyalty, oracle pricing security, versioning, and admin docs.
- DeepTrade web app surfaces: Trade, Earn, Migration, and Create Pool.
- Direct Sui mainnet object lookup. This was evidence collection only and is not
  a Sui MCP runtime path.

## Summary

DeepTrade Core is not an independent AMM in this research snapshot. It is a
protocol suite that wraps DeepBook order book actions and adds DeepTrade protocol
fees, DEEP reserve coverage fees, per-user FeeManager state, unsettled fee
settlement, loyalty discounts, oracle-secured DEEP/SUI pricing, and
multisig/timelock administration.

The DeepTrade app also exposes Margin, Swap, Earn, Create Pool, and Migration
surfaces. Earn and Margin appear connected to DeepBook Margin infrastructure,
but this research did not prove a separate DeepTrade margin package. Treat those
as follow-up verification targets.

## GitHub Surfaces

| Surface | Repository |
| --- | --- |
| DeepTrade Core | `https://github.com/DeeptradeProtocol/deeptrade-core` |
| Multisig dependency | `https://github.com/DeeptradeProtocol/multisig-move` |
| DeepBook fork/reference | `https://github.com/DeeptradeProtocol/deepbookv3` |
| Pyth fork/reference | `https://github.com/DeeptradeProtocol/pyth-crosschain` |
| Sui client generator fork | `https://github.com/DeeptradeProtocol/sui-client-gen` |
| Congestion helper | `https://github.com/DeeptradeProtocol/congestion-helper` |

The research pass did not confirm a separate official `profit-sharing-contract`
repository in the DeeptradeProtocol organization. Do not treat search results
alone as an official deployment surface.

## Package Records

The DeepTrade Core README lists multiple package IDs. The last address below was
also present in examples/constants and was verified by direct mainnet object
lookup during the research pass.

Recorded MVR source: `@deeptrade/deeptrade-core` resolved through
`https://mainnet.mvr.mystenlabs.com/v1/resolution/bulk` to
`0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695`. Use that
MVR name as the current package lookup source. Keep the additional package
records below only for transaction interpretation and upgrade analysis.

| Label | Address |
| --- | --- |
| Current examples/constants package and direct object lookup package | `0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695` |
| README package list | `0x1271ca74fee31ee2ffb4d6373eafb9ada44cdef0700ca34ec650b21de60cc80b` |
| README package list | `0xd7ca30ad715278a28f01c572ac7be3168e9800321f1b3f96eb9d13dfc856419c` |
| README package list | `0xc6fa96e203d7858e1925563bdc2c75d1c2ff57af90cad46a7ad3364573e20fb0` |
| README package list | `0x90cffe4f0670e0c4d3413c124c364301fc0e73c709ada13ba86f2398c44a135a` |
| README package list | `0x55febc53366b6ced945b1adf5ebd3f8628d940664782e51937cc93513ad83339` |
| README package list | `0x4af08dd22015fdabeae5f2b883dca9fca4f7de88434dae7cea712d247658b68d` |
| README package list | `0x208d664e59ad391212a11ad8658d0e9d7510c6cd1785bd0d477d73505d5c89b1` |
| README package list | `0xc49f720f4e8427cbd3955846ca9231441dab8ccda6c3da6e9d44ed6f9dcf865c` |
| README package list | `0x2356885eae212599c0c7a42d648cc2100dedfa4698f8fc58fc6b9f67806f2bfc` |
| README package list | `0x03aafc54af513d592bcb91136d61b94ea40b0f9b50477f24a3a9a38fca625174` |
| README package list | `0x232b6dccf004919ce5deb1a7ee3d0e9f1c71170c9402ec1918aa212754baadb3` |

## Core Objects

Objects verified by direct mainnet lookup during the research pass:

| Surface | Address | Observed fact |
| --- | --- | --- |
| DeepTrade Core package | `0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695` | Package object, immutable owner. |
| AdminCap | `0xe92f79ac54409c9eecfd77ce1089edd9b424b87c6cba8aa99c8fedb64d0e0b8b` | `::admin::AdminCap`, address-owned. |
| Treasury | `0xb90e2d3de41817016b7d39f49c724c5b0616bd30f1d5e6383048efafabe6232b` | Shared `::treasury::Treasury`, `allowed_versions=[1]` at lookup time. |
| UpgradeCap | `0x331c41b3587619223c8ccf44b2aa9ad683fae7b536d6b5ed96fc94fe9a8d4278` | `0x2::package::UpgradeCap`, package field pointed to the current Core package. |
| PoolCreationConfig | `0xe6a7158cbbee252f2ef9488663d91b42d84b3933609c3f891937240f4be65086` | Shared `::dt_pool::PoolCreationConfig`, `protocol_fee=100000000` raw DEEP at lookup time. |
| TradingFeeConfig | `0xcb757e55db3a502dc826c40b8ced507d017b41d926c5bf554e69855510bb855e` | Shared `::fee::TradingFeeConfig`, pool-specific fee table size `6` at lookup time. |
| LoyaltyProgram | `0x6a06100001533356fb2e9f68ee299c15565777dfb28c741ec440cb08b168cbff` | Shared `::loyalty::LoyaltyProgram`, level table size `0` at lookup time. |
| LoyaltyAdminCap | `0xdbd798144ab62ec0a47634ca01c53464327f35f04f44a443fbceadfd1ab59b4a` | Shared `::loyalty::LoyaltyAdminCap`, inner owner observed as `0xed7e...9d52`. |
| MultisigConfig | `0x1c5ed495552bb63cc46bf513a577b9e63c8f1cc7f9f472109a86f6d0a660e8a4` | Shared `::multisig_config::MultisigConfig`, initialized, threshold `3`, weights `[1,1,1,1,1]` at lookup time. |
| MultisigAdminCap | `0x28137b5c913874f74615def7237243d066f52d6199dda8672f0e74daafa0951e` | `::multisig_config::MultisigAdminCap`, address-owned. |

Dynamic values such as reserve balances, fee bag sizes, loyalty level count,
object versions, and table contents are lookup-time state. Re-query before using
them in a product decision.

## Dependency Boundary

DeepTrade Core `Move.toml` depends on `MystenLabs/deepbookv3`, subdir
`packages/deepbook`, rev `v3.0.0`.

Package disassembly in the research pass showed the DeepTrade order module
importing DeepBook modules such as `balance_manager`, `constants`, `order_info`,
and `pool` from package
`0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809`.

That dependency may differ from this repository's local DeepBook registry and
from the current Sui docs DeepBook package. A DeepTrade adapter or protocol
classifier must first decide which exact DeepBook package, pool object, and
BalanceManager semantics the transaction path uses.

## Functional Surfaces

### Order

Core module `dt_order` wraps DeepBook order placement:

- `create_limit_order`
- `create_market_order`
- `create_limit_order_whitelisted`
- `create_market_order_whitelisted`
- `create_limit_order_input_fee`
- `create_market_order_input_fee`
- `cancel_order_and_settle_fees`

Research notes:

- DeepTrade order fees are split between DeepBook fees and DeepTrade protocol
  fees.
- DeepBook fees can be handled through DEEP or through the input coin fee type.
- Expiration-time orders are not supported because of the unsettled fee design.
- Self-matching paths that imply cancellation, such as cancel-maker or
  cancel-taker, are not supported.
- Order modification is not currently allowed.
- Cancelling from outside DeepTrade may prevent DeepTrade from computing unfilled
  maker fee returns after the fact.

### Swap

Core module `swap` exposes input-coin-fee swap paths:

- `swap_exact_base_for_quote_input_fee`
- `swap_exact_quote_for_base_input_fee`
- `get_quantity_out_input_fee`

Research notes:

- DeepTrade swap currently uses input coin fee type in the recorded docs.
- Swap protocol fee is deducted from output coin and may receive a loyalty
  discount.
- The unsettled fee system is mainly a limit-order surface; swap fees move
  directly to the Treasury.

### DEEP Reserve Coverage

DeepTrade Treasury can provide DEEP reserve coverage when a user lacks enough
DEEP for a DeepBook fee. The user pays a SUI-based coverage fee for that reserve
coverage.

Any review or activity analysis must separate:

- User-provided DEEP from wallet or BalanceManager.
- Treasury-provided DEEP reserve.
- SUI-paid DEEP reserve coverage fee.
- DeepTrade protocol fee.
- DeepBook fee.

Oracle security notes in the source material distinguish Pyth DEEP/USD, Pyth
SUI/USD, and DeepBook reference pool pricing. Freshness and confidence interval
requirements were documented in the source material, but must be rechecked
before implementation.

### FeeManager And Unsettled Fees

DeepTrade uses per-user `FeeManager` state to avoid concentrating fee state in a
single global shared object.

Observed surface:

- `fee_manager::new`
- `share_fee_manager`
- `settle_filled_order_fee_and_record`
- `settle_protocol_fee_and_record`
- `finish_protocol_fee_settlement`
- `claim_user_unsettled_fee_storage_rebate`
- `claim_protocol_unsettled_fee_storage_rebate`

Research notes:

- Limit order maker portions can create `UserUnsettledFee`.
- IOC/FOK paths do not leave resting maker portions and should not create
  `UserUnsettledFee`.
- GTC orders can mix immediate taker execution and resting maker portions; only
  the maker portion is relevant to unsettled fee state.
- On cancellation, unfilled fees return to the user and filled portions can move
  into protocol unsettled fee state.
- Fully filled or externally finalized order fees may require permissionless
  settlement into protocol treasury.

### TradingFeeConfig

Contract source default constants and the current onchain `TradingFeeConfig`
object are separate. Source constants are initial values. The shared config
object is live state that can change through admin operations.

Observed values at lookup time:

| Field | Raw value | Meaning in source material |
| --- | ---: | --- |
| `deep_fee_type_taker_rate` | `600000` | 6 bps. |
| `deep_fee_type_maker_rate` | `400000` | 4 bps. |
| `input_coin_fee_type_taker_rate` | `500000` | 5 bps. |
| `input_coin_fee_type_maker_rate` | `300000` | 3 bps. |
| `max_deep_fee_coverage_discount_rate` | `250000000` | 25%. |

Source-level validation notes:

- Fee precision multiple: `1000` raw.
- Max taker fee rate: `2000000` raw, 20 bps.
- Max maker fee rate: `1000000` raw, 10 bps.
- Max discount: `1000000000` raw, 100%.

### Loyalty

The `loyalty` module manages user levels for protocol fee discounts.

Research notes:

- Level structure changes and `LoyaltyAdminCap` owner changes are
  multisig-protected admin operations.
- Granting or revoking an individual user's level is performed by the
  `LoyaltyAdminCap` owner.
- A user can have one loyalty level at a time.
- A level cannot be removed while members remain.

### Pool Creation

Core module `dt_pool` wraps DeepBook permissionless pool creation:

- `create_permissionless_pool`
- `update_pool_creation_protocol_fee`
- `pool_creation_protocol_fee`

Research notes:

- DeepTrade protocol creation fee is separate from DeepBook pool creation fee.
- The source default protocol fee is `100 * DEEP_SCALING_FACTOR`.
- The source max protocol fee is `500 * DEEP_SCALING_FACTOR`.
- The observed `PoolCreationConfig.protocol_fee` was `100000000` raw DEEP at
  lookup time.

The DeepTrade web Create Pool surface asks for base coin, quote coin, tick size,
lot size, minimum size, and total fee in DEEP.

## Admin, Timelock, And Versioning

DeepTrade Core separates administrative capability:

- `AdminCap`: version management, loyalty level structure, storage rebate
  cleanup, timelocked withdrawal, and fee configuration operations.
- `LoyaltyAdminCap`: individual user loyalty level grant/revoke operations.

Timelock notes from the source material:

- Ticket delay: 2 days.
- Ticket active duration: 3 days.
- Timelocked operations include DEEP reserve withdrawal, protocol fee
  withdrawal, coverage fee withdrawal, pool creation fee update, default trading
  fee update, and pool-specific trading fee update.

Versioning notes:

- Source `helper.move` `CURRENT_VERSION` was `1` in the research pass.
- The observed Treasury `allowed_versions` was `[1]`; `disabled_versions` was
  `[]`.
- GitHub release tags, Move package manifest versions, onchain protocol
  `CURRENT_VERSION`, and Sui package object versions are different concepts.

## Web App Surfaces

Observed app menus:

- Trade: DeepBook-based order book trading UI.
- Margin: appears to use DeepBook Margin infrastructure, but the research did
  not confirm a separate DeepTrade margin contract package.
- Swap: DeepBook-based swap UI.
- Earn: described as supplying assets to DeepBook margin pools to receive
  borrower interest and part of liquidation fees.
- Create Pool: DeepBook pool creation surface.
- Migration: creates a Trade Cap so a BalanceManager created elsewhere can be
  discoverable in DeepTrade.
- Competition, Leaderboard, and token material were observed as UI/product
  surfaces but are not treated as Core contract support surfaces.

Earn material included smart-contract risk, bad-debt scenarios, withdrawal delay
when unborrowed liquidity is insufficient, and overheated pool waiting states.
Sui MCP must not guarantee APR or withdrawability from these static notes.
Those values require live margin pool state.

## Integration Checklist

Before any DeepTrade implementation or automatic classifier:

- Determine whether the user action is DeepBook native, DeepTrade Core wrapper,
  or DeepBook Margin.
- Verify the target package and Treasury `allowed_versions` on Sui mainnet.
- Verify the target pool object and type parameters against both DeepTrade fee
  semantics and DeepBook pool semantics.
- Model user BalanceManager, Trade Cap, FeeManager, and FeeManagerOwnerCap
  relationships explicitly.
- Separate DEEP fee type, input coin fee type, and whitelisted pool paths.
- Separate user-provided DEEP, reserve-provided DEEP, SUI coverage fee, protocol
  fee, DeepBook fee, and output-coin swap fee as distinct raw amounts.
- Verify oracle/Pyth price freshness, confidence interval, feed identifiers, and
  reference pool price source before presenting any fee or reserve coverage
  analysis.
- Identify whether an order can create unsettled fee state and whether
  cancellation, settlement, or rebate-claim paths are required.
- Treat external cancellation, unsupported self-matching paths, expiration, and
  modification as unsupported until the fee settlement implications are proven.
- Treat Margin and Earn surfaces as requiring DeepBook Margin package and
  registry verification unless proven otherwise.

## Open Follow-Up

- Current transaction targets for DeepTrade web Margin.
- Current pool registry, supported assets, pool object IDs, APR source, and
  withdraw-limit source for DeepTrade Earn.
- Whether a newer GitHub release changed package or object state after the
  recorded snapshot.
- Whether MVR package info has publish metadata beyond app metadata.
- Current dynamic-field contents of the pool-specific fee table.
- Whether DeepTrade publishes an official profit-sharing contract under a
  different repository or package name.
