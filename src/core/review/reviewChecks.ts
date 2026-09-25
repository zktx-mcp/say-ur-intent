import type { ReviewCheck } from "../action/types.js";

export function adapterNotImplementedCheck(): ReviewCheck {
  return {
    id: "adapter_not_implemented",
    label: "Adapter review",
    status: "fail",
    message: "No review adapter is registered for this action plan; the review fails closed and signing remains blocked for this session.",
    source: "adapter"
  };
}

export function accountBoundReviewRequiredCheck(): ReviewCheck {
  return {
    id: "account_bound_review_required",
    label: "Account-bound review",
    status: "warning",
    message:
      "Connect a wallet account to compute DeepBook review evidence and adapter lifecycle stages. This does not provide signing data, signing readiness, wallet handoff, or execution.",
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
      "This action plan is labelled for the DeepBook swap adapter but does not match the DeepBookV3 swap review identity.",
    source: "adapter"
  };
}

export function unsupportedFlowxSwapPlanIdentityCheck(): ReviewCheck {
  return {
    id: "flowx_swap_plan_identity_invalid",
    label: "FlowX plan identity",
    status: "fail",
    message:
      "This action plan is labelled for the FlowX swap adapter but does not match the FlowXCLMM swap review identity.",
    source: "adapter"
  };
}

export function externalProposalReviewOnlyCheck(): ReviewCheck {
  return {
    id: "external_proposal_review_only",
    label: "Non-signable review",
    status: "fail",
    message:
      "External proposal ingestion is read-only; it does not build transactions, request signatures, or create wallet actions.",
    source: "adapter"
  };
}
