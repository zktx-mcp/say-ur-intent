# Say Ur Intent

**JUST SAY "CONNECT WALLET."**

Say Ur Intent is a local-first Sui review and evidence layer for AI clients.

It turns a supported AI-requested Sui action into a local review page where the
user reads the transaction summary, inspects the transaction (PTB) as a graph,
and signs in their own wallet. The AI client never receives signing authority or
executable transaction bytes.

![Say Ur Intent local review page](https://raw.githubusercontent.com/stelis-dev/say-ur-intent/main/assets/sui1.png)

*The local review page: deterministic review checks, review-time simulation
evidence, and the transaction shown as a labeled PTB graph — what the user
reviews before signing in their own wallet.*

For natural-language Sui DeFi questions, the current release also returns
verified, AI-readable evidence before any transaction is built. That answer path
stays separate from account-bound swap review, where the review server builds
local unsigned transaction material internally and, once every review evidence
stage completes, the local review page offers a digest-gated byte handoff,
and user-controlled wallet signing. After the page reports the signed transaction
digest, the review server re-reads Sui mainnet and records normalized chain
receipt evidence. MCP responses never sign, execute, or return transaction
bytes; the only transaction-byte path is the same-machine, digest-gated wallet
handoff initiated from the local review page.
The review page shows the server-read chain receipt facts inline, and a public
Receipt card reads on-chain receipt facts for any transaction digest,
without adding wallet, signing, or execution authority.

Because the AI never holds keys, never signs, and never builds the transaction —
the tool builds it against pinned, known protocol packages, and you review the
decoded bytes and sign in your own wallet — the failure modes that make AI and
DeFi dangerous together (an agent acting on its own, signing on your behalf, or
slipping in an opaque or substituted transaction) are closed by design, not
patched by asking you to trust the model.

That guarantee is byte-level: the bytes you approve are the bytes your wallet
signs — not a claim that the human-readable review captures every detail of the
transaction, so the raw PTB structure and addresses stay inspectable beside it.

Users can ask ordinary questions:

- "Can I cover a 1000 dollar payment with my assets?"
- "How much are my USD-denominated assets together?"
- "What is the shortfall?"

The broader product direction does not stop at pre-execution review. From
verified evidence, Say Ur Intent aims to carry an AI client's or MCP server's Sui
payment or action request through a human-readable local review and on to
user-controlled wallet signing and execution receipt evidence — only after Say Ur
Intent independently builds or verifies the transaction material. The three
layers below state what is implemented today, what is deliberately sequenced
next, and what stays permanently out of scope. For any
such request, Say Ur Intent explains what current verified evidence supports, what
choices remain with the user, and what claims are unsupported.

## Product Scope in Two Layers

Say Ur Intent is one product, but it must be read at two distinct layers. Do not collapse them:

- **Implemented:** Sui mainnet evidence, local review, and signable review adapters for the DeepBook and FlowX swap routes, registered through protocol-agnostic adapter contracts. The account-bound DeepBook and FlowX swap reviews build unsigned transaction material into a local in-process material store, internally bind a Sui transaction digest to that stored material, derive object ownership, quote/policy provenance, human-readable review facts, review-time simulation evidence, and PTB visualization evidence from the same private review artifacts, emit a schema-validated wallet review contract on a `ready_for_wallet_review` state, and serve a digest-gated byte handoff to the same-machine review page for user-controlled wallet signing. After the page reports a signed transaction digest, the review server re-reads Sui mainnet and records normalized chain receipt evidence on the session. The review page shows the server-read chain receipt facts inline, and an internal Receipt card reads on-chain receipt facts for any transaction digest. MCP responses do not contain transaction bytes, signing data, or signing readiness.
- **Never (permanently unsupported at every layer):** no private-key custody, no MCP or AI autonomous execution, no forwarding of opaque external transaction bytes to a wallet, no silent settlement-token or route choice, no fiat cash-out, no P&L, no peg guarantee.

In one sentence: Say Ur Intent is a local-first Sui intent evidence and review layer that progresses from verified evidence to user-controlled wallet signing only after Say Ur Intent independently builds or verifies the transaction material and shows a human-readable local review.

DeepBook and FlowX are the current Sui liquidity and price sources in this
release: DeepBook provides scoped conversion, price, and orderbook evidence, and
FlowX provides indicative CLMM route quotes. Wallet and Sui balance reads
describe held assets. They do not define the whole product.

Say Ur Intent does not custody funds, hold private keys, or autonomously trade
on behalf of users.
By current design, it does not rank venues, choose routes, make best-price
recommendations, or silently choose settlement tokens for users.

The current release can build local unsigned transaction material inside the
account-bound DeepBook and FlowX swap review paths. It does not expose
transaction bytes.
Wallet signing is user-controlled on the local review page after a
digest-gated handoff; MCP responses never request signatures, provide signing
readiness, or execute payments.

Current review sessions are local evidence-review records only. DeepBook and
FlowX review state may show that local transaction material was built,
internally bound to a Sui transaction digest, and used to derive object
ownership, quote/policy provenance, human-readable review facts,
review-time simulation evidence, and PTB visualization evidence. Review
sessions do not contain public transaction bytes, signing requests, or
executable wallet actions; the dedicated same-machine handoff endpoint is the
only transaction-byte path and is gated by recomputed digest equality.

The current release flow is:

```text
The user states an intent in natural language.
Say Ur Intent resolves the supported Sui mainnet evidence surface.
The AI answers only from returned evidence and boundaries.
Supported swap transaction material build is an account-bound review step, not
part of the natural-language intent evidence answer.
```

The current release implements intent evidence for supported Sui mainnet reads.
It can also create a read-only, non-signable local review session from a
structured external payment or Sui action proposal. External proposal ingestion
does not trust external transaction material or send anything for wallet signing.

For setup, see [docs/MCP_SETUP.md](docs/MCP_SETUP.md).
For the MCP API reference, see [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).
For the AI-client answer playbook, see [docs/AGENT_BEHAVIOR.md](docs/AGENT_BEHAVIOR.md).
For manual maintainer and developer utilities, see [docs/UTILITY_INDEX.md](docs/UTILITY_INDEX.md).

User-question flows for USD-denominated coverage, balance totals, and shortfall answers live in [docs/AGENT_BEHAVIOR.md](docs/AGENT_BEHAVIOR.md). The response fields for those answers live in [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).

## What Works Today

The current release can run as a local stdio MCP server and expose mainnet Sui DeFi evidence:

- wallet balances with verified display units;
- coin-balance classification;
- USD-denominated settlement asset groups derived from pinned DeepBook SDK registry metadata;
- intent evidence with response summaries for natural-language USD-denominated payment coverage, balance-total, and shortfall questions;
- DeepBook pools, tokens, mid price, orderbook context, raw quotes, display-amount quotes, and account inventory;
- FlowX CLMM pools and indicative single-hop swap route quotes from the chain-verified pinned registry;
- user-requested bounded Sui transaction digest lookup, account activity scans, sent-function activity scans with known-wallet-only persistence, and stored normalized activity summaries;
- read-only external proposal review sessions that display proposed action, asset flow, recipient or target, freshness, missing evidence, user choices, unsupported claims, and non-signable reason;
- local Say Ur Intent review evidence and review-session status reads;
- account-bound DeepBook and FlowX swap review progress through local unsigned transaction material build, internal Sui transaction digest binding, object ownership evidence, quote/policy provenance binding, human-readable review facts, and review-time simulation evidence; when every stage completes the review reaches `ready_for_wallet_review` and the local review page offers a digest-gated byte handoff and user-controlled wallet signing. After the page reports the signed transaction digest, the review server re-reads Sui mainnet and records normalized chain receipt evidence. MCP responses never sign, execute, or return transaction bytes; transaction bytes flow only through the same-machine, digest-gated wallet handoff initiated from the local review page.
- the review page's inline server-read chain receipt facts for terminal review
  sessions, and an internal Receipt card that reads on-chain receipt
  facts (execution status, balance changes, object changes, and Move calls) for
  any transaction digest.

It also includes:

- a local review server bound to `127.0.0.1`;
- a local SQLite store for active account read context and review evidence;
- MCP output checks that reject forbidden executable, signing, token, seed, and
  key-material field names from responses.

## Screens

**Review → result.** The review page shows exactly what you are about to sign
while nothing is committed; after you sign in your own wallet, the server
re-reads Sui mainnet and renders the chain-verified receipt.

![Chain-verified receipt](https://raw.githubusercontent.com/stelis-dev/say-ur-intent/main/assets/sui2.png)

**The transaction as a labeled graph.** Every review and receipt renders the
PTB as a graph, so the structure of what is signed is visible — not just the
amounts.

![PTB transaction graph](https://raw.githubusercontent.com/stelis-dev/say-ur-intent/main/assets/ptb-graph.png)

**DeepBook USDC chart.** `ui.open_chart` opens an internal MCP Apps card with
official DeepBookV3 Indexer candles and volume for one selected USDC pool.
The saved result displays the requested UTC range, candle limit and source time.

## Current Limits

### Not Implemented

External proposal execution is not implemented. Further local analysis views
beyond the current inline review receipt and internal Receipt card are
not implemented. Transaction material build, contract emit, digest-gated wallet
handoff, user-controlled signing, signed-digest reporting, server-read chain
receipt recording, the inline review receipt, and the internal Receipt card
are implemented for the account-bound DeepBook and FlowX swap review
through a plan-factory registry.

External proposal ingestion is implemented only for read-only local review
sessions. It accepts structured proposal facts, rejects forbidden executable or
signing fields, recognized Sui private-key strings, valid English BIP39
mnemonic phrases, obvious sensitive markers, and suspicious raw secret-like
payloads before storage, and records why the review is non-signable.

Blocked review state is session-scoped: a review session stays blocked while
required review evidence is missing for that session (for example
`wallet_review_contract_emit_missing`). When an account-bound supported swap
review completes local transaction material, digest binding, object ownership,
quote/policy provenance, human-readable review evidence, and review-time
simulation evidence, the review layer emits a schema-validated
`WalletReviewAdapterContract` bound to the same transaction commitment on a
`ready_for_wallet_review` state. Wallet handoff is gated on a recomputed
digest matching that commitment, and the review page then offers
user-controlled wallet signing. After the signed transaction digest is
reported, the review server re-reads Sui mainnet and records a normalized chain
receipt on the session. Review-time simulation and the emitted contract are
evidence about stored local material only; they are not signing readiness,
wallet readiness, or execution readiness. The chain receipt is post-execution
server-read evidence for that digest; it is not an economic-outcome guarantee,
not route quality, not fiat value, not P&L, not tax evidence, not best-price
evidence, and not peg evidence.
None of these is a user bypass state.

The signable adapter and PTB visualization boundary is documented in
`docs/SIGNABLE_ADAPTER_CONTRACT.md`. The runtime path emits
`WalletReviewAdapterContract` as pre-signing review evidence when every
required evidence stage is complete; the contract carries the transaction
commitment hash only.

Wallet signing and the digest-gated byte handoff happen only on the local
review page through the user's own wallet, never through MCP responses. MCP
responses do not return executable transaction material or signing data, and
do not provide signing readiness.

Fiat cash-out, P&L, tax, and cost-basis support are not part of the current release.

### Permanent Safety and Correctness Boundaries

These are product boundaries and must not be relaxed by ordinary feature work:

- Say Ur Intent does not custody funds, hold private keys, or autonomously trade.
- It does not treat USDC, USDT, or any USD-denominated settlement asset as fiat
  USD, a bank cash-out amount, or a USDC/USD peg guarantee.
- It does not turn quote-only conversion candidates into payment coverage, shortfall evidence, funding readiness, payment execution readiness, or signing readiness.

### Out of Scope by Current Design

These product behaviors are out of scope in the current release by design:

- It does not silently choose USDC, USDT, or another settlement token for a
  user. It can report supported settlement asset groups and can use a settlement
  token only when the user selected it explicitly.
- It does not rank venues, choose routes, or make best-price recommendations.

### Quote Response Limits

Quote tools such as `read.quote_deepbook_action` and
`read.quote_deepbook_display_amount` return scoped quote facts and raw quote
evidence only.

Their semantics mark quote output as price evidence, not payment coverage or shortfall evidence. Coverage and shortfall answers come from `read.preview_intent_evidence.responseSummary`.

For quote responses alone, these conclusions are unsupported:

- payment coverage is not available;
- shortfall contribution is not available;
- route-dependent payment support is not available;
- final min-out values are not available;
- route recommendations are not available;
- venue comparisons are not available;
- effective-price claims are not available;
- price-impact calculations are not available;
- quote-vs-mid slippage is not available;
- fiat cash-out estimates are not available;
- external market lookups are not available;
- USDC/USD peg assumptions are not available;
- P&L is not available;
- cost basis is not available;
- actionable signing data is not available.

## Install

Install from the MCP registry (server `io.github.stelis-dev/say-ur-intent`) or with `npx -y @stelis/say-ur-intent`. For per-client configuration (Claude Code, Claude Desktop, Codex, Cursor) and running from a local checkout, see [docs/MCP_SETUP.md](docs/MCP_SETUP.md).

After the MCP server is connected, use [docs/MCP_SETUP.md](docs/MCP_SETUP.md#first-use-flow) for first-use setup, [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) for API fields and statuses, and [docs/AGENT_BEHAVIOR.md](docs/AGENT_BEHAVIOR.md) for user-question flow and response wording.

## Mainnet-Only Product Surface

Product docs, registry, AI responses, UX copy, and signable actions are mainnet-only.

Unsupported protocol experiments are not product functionality and are not included in the package docs, MCP resources, registry support lists, UX copy, or signable-action lists.

## MCP Tools

The canonical MCP API reference lives in [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).

The server also exposes `read.get_server_status`. It returns the package version, evidence policy version, `implementedToolsCount`, and implemented tool list at runtime.

DeepBook pool-price context is exposed through `read.get_deepbook_mid_price`. Use `docs/MCP_TOOLS.md` for the response fields and unsupported conclusions.

Tool names use dot prefixes because the MCP spec recommends ASCII letters, digits, underscore, hyphen, and dot for tool names. `action.prepare_sui_action_review` returns a `reviewSessionId` and `reviewUrl`; it does not return executable transaction bytes.

## Documentation Map

The server exposes only a subset of repository documents as MCP resources.

Runtime-facing MCP resources currently include:

- this README;
- `docs/MCP_SETUP.md`;
- `docs/MCP_TOOLS.md`;
- `docs/WALLET_IDENTITY.md`;
- `docs/AGENT_BEHAVIOR.md`;
- `protocols/deepbook-v3.md`;
- `protocols/deepbook-margin.md`.

Protocol resources are explanatory references. Current support is declared by `read.get_server_status`, `read.list_supported_protocols`, concrete tool schemas, and concrete tool responses, not by protocol Markdown alone.

Development-only or release-review documents can define contributor rules and checks.

AI client answer behavior must be mirrored in runtime-facing instructions, resources, prompts, schemas, or returned evidence fields before it is treated as product behavior.

- `README.md`: Public entry document: product purpose, current release boundary, setup path, and documentation map.
- `docs/MCP_SETUP.md`: Setup guide: installation, MCP client connection, first-use flow, settings, and troubleshooting.
- `docs/MCP_TOOLS.md`: API reference: tool contracts, response fields, statuses, follow-up fields, and output boundaries.
- `docs/AGENT_BEHAVIOR.md`: Answer playbook: user-question flows, tool selection, and response wording boundaries.
- `docs/WALLET_IDENTITY.md`: Wallet identity reference: active-account read context and same-machine capture boundaries.
- `protocols/deepbook-v3.md`: Protocol reference only; use MCP tool responses and read.list_supported_protocols for current support.
- `protocols/deepbook-margin.md`: Protocol reference only; no margin MCP read tools or signable actions are exposed in this release.
- `docs/golden-scenarios/INTENT_EVIDENCE_MATRIX.md`: current-release question, tool-path, and standard-answer matrix for AI client release review.
- `docs/golden-scenarios/BEHAVIOR_MATRIX.md`: broader behavior scenario matrix for supported and unsupported user prompts.
- `docs/TRANSACTION_ACTIVITY_LOG.md`: transaction activity evidence, storage, scan, and summary boundaries.
- `docs/UTILITY_INDEX.md`: manual maintainer and developer utilities. Utility rows are not MCP tools unless they explicitly name an MCP tool, and source-checkout scripts are not packaged product commands.
- `docs/LOCAL_DB_ARCHITECTURE.md`: local SQLite storage boundaries for maintainers.
- `docs/SDK_API.md`: pinned SDK API notes and source-verification boundaries.
- `docs/FRONTEND_POLICY.md`: review-app frontend implementation policy for coding agents.
- `docs/SIGNABLE_ADAPTER_CONTRACT.md`: wallet-review adapter and PTB visualization contract. It defines the pre-signing review evidence and commitment boundary; wallet signing still happens only through the local review page, not through MCP.
- `AGENTS.md`: root repository development contract and non-negotiable product boundaries for coding agents working on this codebase.
- `docs/AGENT_DEVELOPMENT_POLICY.md`: detailed binding development, review, documentation, source-of-truth, and completion policies for coding agents.

## Contract Name Registry

The PTB visualization on the review page can show human-readable labels in place
of raw addresses, with a toggle back to raw addresses. A label is identity display only, not a
safety, trust, route-quality, or signing-readiness signal, and only registered
addresses are relabeled.

Two pinned, context-aware registries in
[`src/core/action/contractNameRegistry.ts`](src/core/action/contractNameRegistry.ts)
drive this:

- packages, relabeled only in `<address>::` path position — the DeepBook swap
  package by its Move Registry (MVR) name `@deepbook/core`, and the Sui framework
  packages by their Move aliases (`std`, `sui`, `sui_system`);
- well-known Sui system objects, relabeled only as a bare object id — `Clock`,
  `SuiSystemState`, `Random`, `DenyList`, `CoinRegistry`, and the address-based
  balance `AccumulatorRoot`.

If you maintain a Sui DeFi protocol that has a registered MVR name and want its
package to display that name in the review graph, open a pull request adding your
mainnet package address and MVR name to the package registry. Every unregistered
address keeps its raw form.
