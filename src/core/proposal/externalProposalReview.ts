import { randomUUID } from "node:crypto";
import type { ActionPlan } from "../action/types.js";
import {
  EXTERNAL_PROPOSAL_CONTRACT_VERSION,
  PROPOSAL_REVIEW_MODEL_VERSION,
  type ExternalProposal,
  type ExternalProposalActionPlanData,
  type ExternalProposalAssetAmount,
  type ExternalProposalAssetFlowItem,
  type ExternalProposalActionTarget,
  type ExternalProposalParty,
  EXTERNAL_PROPOSAL_REVIEW_ALWAYS_UNSUPPORTED_CLAIMS,
  type ProposalReviewCheck,
  type ProposalReviewGap,
  type ProposalReviewModel
} from "./types.js";
import { externalProposalSchema } from "./schemas.js";

const REJECTED_EXECUTABLE_FIELDS = [
  "transactionBytes",
  "serializedTransaction",
  "signingRequest",
  "signature",
  "privateKey",
  "secretKey",
  "seed",
  "mnemonic",
  "routeSelectedPlan"
] as const;

export function externalProposalToActionPlan(
  proposal: ExternalProposal,
  now = new Date()
): ActionPlan<ExternalProposalActionPlanData> {
  const sanitizedProposal = externalProposalSchema.parse(proposal);
  const reviewModel = proposalReviewModel(sanitizedProposal, now);
  return {
    id: `plan_${randomUUID()}`,
    actionKind: sanitizedProposal.type,
    adapterId: "external-proposal-review",
    protocol: "Sui",
    title: reviewModel.proposedAction.title,
    summary:
      "This local review records an external proposal as untrusted structured input. It is non-signable and does not include transaction bytes, signing data, wallet authorization, route selection, fiat cash-out, P&L, tax, or cost-basis support.",
    assetFlowPreview: {
      outgoing: reviewModel.assetFlow.outgoing.map(toDisplayIntentAmount),
      expectedIncoming: reviewModel.assetFlow.expectedIncoming.map(toDisplayIntentAmount),
      ...(reviewModel.assetFlow.fees.length > 0
        ? { fees: reviewModel.assetFlow.fees.map(toDisplayIntentAmount) }
        : {})
    },
    reviewModel,
    adapterData: {
      requestedIntent: sanitizedProposal,
      implementationStatus: "read_only_review_only",
      contractVersion: EXTERNAL_PROPOSAL_CONTRACT_VERSION
    },
    createdAt: now.toISOString(),
    ...(sanitizedProposal.expiresAt ? { expiresAt: sanitizedProposal.expiresAt } : {}),
    preliminaryChecks: reviewModel.blockingChecks
  };
}

function proposalReviewModel(proposal: ExternalProposal, now: Date): ProposalReviewModel {
  const freshness = freshnessSummary(proposal, now);
  const missingEvidence = missingEvidenceForProposal(proposal);
  const requiredUserChoices = requiredUserChoicesForProposal(proposal);
  const blockingChecks = blockingChecksForProposal(proposal, freshness.status);
  const { title, recipient, target } = proposedActionDisplay(proposal);
  const assetFlow = assetFlowForProposal(proposal);
  const recipients = recipientsForProposal(proposal);
  const targets = targetsForProposal(proposal);

  return {
    modelVersion: PROPOSAL_REVIEW_MODEL_VERSION,
    contractVersion: EXTERNAL_PROPOSAL_CONTRACT_VERSION,
    proposalId: proposal.id,
    proposalType: proposal.type,
    proposalSource: proposal.source,
    proposedAction: {
      kind: proposal.type,
      title,
      purpose: proposal.purpose,
      network: proposal.network,
      ...(recipient ? { recipient } : {}),
      ...(target ? { target } : {})
    },
    assetFlow,
    recipients,
    targets,
    evidenceUsed: [
      {
        id: "external_proposal_contract",
        label: "External proposal contract",
        source: "local_schema",
        summary:
          "The proposal matched the read-only external proposal schema and was stored as untrusted review input."
      },
      {
        id: "proposal_declared_network",
        label: "Declared network",
        source: "external_proposal",
        summary: `The proposal declares ${proposal.network}. This is not a connected-chain verification.`
      },
      {
        id: "proposal_display_amounts",
        label: "Display proposal amounts",
        source: "external_proposal",
        summary:
          "Returned amount fields are display proposal facts only and are not raw amounts, min-out values, or signing input."
      }
    ],
    missingEvidence,
    requiredUserChoices,
    unsupportedClaims: [
      ...EXTERNAL_PROPOSAL_REVIEW_ALWAYS_UNSUPPORTED_CLAIMS,
      ...(proposal.assumptions && proposal.assumptions.length > 0
        ? [{
            id: "source_assumptions_unverified",
            label: "Source assumptions",
            reason:
              "Source assumptions are displayed for review but are not verified by this read-only ingestion step."
          }]
        : [])
    ],
    rejectedExecutableFields: REJECTED_EXECUTABLE_FIELDS.map((fieldName) => ({
      fieldName,
      reason:
        "This field is outside the external proposal contract because external executable material is not trusted review authority."
    })),
    freshness,
    blockingChecks,
    nonSignableReason: {
      code: "external_proposal_review_only",
      message:
        "You cannot request wallet approval or submit a transaction from this proposal. Its information was supplied by an external source and has not been independently verified as a transaction.",
      blockedCapabilities: [
        "transaction_building",
        "wallet_signing",
        "execution",
        "signing_data_or_readiness",
        "external_transaction_material_authority"
      ]
    }
  };
}

function freshnessSummary(proposal: ExternalProposal, now: Date): ProposalReviewModel["freshness"] {
  const createdAtMs = Date.parse(proposal.createdAt);
  const nowMs = now.getTime();
  if (createdAtMs > nowMs) {
    return {
      proposalCreatedAt: proposal.createdAt,
      ...(proposal.expiresAt ? { proposalExpiresAt: proposal.expiresAt } : {}),
      evaluatedAt: now.toISOString(),
      status: "created_in_future",
      reason: "The proposal says it was created after the time it was checked."
    };
  }

  if (!proposal.expiresAt) {
    return {
      proposalCreatedAt: proposal.createdAt,
      evaluatedAt: now.toISOString(),
      status: "expiry_not_provided",
      reason: "The proposal does not say when it expires."
    };
  }

  if (Date.parse(proposal.expiresAt) <= nowMs) {
    return {
      proposalCreatedAt: proposal.createdAt,
      proposalExpiresAt: proposal.expiresAt,
      evaluatedAt: now.toISOString(),
      status: "expired",
      reason: "The proposal had already expired when it was checked."
    };
  }

  return {
    proposalCreatedAt: proposal.createdAt,
    proposalExpiresAt: proposal.expiresAt,
    evaluatedAt: now.toISOString(),
    status: "current",
    reason: "The stated creation and expiry times include the time this proposal was checked. Its other claims remain unverified."
  };
}

function missingEvidenceForProposal(proposal: ExternalProposal): ProposalReviewGap[] {
  const gaps: ProposalReviewGap[] = [
    {
      id: "account_bound_wallet_assets",
      label: "Account-bound wallet evidence",
      reason:
        "This ingestion step has not read wallet balances, gas assets, object ownership, or before/after balance changes."
    },
    {
      id: "review_time_simulation",
      label: "Review-time simulation",
      reason:
        "No transaction is built or simulated for this external proposal in the current release."
    },
    {
      id: "recipient_or_target_verification",
      label: "Recipient or target verification",
      reason:
        "The proposal recipient or action target is displayed as provided and has not been independently verified as intended by the user."
    }
  ];

  if (proposal.type === "payment" && !proposal.payment.amount.coinType) {
    gaps.push({
      id: "settlement_asset_selection",
      label: "Settlement asset selection",
      reason:
        "The proposal did not identify a verified coin type. Symbol and denomination fields are external display labels, not user-selected settlement assets."
    });
  }

  if (proposal.type === "payment" && proposal.payment.amount.coinType) {
    gaps.push({
      id: "settlement_asset_metadata_verification",
      label: "Settlement asset metadata verification",
      reason:
        "The proposal supplied a coinType, but this read-only ingestion step has not verified its mainnet metadata or user selection provenance."
    });
  }

  if (proposal.type === "sui_action") {
    gaps.push({
      id: "action_adapter_support",
      label: "Action adapter support",
      reason:
        "No reviewed adapter currently verifies this external Sui action target or converts it into wallet-review material."
    });
  }

  return gaps;
}

function requiredUserChoicesForProposal(proposal: ExternalProposal): ProposalReviewGap[] {
  const choices: ProposalReviewGap[] = (proposal.requiredUserChoices ?? []).map((choice, index) => ({
    id: `source_required_choice_${index + 1}`,
    label: "Source-required user choice",
    reason: choice
  }));

  if (proposal.type === "payment" && !proposal.payment.amount.coinType) {
    choices.push({
      id: "choose_settlement_asset",
      label: "Choose settlement asset",
      reason:
        "A concrete settlement asset remains a user choice when the proposal names only a symbol, denomination, or display amount."
    });
  }

  if (proposal.type === "payment" && proposal.payment.amount.coinType) {
    choices.push({
      id: "confirm_settlement_asset",
      label: "Confirm settlement asset",
      reason:
        "The proposal supplied a settlement asset identifier, but this read-only review has not verified that the user selected it. Confirm the displayed settlement asset before treating it as intended."
    });
  }

  return choices;
}

function blockingChecksForProposal(
  proposal: ExternalProposal,
  freshnessStatus: ProposalReviewModel["freshness"]["status"]
): ProposalReviewCheck[] {
  const checks: ProposalReviewCheck[] = [
    {
      id: "external_proposal_contract",
      label: "External proposal contract",
      status: "pass",
      message: "The proposal contains the required information in the expected format. This does not verify its claims or permit a transaction.",
      source: "proposal"
    },
    {
      id: "proposal_declared_mainnet",
      label: "Declared network",
      status: "warning",
      message: `The proposal declares ${proposal.network}, but this is not connected-chain verification.`,
      source: "proposal"
    }
  ];

  if (freshnessStatus === "expired" || freshnessStatus === "created_in_future") {
    checks.push({
      id: "proposal_freshness",
      label: "Proposal freshness",
      status: "fail",
      message: `Proposal freshness status is ${freshnessStatus}.`,
      source: "proposal"
    });
  } else if (freshnessStatus === "expiry_not_provided") {
    checks.push({
      id: "proposal_freshness",
      label: "Proposal freshness",
      status: "warning",
      message: "The proposal did not include an expiry timestamp.",
      source: "proposal"
    });
  } else {
    checks.push({
      id: "proposal_freshness",
      label: "Proposal freshness",
      status: "pass",
      message: "The proposal timestamps are current for this local review.",
      source: "proposal"
    });
  }

  checks.push({
    id: "external_proposal_review_only",
    label: "Non-signable review",
    status: "fail",
    message:
      "External proposal ingestion is read-only; it does not build transactions, request signatures, or create wallet actions.",
    source: "adapter"
  });

  return checks;
}

function proposedActionDisplay(proposal: ExternalProposal): {
  title: string;
  recipient?: ExternalProposalParty | undefined;
  target?: string | ExternalProposalActionTarget | undefined;
} {
  if (proposal.type === "payment") {
    const recipient = proposal.payment.recipient;
    const recipientLabel = partyLabel(recipient);
    const assetLabel = amountLabel(proposal.payment.amount);
    return {
      title: `Review payment proposal: ${assetLabel} to ${recipientLabel}`,
      recipient,
      target: proposal.payment.target
    };
  }

  return {
    title: `Review Sui action proposal: ${proposal.action.actionKind}`,
    ...(proposal.action.recipient ? { recipient: proposal.action.recipient } : {}),
    target: proposal.action.target
  };
}

function assetFlowForProposal(proposal: ExternalProposal): ProposalReviewModel["assetFlow"] {
  if (proposal.type === "payment") {
    return {
      outgoing: [proposal.payment.amount],
      expectedIncoming: [],
      fees: []
    };
  }

  return {
    outgoing: amountsForDirection(proposal.action.assetFlow, "outgoing"),
    expectedIncoming: amountsForDirection(proposal.action.assetFlow, "expected_incoming"),
    fees: amountsForDirection(proposal.action.assetFlow, "fee")
  };
}

function amountsForDirection(
  flows: ExternalProposalAssetFlowItem[] | undefined,
  direction: ExternalProposalAssetFlowItem["direction"]
): ExternalProposalAssetAmount[] {
  return (flows ?? []).filter((flow) => flow.direction === direction).map((flow) => flow.amount);
}

function recipientsForProposal(proposal: ExternalProposal): ExternalProposalParty[] {
  if (proposal.type === "payment") {
    return [proposal.payment.recipient];
  }
  const recipients = [
    ...(proposal.action.recipient ? [proposal.action.recipient] : []),
    ...(proposal.action.assetFlow ?? []).flatMap((flow) => (flow.recipient ? [flow.recipient] : []))
  ];
  return dedupeParties(recipients);
}

function targetsForProposal(proposal: ExternalProposal): Array<string | ExternalProposalActionTarget> {
  if (proposal.type === "payment") {
    return proposal.payment.target ? [proposal.payment.target] : [];
  }
  return [proposal.action.target];
}

function dedupeParties(parties: ExternalProposalParty[]): ExternalProposalParty[] {
  const seen = new Set<string>();
  return parties.filter((party) => {
    const key = `${party.address ?? ""}|${party.label ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toDisplayIntentAmount(amount: ExternalProposalAssetAmount) {
  return {
    symbol: amount.symbol ?? amount.denomination ?? "unspecified_asset",
    amount: amount.amountDisplay,
    ...(amount.coinType ? { coinType: amount.coinType } : {}),
    amountKind: "display_intent" as const
  };
}

function partyLabel(party: ExternalProposalParty): string {
  return party.label ?? party.address ?? "unspecified recipient";
}

function amountLabel(amount: ExternalProposalAssetAmount): string {
  return `${amount.amountDisplay} ${amount.symbol ?? amount.denomination ?? "unspecified asset"}`;
}
