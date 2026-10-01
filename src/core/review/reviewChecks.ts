import type { ReviewCheck } from "../action/types.js";

export function adapterNotImplementedCheck(): ReviewCheck {
  return {
    id: "adapter_not_implemented",
    label: "Supported transaction type",
    status: "fail",
    message: "No installed protocol adapter can review this transaction type. Wallet approval is unavailable.",
    source: "adapter"
  };
}

export function accountBoundReviewRequiredCheck(): ReviewCheck {
  return {
    id: "account_bound_review_required",
    label: "Review for your account",
    status: "warning",
    message:
      "This transaction has not been checked for a connected wallet account. Wallet approval and submission are unavailable.",
    source: "adapter"
  };
}

export function signingViaLocalReviewOnlyCheck(): ReviewCheck {
  return {
    id: "signing_via_local_review_only",
    label: "Wallet signing",
    status: "warning",
    message:
      "Wallet signing requires completed review evidence, an explicit user action in the internal Review card and approval in the wallet; the backend verifies the returned transaction digest and signer. MCP responses never contain signing data, transaction bytes, or signing readiness.",
    source: "adapter"
  };
}

export function unsupportedDeepbookSwapPlanIdentityCheck(): ReviewCheck {
  return {
    id: "deepbook_swap_plan_identity_invalid",
    label: "DeepBook plan identity",
    status: "fail",
    message:
      "The proposed transaction does not match the supported DeepBook swap format.",
    source: "adapter"
  };
}

export function externalProposalReviewOnlyCheck(): ReviewCheck {
  return {
    id: "external_proposal_review_only",
    label: "View-only proposal",
    status: "fail",
    message:
      "This external proposal is for viewing only. It does not prepare a transaction, request a signature or allow wallet actions.",
    source: "adapter"
  };
}
