# AGENTS.md

This file is the root operating contract for coding agents working in this
repository. Read it from disk before every task.

Detailed policy files are binding when the task touches their boundary. Moving a
rule out of this root file does not make it optional or lower priority. The
primary detailed policy is `docs/AGENT_DEVELOPMENT_POLICY.md`.

## Product Purpose

Say Ur Intent is a local-first toolkit that turns natural-language Sui DeFi
intent and structured Sui payment/action proposals into verified, AI-readable
evidence, and is designed to carry a reviewed request through to user-controlled
wallet signing and execution receipt evidence after Say Ur Intent independently
builds or verifies the transaction material. The current release implements
Sui mainnet evidence, local review, and signable account-bound swap review paths
for DeepBook and FlowX. Those paths build local unsigned transaction material
into a local material store, internally bind a Sui transaction digest to that
stored material, derive object ownership, quote/policy provenance,
human-readable review evidence, review-time simulation evidence, and a PTB
visualization from the same stored material and private review artifacts, and
emit a schema-validated wallet review contract on `ready_for_wallet_review`.
When every required evidence stage completes, the local review page can request
the only transaction-byte handoff path: a same-machine, digest-gated handoff
whose bytes must recompute to the reviewed commitment before the user signs in
their own wallet. After the page reports the signed transaction digest, the
review server re-reads Sui mainnet and records normalized chain receipt
evidence. The review page also displays the server-read chain
receipt facts inline, and a public Receipt Analytics page reads on-chain receipt
facts for any transaction digest, without adding signing or execution authority. MCP responses and ordinary review-session JSON never
expose transaction bytes, request wallet signatures, provide signing readiness,
or execute on the user's behalf.

The current evidence layer answers a pre-execution question: given a user's Sui
assets and a payment or action request, what can current verified evidence say,
and what must remain a user choice or unsupported claim?

What is implemented today and what is deliberately sequenced next are distinct,
and both must stay explicit in this file:

- Implemented today: read-only natural-language evidence, read-only external
  proposal review, and signable account-bound DeepBook and FlowX swap review on
  the local review page. The supported swap review paths can build unsigned
  transaction material into a local in-process material store and internally
  bind a Sui transaction digest to that stored material. They can derive object
  ownership evidence, quote/policy provenance, human-readable review facts,
  review-time simulation evidence, and PTB visualization evidence from the same
  material-bound private artifacts. When every review evidence stage completes,
  the local review page offers a digest-gated byte handoff, user-controlled
  wallet signing, chain submission from the page, signed-digest reporting, and
  server-read chain receipt recording. The local review page shows
  server-read execution facts inline on terminal review sessions, and a public
  Receipt Analytics page reads on-chain receipt facts by transaction digest. MCP responses and
  ordinary review-session JSON never expose transaction bytes, request wallet
  signatures, provide signing readiness, or execute on the user's behalf.
- Deliberately sequenced next: further analysis views beyond the current inline
  review receipt and public Receipt Analytics page, further protocol adapters, and external proposal
  execution, each added only after Say Ur Intent independently builds or
  verifies the transaction material inside a human-readable local review, and
  never outside the product's permanent boundaries.

This sequencing never weakens the Non-Negotiable Boundaries below. "The current
release does not include X yet (deliberately sequenced later)" and "the final
product does X under user control after reviewed verification" are separate
statements and must not be collapsed into either a permanent no-goal or a
current capability.

Say Ur Intent is not a DeepBook-only product. Extensibility across Sui DeFi
protocol adapters is a core product advantage, not a late cleanup task. DeepBook
and FlowX are the current concrete Sui DeFi protocol surfaces in this release:
DeepBook provides scoped conversion, price, orderbook, account-inventory, and
swap-review evidence; FlowX provides pinned CLMM pool facts, indicative route
quotes, and swap-review evidence. Concrete tools, SDK calls, registry fields,
and implemented adapter details may name those protocols. Product-level plans
and new evidence producer work must still be designed against
protocol-agnostic adapter contracts first. Wallet and Sui balance reads describe
held assets. DeepBook and FlowX facts must not become route choice, liquidity
readiness, price-impact claims, funding readiness, payment readiness, best-price
advice, or signing readiness unless response-local fields explicitly support
those conclusions.

Do not introduce names of other DeFi protocols into public docs, runtime
guidance, MCP resources, roadmap labels, or product copy during development
unless there is an approved concrete implementation or support decision for that
protocol. Use generic terms such as "protocol adapter", "first swap adapter",
"supported action adapter", or "account-bound swap review" until a protocol is
actually implemented or explicitly approved. DeepBook and FlowX are current
exceptions because they are implemented protocol surfaces, but neither may
become a custom-only design shortcut.

Existing transaction-activity classifier research notes may name protocols only
inside that implemented `compact.protocolMatches` evidence boundary. Those names
must not be copied into runtime guidance, MCP resources, roadmap labels, product
copy, adapter plans, route support, wallet inventory support, transaction
building, signing readiness, or execution claims without a separate approved
implementation or support decision.

## Non-Negotiable Boundaries

These boundaries are not implementation details and must not be weakened to make
a task easier.

- The product must not provide private-key custody, autonomous execution, or
  unchecked AI-controlled authorization.
- The MCP layer and ordinary review-session API responses never request wallet
  signatures, execute on the user's behalf, or provide signing or
  payment-execution readiness; wallet signing and execution happen only on the
  local review page under the user's control. Exposing transaction bytes through
  MCP or ordinary review-session JSON and trusting external transaction
  material remain forbidden at every stage. The only transaction-byte exit is
  the same-machine digest-gated handoff endpoint on the local review page. The
  current transaction-material build paths are local unsigned account-bound
  DeepBook and FlowX swap review material, with an internal digest commitment,
  that stays inside the review-server session until that handoff recomputes the
  bytes to the reviewed commitment. Object ownership, quote/policy provenance,
  human-readable review facts, PTB visualization, and review-time simulation
  evidence derived from that material are pre-signing review evidence only.
- Current read-only external proposal review records structured proposal facts
  only as non-signable review context. It is not transaction building, payment
  execution, wallet signing, signing readiness, or trusted transaction material.
- Future external proposal execution or signing support must resolve mainnet
  facts independently and either build or verify review-time transaction
  material inside Say Ur Intent before wallet signing is offered.
- External MCP or AI-client proposals must be treated as untrusted structured
  inputs, not executable authority.
- The product must not treat USDC, USDT, or any USD-denominated settlement asset
  as fiat USD, a bank cash-out amount, or a USDC/USD peg guarantee.
- The product must not provide fiat cash-out, P&L, tax, or cost-basis support in
  the current release or immediate review roadmap unless a separate product
  decision changes that scope.
- Say Ur Intent must not silently choose USDC, USDT, or another settlement token
  for a user.
- Say Ur Intent must not rank venues, choose routes, or make best-price
  recommendations for users.
- Quote-only conversion candidates must not become payment coverage, shortfall
  evidence, funding readiness, route support, final min-out, price impact,
  slippage evidence, payment execution readiness, or signing readiness unless a
  reviewed implementation returns response-local fields that explicitly support
  those conclusions.
- Do not frame the product around competitions, event tracks, prizes, or judging.

## Agent Operating Contract

- Open and read `AGENTS.md` from disk before starting. Do not rely on memory,
  previous turns, or summaries as a substitute.
- Inspect the current repository state before editing.
- Before reporting repository status, pending work, a task list, a plan,
  whether the tree is clean, or the current/next task name, re-check disk state
  in that same turn. At minimum inspect `git status --short --branch`,
  `git diff --stat`, `git diff --name-only`, untracked files, and the canonical
  task name in the active `.WORK/` roadmap when the answer depends on it.
- Do not answer status or planning questions from memory when disk state may
  have changed. If the disk facts differ from a prior plan or prior answer,
  update the answer to the disk facts and say which prior statement is stale.
- State assumptions when ambiguity affects architecture, security, public API,
  data model, financial/protocol meaning, or a product boundary.
- Prefer the smallest change that fully solves the requested task while
  preserving the verified boundary.
- Do not make drive-by refactors or unrelated formatting changes.
- Every changed line must trace to the user request, the agreed specification
  baseline, or an affected shared invariant.
- Do not change `AGENTS.md`, product-boundary docs, runtime guidance, tests, or
  fixtures to make a task easier unless the user explicitly approved that
  product-rule change.
- For non-trivial or boundary-changing work, define success criteria,
  implementation surfaces, and verification points before editing.
- Treat the first accepted task name as the canonical task name. Use that same
  name in plans, work tables, progress updates, reviews, commit messages, and
  completion reports.
- Task-name drift is scope drift. Confusing the canonical task name with the
  first implementation target can collapse the implementation purpose,
  dependency order, and completion criteria.
- Do not fold the first implementation target into the canonical task name.
  Record it separately, such as "task: Object Ownership Evidence Producer" and
  "first implementation: DeepBook account-bound swap adapter".
- Do not rename, shorten, replace, or reframe a task to make incomplete work
  look complete, smaller, aligned, or out of scope.
- If discovery changes the work, keep the canonical task name and record the
  changed status, missing requirement, blocked condition, or explicitly named
  subtask separately. Work notes and task tables must preserve the canonical
  task name instead of overwriting it.
- If a requirement is missing, weakened, removed, or unverified, say that
  directly. Do not relabel it as cleanup, simplification, alignment, or a
  harmless tradeoff.
- Status or progress wording such as `blocked`, `unverified`, `follow-up`, or
  `limitation` must not soften, downplay, or justify a missed requirement,
  failed check, or completion claim when completion criteria are unmet. Do not
  use `partially complete` as a completion status; if progress matters, name
  completed subtasks and remaining requirements.
- Completion judgment for a scoped task is binary. If any required behavior is
  unimplemented, required cleanup remains undone, or verification is missing or
  failing, the task is not complete.
- Run relevant checks and report what passed or failed.
- Check `git status --short` before the final response and classify unexpected
  files.

## Scope And Planning

Treat work as non-trivial when it touches multiple files, changes a public API or
MCP tool response, changes tests or documentation that define behavior, follows
an accepted plan or review, revisits incomplete work, or responds to a previous
incorrect completion claim.

For non-trivial work:

1. State the product purpose and current task goal.
2. Identify the boundary that must not be crossed.
3. Inspect affected callers, callees, schemas, docs, tests, user flows, and
   failure paths before editing.
4. Establish a specification baseline from the user request, accepted plan,
   confirmed review findings, promised behavior, and required cleanup found
   during investigation.
5. Compare reasonable implementation directions when architecture, data model,
   security, public API, or product authority is affected.
6. Map each baseline requirement to an implementation surface and verification
   point.
7. Implement the complete quality-first change for the verified boundary.
8. Re-check the affected boundary from product purpose, code paths, tests, docs,
   and user flows.

Do not interpret a user request as the lowest-effort literal edit that satisfies
the words in isolation. Interpret it by the product outcome, affected boundary,
and adjacent invariants that must hold for the work to be complete.

## Implementation Rules

- Inspect `package.json` before running project commands. Do not invent scripts.
- When changing the published package or MCP server release version, keep all
  release metadata synchronized in the same change: `package.json`,
  root/package entries in `package-lock.json`, and `server.json` top-level and
  package versions. Before completion, search committed repository surfaces
  excluding `node_modules/`, `dist/`, `.git/`, and `.WORK/` for the old release
  version and classify any remaining matches.
- When changing an SDK or wallet-related dependency version, update pinned
  version documentation such as `docs/SDK_API.md` when that dependency is listed
  there.
- Reuse existing source-of-truth modules, pinned SDK/source APIs, verified
  mainnet data, local registries, and established infrastructure when they own
  the boundary.
- Add new code only when no suitable source exists or the existing source is
  demonstrably insufficient.
- Do not duplicate logic, registries, parsers, protocol metadata, SDK behavior,
  or policy checks without a clear reason.
- Add helpers only when they name a real shared concept, preserve an invariant,
  or remove meaningful repetition.
- Avoid generic frameworks, new registries, plugin layers, event buses,
  background schedulers, or broad configurability unless the verified
  requirement needs them.
- Simple never means hardcoded, temporary, case-specific, or test-only code. A
  simple implementation still validates inputs and outputs, handles errors,
  preserves shared invariants, and covers affected paths with tests.
- Do not hardcode values to bypass real validation, live integration, registry
  policy, or mainnet checks.
- Do not manipulate tests, fixtures, generated files, snapshots, package
  metadata, or source files just to make checks pass.
- Test doubles, fixtures, placeholders, and config constants are allowed only
  when their scope is explicit and they are not presented as product
  functionality.
- Do not fake liquidity, quotes, transactions, wallet state, package IDs, or
  mainnet support.

## Review Rules

The goal of review is defect discovery, not praise or consensus.

- Lead with findings, ordered by severity.
- Cite file and line evidence for each finding.
- Mark speculation as speculation when not directly confirmed by code, tests, or
  pinned SDK source.
- Do not rely on passing tests as proof of correctness. Walk input, state, error,
  and boundary paths.
- When a change is framed as refactor, cleanup, alignment, simplification, or
  documentation synchronization, check whether supported behavior, tool
  authority, runtime guidance, tests, docs, status values, or user-facing claims
  became smaller.
- If history shows prior behavior, classify the current work as restoration,
  replacement, or intentional removal before reviewing it as new functionality.
- For tests that prevent unsafe or unsupported behavior, read the test body and
  state what it prevents before treating it as stale.
- For `userAnswerUse` and golden-document tests, verify semantic polarity, not
  string presence alone.

## Documentation And Runtime Guidance

- Repository-visible code comments, public docs, tests, protocols, tool
  descriptions, user-facing strings, and release-facing copy must be English.
- Internal ignored planning notes are not public product copy. Anything moved
  into exposed surfaces must be rewritten in English.
- `AGENTS.md` owns development rules. It must not be the only place where a
  connected AI client is expected to learn user-answer behavior.
- Runtime-facing behavior must live in MCP-injected or discoverable surfaces:
  `SERVER_INSTRUCTIONS`, prompts, tool schemas/descriptions, MCP resources,
  response fields, and tests.
- Tool descriptions must remain concise, literal, and instruction-free.
- When editing `README.md`, `docs/`, `protocols/`, or runtime-facing instruction
  text, do a first-reader pass. A reader with no prior context must understand
  what is implemented, planned, unsupported, and out of scope.
- Use ordinary industry terms when available. Define unavoidable project terms at
  first use and state exactly what they do and do not mean.
- Do not remove all repetition. Repeated safety boundaries are allowed when they
  protect separate reader surfaces.

## Numeric, Financial, And Protocol Rules

- Treat raw token amounts, display amounts, decimals, slippage, bps, quote
  quantities, min-out values, gas, and balance deltas as safety-critical data.
- Do not infer token decimals from token symbols, memory, UI convention, or
  common ecosystem defaults. Use pinned SDK metadata or verified mainnet onchain
  metadata.
- Keep raw amounts as integer strings or `BigInt` values. Do not use floating
  point `number` arithmetic for token balances or signable quantities.
- Keep display amounts presentation-only. Do not feed display strings back into
  signing, quoting, or review-time simulation without an explicit raw conversion
  step.
- Product specs, public docs, UX copy, product-facing AI/tool responses,
  registries, and signable actions are mainnet-only.
- Internal experiments may use testnet, but they must not appear as product
  functionality.
- Mainnet guards must verify both declared network configuration and the actual
  connected chain identifier. Do not rely on a string literal such as
  `network: "mainnet"` alone.

## Required Detailed Policies

Read `docs/AGENT_DEVELOPMENT_POLICY.md` before work that touches any of these
boundaries:

- documentation ownership or runtime-facing guidance;
- stateful/API behavior, session state, review state, signing, wallet, MCP
  tools, HTTP endpoints, or adapters;
- numeric, financial, Sui, DeepBook, SDK, CLI, registry, generated file, or
  mainnet source-of-truth behavior;
- review-server frontend or local browser review surfaces;
- utility scripts, smoke tests, release checks, or source-checkout scripts;
- dependency upgrades or lockfile changes;
- any non-trivial implementation or review.

## Commands

Current commands, as of the current `package.json`:

- Install: `npm install`
- Type check: `npm run typecheck`
- Build: `npm run build`
- Test: `npm test`
- Release check: `npm run release:check`
- Generate DeepBook registry: `npm run generate:deepbook-registry`
- Mainnet read smoke: `npm run smoke:mainnet` (manual only; requires mainnet env values)

If `package.json` differs from this section, `package.json` wins. Say so and
update this section when the difference is intentional.

## Completion Criteria

Work is complete only when:

- the requested behavior is implemented;
- affected code, docs, interfaces, user flows, and product claims have been
  reviewed after the change;
- the affected boundary still looks robust from product purpose, code paths,
  tests, docs, and user flows;
- relevant checks, tests, builds, or manual verification have been run when
  available;
- introduced errors have been fixed;
- remaining limitations are explicitly documented;
- non-trivial work is compared against the specification baseline, with every
  baseline requirement classified as implemented and verified, missing,
  weakened, or unverified;
- final `git status --short` has been checked and unexpected files are
  classified or cleaned up.
