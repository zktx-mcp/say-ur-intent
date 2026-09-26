# Wallet Connection

WalletConnect provides approved Sui mainnet account context and a transport for
individual wallet requests. It is not login, proof of address ownership, custody, or standing permission to transact. Frontend behavior is defined in
[Frontend Policy](FRONTEND_POLICY.md); tools are in [MCP Tools](MCP_TOOLS.md).

## Connection and read account

`session.create_wallet_connection` opens the internal card for connection, disconnection and approved-account selection. Opening or
reading it does not pair a wallet. The user explicitly chooses connect, disconnect or an approved account. Disconnection shows the target account and network and requires confirmation. While a connection or wallet operation is present, the card does not offer another pairing; disconnect existing wallets before connecting a new one. Existing multiple connections remain individually manageable. The backend admits that choice
in SQLite before SDK I/O. Pairing QR data stays in UI metadata bound to the exact
card, connection and revision. Reopening a waiting card uses the same pairing
while its backend owner retains it; it never creates another pairing.

The backend validates accounts, Sui mainnet namespace, methods and expiry before
recording a connection. A single wallet-approved account can become read context
from an explicit connection; multiple approved accounts require an explicit
selection. The active read account is stored in SQLite until changed or cleared.
SDK restoration and status reads never undo a user clearing that context. The stored selection is separate from its eligibility as a default for current asset reads. Implicit asset reads require a usable current wallet connection for the selected address; disconnection, expiry, pending disconnection or unavailable wallet state removes that default. Tools with an `account` input may still read an explicit address; connected-account-only tools require connection/account selection or recovery of wallet availability. Explicit-address public reads and saved transaction/activity reads remain available. `session.get_interaction_status.assetReadAccount` supplies that default-account decision alongside `connections` and `walletAvailability`.

| Connection state | Available behavior |
| --- | --- |
| Unsubmitted card | Explicit connect, use approved account, disconnect, or cancel |
| awaiting_approval | Same private QR and approval observation; stop waiting |
| connected | View approved accounts and expiry; a new card may select another operation |
| rejected / failed / expired / stopped / disconnected | View the recorded outcome; new operations need a new card |

`session.get_interaction_status` can reconcile recorded connections with SDK sessions and apply the existing review/request invalidation rules before returning their state. It neither changes the selected read account nor starts a wallet operation. See the [interaction API](MCP_TOOLS.md) for the response contract.

An admitted disconnect is a pending card operation, distinct from the last
confirmed connection state. The same connection cannot be selected for another
operation while disconnection is pending. Cards and wait tools observe its
stored completion or failure; a connected-session update is not completion of
the disconnect. A restart does not replay an unfinished disconnect or restore
that connection as usable. The wallet app may still retain the connection.

If the SDK disconnect ends but its local completion write fails, current reads
settle the operation once storage recovers. An available SDK with no such session
confirms local disconnection; an unavailable SDK or retained session produces an
unconfirmed failure and wallet-app guidance. Reading never repeats disconnect.
Approval storage failure can also leave a connection in the wallet app. Local
failure or expiry does not prove remote revocation; remove retained connections
in the wallet app. No fixed cleanup period is promised, and an SDK session alone
never restores product authority.

Chat navigation and frame recreation are not transitions. Local stopping does
not claim that a remote wallet dialog closed. A late approval cannot revive a
stopped connection. An unavailable backend wallet service keeps ordinary reads
available and makes connection cards unavailable with an explicit explanation.

The product supplies its public WalletConnect project identifier without user
configuration or an override. Shared Relay service limits can affect connection
availability across installations. An initialization failure does not establish
that the user omitted a setting or that a transaction failed. A failure to
restore saved connections or subscribe to wallet changes disables wallet operations until backend restart;
it cannot leave signing available without account/chain change observation.
Stored review, request and verified execution facts remain readable through
session tools and cards as well as ordinary evidence tools. `walletAvailability`
describes the backend wallet dependency; it is not connection approval or
transaction authorization. An unavailable dependency does not erase a saved
result or prove chain failure. Startup diagnostics contain safe failure stages,
not the project ID, SDK error bodies or wallet credentials.

An interrupted wallet operation reports `progress.status: "unavailable"` and a
bounded wait returns `waitOutcome: "unavailable"` with the recorded facts. It does
not pretend that the operation completed or the wait timed out. A completed
request returns its saved result immediately. The backend can still verify the
known digest of an already submitted transaction without WalletConnect. No
financial request is replayed when reading or recovering results.

## Transaction approval

An existing review keeps its original account binding. Preparing or updating it
requires that account to be the selected read account as well as an approved
account on the chosen connection. If read context changes from A to B, select A
again to update the same review, or request a new review for B. The card explains
the current selection restriction separately from any previous preparation
failure. A refused incompatible selection starts no preparation and records no
failed review. Read context alone does not revoke already verified A signing
evidence or alter an admitted request.

Preparation execution and its stored outcome are separate. If execution has
ended but both success and failure writes failed, the next current-state read
records the failed update once storage recovers. It does not recompute evidence;
another update requires an explicit user action. A still-running computation is
not failed merely because its result is not yet available.

Review cards display account-bound verified evidence. Only a current review,
matching live wallet account and explicit user action may admit a signing
request. The backend uses `sui_signTransaction` with the stored BCS transaction
encoded as base64, checks the returned bytes' digest and signature against the
admitted account, then submits once. No browser signer, sign-and-execute fallback
or automatic retry is used. A wallet lacking that method cannot sign through
this path. Actual compatibility requires that wallet's successful normal flow;
namespace advertising alone does not prove it.

The backend verifies the stored material and rechecks its exact identity,
review revision, bytes and expiry in the admission transaction. A displayed
signature choice cannot extend the quote's validity. If the material expires
before admission, update the review; no signature request is sent. Once admitted,
the transaction remains fixed and the saved signing deadline applies. Reading
or recovering an admitted attempt does not require a fresh quote or send it again.

Wallet account/chain selection changes invalidate affected unadmitted review
data and pending submission permission in the same connection-change transaction.
If that write fails, wallet operations are disabled until backend restart; a late
signature cannot continue under an unrecorded old permission.
Before submission, an explicit user stop, an SDK connection change and a
requested disconnect record distinct reasons. A disconnect request does not
claim completed disconnection. The first terminal reason is retained.
After submission, connection updates and disconnect requests do not stop
independent chain observation, including a lookup that has not started yet.
Only the explicit transaction `stop_waiting` action stops that observation;
later connection events neither resume it nor extend its deadline. An explicit
result read can still inspect the same digest. No event resends the transaction.
Callbacks already dispatched to submit or read a transaction may still record
verified facts and settle their own pending flags while the same DB owner is
valid. Wallet failure alone does not end an SDK promise. Server shutdown, owner
replacement and data-generation changes still reject stale continuations.

A request records one of `awaiting_signature`, `submitting`,
`awaiting_chain_result`, `stopped`, `request_failed`, `outcome_unknown`, or
`completed`. Only completed requests contain a separately verified chain
success/failure result. Timeout, wallet rejection and lost RPC replies do not
prove chain failure. Result reads observe the same digest. Management requires
an exact review session and attempt and cannot refresh or sign a new review.

The stored `submitting` state already identifies an admitted submission attempt.
It remains observable and protected during the original observation window even
if the post-submission write fails. Observation can finish before the submission
callback returns. A late callback cannot reopen a completed or unknown outcome,
extend that window, or submit again. Actual pending callbacks continue to protect
data replacement even after a result is recorded.

## Ownership and persistence

One backend owns a data directory and its WalletConnect SDK. Authenticated local
clients share that owner. A second owner is refused even on another port.
Private SDK connection/session keys reside in an OS-user-only store separate
from public activity backup. Request history, pending messages and unknown
resend namespaces are volatile. The SDK storage stays alive until the owner
process exits; no unsupported complete in-process SDK disposal is assumed.

A new owner preserves completed facts, expires old unsubmitted input, and marks
interrupted requests outcome_unknown without replaying them. Known approved
SDK sessions may be reconciled with existing connection records; abandoned
pairings and financial requests are not replayed. An unknown outcome may later
be resolved by reading the known transaction digest.

Data replacement is refused while signature/submission callbacks or initial
chain observation remain unsettled. Removing finished local records cannot
cancel or reverse an on-chain transaction. Public export/import never restores
card permissions, SDK secrets, private request authority or live pending work.
Local data replacement does not revoke the wallet app's connection approval.
If a connection is no longer present in the product database, remove it in the
wallet app; see [local data setup](MCP_SETUP.md#local-data-format).

## Balance forms in a swap review

A wallet can hold tokens as coin objects, address balances, or both. The backend
uses the supported adapter's SDK to construct the transaction and verifies the
funding form present in the stored material. Review details identify whether gas
uses SUI coin objects, address balance, or an address-balance reservation with
coin objects. A reservation is a limit, not a completed debit.

The selected account must fund both the swap and its gas. A positive total wallet
balance does not by itself prove that a particular withdrawal is covered. Source
read failures and unsupported funding are not reported as confirmed insufficient
funds. Balances can change after review; simulation and successful connection do
not guarantee that the wallet will accept or the chain will execute a transaction.
Every signature still requires the user's explicit card action and wallet approval.
