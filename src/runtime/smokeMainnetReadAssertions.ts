export class SmokeResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeResponseShapeError";
  }
}

export type ActivitySmokeStatus = "ok" | "empty_page";

export type ActivitySmokeRecord = {
  status: ActivitySmokeStatus;
  rowCount: number;
  emptyAccepted: boolean;
  transactionCount: number;
  account: string;
  accountSource: "active_account_context" | "explicit_filter";
  relationship: "affected" | "sent";
  functionTargetPresent?: boolean | undefined;
  sourceTransport: "graphql";
  sourceMethod: "Query.transactions";
  hasMore: boolean;
  windowComplete: boolean | null;
  orderingVerified: boolean;
  persistenceStored: boolean;
  requestedAccountBalanceChangeCompleteness: "complete" | "truncated" | "unavailable";
  requestedAccountCoinFlowCount: number;
  requestedAccountSentCount: number;
  requestedAccountAffectedOnlyCount: number;
  requestedAccountTransactionFactCount: number;
  requestedAccountTransactionFactBalanceChangeRowCount: number;
  fullDetailsReturned: boolean;
  compactReturned: boolean;
  compactBalanceChangeRowCount: number;
  compactAggregatedBalanceChangeRowCount: number;
  transactionContextCount: number;
  requestedAccountEffectBalanceChangeRowCount: number;
  requestedAccountEffectTruncatedTransactionCount: number;
  analysisLimitationCount?: number | undefined;
  analysisCoinFlowCount?: number | undefined;
};

export function assertSmokeOkStatus(payload: Record<string, unknown>, toolName: string): void {
  const data = objectValue(payload.data);
  if (payload.ok !== true || data?.status !== "ok") {
    throw new SmokeResponseShapeError(`Tool ${toolName} did not return ok status: ${JSON.stringify(payload)}`);
  }
}

export function summarizeActivitySmokePayload(
  payload: Record<string, unknown>,
  toolName: string,
  options: {
    expectedAccountSource: "active_account_context" | "explicit_filter";
    expectedRelationship?: "affected" | "sent" | undefined;
    requireFunction?: boolean | undefined;
    requireAnalysis: boolean;
    expectNoDetails?: boolean | undefined;
  }
): ActivitySmokeRecord {
  assertSmokeOkStatus(payload, toolName);
  const data = requiredObject(payload.data, `${toolName}.data`);
  const source = requiredObject(data.source, `${toolName}.data.source`);
  const persistence = requiredObject(data.persistence, `${toolName}.data.persistence`);
  const requestedAccount = requiredObject(data.requestedAccount, `${toolName}.data.requestedAccount`);
  const transactions = requiredArray(data.transactions, `${toolName}.data.transactions`);
  const account = requiredString(data.account, `${toolName}.data.account`);
  const accountSource = requiredAccountSource(data.accountSource, `${toolName}.data.accountSource`);
  const relationship = requiredRelationship(data.relationship, `${toolName}.data.relationship`);
  const functionTarget = options.requireFunction
    ? requiredString(data.function, `${toolName}.data.function`)
    : undefined;
  const sourceTransport = requiredLiteral(source.transport, "graphql", `${toolName}.data.source.transport`);
  const sourceMethod = requiredLiteral(source.method, "Query.transactions", `${toolName}.data.source.method`);
  const hasMore = requiredBoolean(data.hasMore, `${toolName}.data.hasMore`);
  const windowComplete = requiredBooleanOrNull(data.windowComplete, `${toolName}.data.windowComplete`);
  const orderingVerified = requiredBoolean(data.orderingVerified, `${toolName}.data.orderingVerified`);
  const persistenceStored = requiredBoolean(persistence.stored, `${toolName}.data.persistence.stored`);
  const requestedAccountBalanceChangeCompleteness = requiredBalanceChangeCompleteness(
    requestedAccount.balanceChangeCompleteness,
    `${toolName}.data.requestedAccount.balanceChangeCompleteness`
  );
  const requestedAccountCoinFlows = requiredArray(
    requestedAccount.coinFlows,
    `${toolName}.data.requestedAccount.coinFlows`
  );
  const requestedAccountSentCount = requiredNonnegativeInteger(
    requestedAccount.sentCount,
    `${toolName}.data.requestedAccount.sentCount`
  );
  const requestedAccountAffectedOnlyCount = requiredNonnegativeInteger(
    requestedAccount.affectedOnlyCount,
    `${toolName}.data.requestedAccount.affectedOnlyCount`
  );
  const requestedAccountTransactionFacts = requiredArray(
    data.requestedAccountTransactionFacts,
    `${toolName}.data.requestedAccountTransactionFacts`
  );
  const accountFactSummary = summarizeRequestedAccountTransactionFacts(
    requestedAccountTransactionFacts,
    transactions.length,
    toolName
  );
  const compactSummary = summarizeCompactResponseSupport(transactions, toolName);
  let analysisLimitationCount: number | undefined;
  let analysisCoinFlowCount: number | undefined;

  if (accountSource !== options.expectedAccountSource) {
    throw new SmokeResponseShapeError(
      `${toolName}.data.accountSource expected ${options.expectedAccountSource}, got ${accountSource}`
    );
  }
  if (options.expectedRelationship !== undefined && relationship !== options.expectedRelationship) {
    throw new SmokeResponseShapeError(
      `${toolName}.data.relationship expected ${options.expectedRelationship}, got ${relationship}`
    );
  }

  if (options.requireAnalysis) {
    const analysis = requiredObject(data.analysis, `${toolName}.data.analysis`);
    const overview = requiredObject(analysis.overview, `${toolName}.data.analysis.overview`);
    const limitations = requiredArray(analysis.limitations, `${toolName}.data.analysis.limitations`);
    const coinFlows = requiredArray(analysis.coinFlows, `${toolName}.data.analysis.coinFlows`);
    const analysisTransactionCount = requiredNonnegativeInteger(
      overview.transactionCount,
      `${toolName}.data.analysis.overview.transactionCount`
    );
    if (analysisTransactionCount !== transactions.length) {
      throw new SmokeResponseShapeError(
        `${toolName}.data.analysis.overview.transactionCount does not match transactions.length`
      );
    }
    analysisLimitationCount = limitations.length;
    analysisCoinFlowCount = coinFlows.length;
  }

  if (options.expectNoDetails === true && compactSummary.fullDetailsReturned) {
    throw new SmokeResponseShapeError(`${toolName}.data.transactions must not include full details`);
  }
  if (options.expectNoDetails === true && compactSummary.compactReturned) {
    throw new SmokeResponseShapeError(`${toolName}.data.transactions must not include compact transaction aggregates`);
  }

  return {
    status: transactions.length === 0 ? "empty_page" : "ok",
    rowCount: transactions.length,
    emptyAccepted: transactions.length === 0,
    transactionCount: transactions.length,
    account,
    accountSource,
    relationship,
    ...(functionTarget === undefined ? {} : { functionTargetPresent: true }),
    sourceTransport,
    sourceMethod,
    hasMore,
    windowComplete,
    orderingVerified,
    persistenceStored,
    requestedAccountBalanceChangeCompleteness,
    requestedAccountCoinFlowCount: requestedAccountCoinFlows.length,
    requestedAccountSentCount,
    requestedAccountAffectedOnlyCount,
    ...accountFactSummary,
    ...compactSummary,
    ...(analysisLimitationCount === undefined ? {} : { analysisLimitationCount }),
    ...(analysisCoinFlowCount === undefined ? {} : { analysisCoinFlowCount })
  };
}

function summarizeRequestedAccountTransactionFacts(
  facts: unknown[],
  transactionCount: number,
  toolName: string
): Pick<ActivitySmokeRecord, "requestedAccountTransactionFactCount" | "requestedAccountTransactionFactBalanceChangeRowCount"> {
  if (facts.length !== transactionCount) {
    throw new SmokeResponseShapeError(
      `${toolName}.data.requestedAccountTransactionFacts length does not match transactions.length`
    );
  }

  let balanceChangeRows = 0;
  facts.forEach((factValue, factIndex) => {
    const fact = requiredObject(factValue, `${toolName}.data.requestedAccountTransactionFacts[${factIndex}]`);
    const requestedAccountEffect = requiredObject(
      fact.requestedAccountEffect,
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].requestedAccountEffect`
    );
    const evidence = requiredAccountBalanceChangeEvidence(
      fact.accountBalanceChangeEvidence,
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].accountBalanceChangeEvidence`
    );
    const inferencePolicy = requiredAccountBalanceChangeInferencePolicy(
      fact.accountBalanceChangeInferencePolicy,
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].accountBalanceChangeInferencePolicy`
    );
    const completeness = requiredBalanceChangeCompleteness(
      fact.accountBalanceChangeCompleteness,
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].accountBalanceChangeCompleteness`
    );
    requiredLiteral(
      requestedAccountEffect.scope,
      "requested_account",
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].requestedAccountEffect.scope`
    );
    const balanceChanges = requiredArray(
      fact.accountBalanceChanges,
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].accountBalanceChanges`
    );
    balanceChangeRows += balanceChanges.length;
    const nestedBalanceChanges = requiredArray(
      requestedAccountEffect.balanceChanges,
      `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].requestedAccountEffect.balanceChanges`
    );
    if (nestedBalanceChanges.length !== balanceChanges.length) {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}] accountBalanceChanges length must match requestedAccountEffect.balanceChanges length`
      );
    }
    if (completeness === "truncated" && evidence !== "incomplete_account_balance_changes") {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}] truncated account evidence must be incomplete_account_balance_changes`
      );
    }
    if (completeness === "unavailable" && evidence !== "account_balance_changes_unavailable") {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}] unavailable account evidence must be account_balance_changes_unavailable`
      );
    }
    if (completeness === "complete" && balanceChanges.length === 0 && evidence !== "no_account_balance_changes_returned") {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}] empty complete account evidence must be no_account_balance_changes_returned`
      );
    }
    if (completeness === "complete" && balanceChanges.length > 0 && evidence !== "account_balance_changes_returned") {
      throw new SmokeResponseShapeError(`${toolName} complete account rows require account_balance_changes_returned`);
    }
    if (requestedAccountEffect.balanceChangeEvidence !== evidence || requestedAccountEffect.balanceChangeCompleteness !== completeness) {
      throw new SmokeResponseShapeError(`${toolName} nested account evidence and completeness must match flat fields`);
    }
    const expectedInferencePolicy = expectedAccountBalanceChangeInferencePolicy(evidence);
    if (inferencePolicy !== expectedInferencePolicy) {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].accountBalanceChangeInferencePolicy is inconsistent with account evidence`
      );
    }
    if (requestedAccountEffect.accountBalanceChangeInferencePolicy !== inferencePolicy) {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].requestedAccountEffect.accountBalanceChangeInferencePolicy does not match flat field`
      );
    }
    const transactionContext = objectValue(fact.transactionContext);
    if (transactionContext !== undefined && Object.hasOwn(transactionContext, "balanceChanges")) {
      throw new SmokeResponseShapeError(
        `${toolName}.data.requestedAccountTransactionFacts[${factIndex}].transactionContext must not include transaction-wide balanceChanges`
      );
    }
  });

  return {
    requestedAccountTransactionFactCount: facts.length,
    requestedAccountTransactionFactBalanceChangeRowCount: balanceChangeRows
  };
}

function summarizeCompactResponseSupport(
  transactions: unknown[],
  toolName: string
): Pick<
  ActivitySmokeRecord,
  "fullDetailsReturned"
    | "compactReturned"
    | "compactBalanceChangeRowCount"
    | "compactAggregatedBalanceChangeRowCount"
    | "transactionContextCount"
    | "requestedAccountEffectBalanceChangeRowCount"
    | "requestedAccountEffectTruncatedTransactionCount"
> {
  let fullDetailsReturned = false;
  let compactReturned = false;
  let compactBalanceChangeRowCount = 0;
  let compactAggregatedBalanceChangeRowCount = 0;
  let transactionContextCount = 0;
  let requestedAccountEffectBalanceChangeRowCount = 0;
  let requestedAccountEffectTruncatedTransactionCount = 0;

  transactions.forEach((transactionValue, transactionIndex) => {
    const transaction = requiredObject(transactionValue, `${toolName}.data.transactions[${transactionIndex}]`);
    if (Object.hasOwn(transaction, "details")) {
      fullDetailsReturned = true;
    }
    const transactionContext = objectValue(transaction.transactionContext);
    if (transactionContext !== undefined) {
      transactionContextCount += 1;
      if (transactionContext.factScope !== "transaction") {
        throw new Error(
          `${toolName}.data.transactions[${transactionIndex}].transactionContext.factScope must be "transaction"`
        );
      }
      if (transactionContext.requestedAccountScoped !== false) {
        throw new Error(
          `${toolName}.data.transactions[${transactionIndex}].transactionContext.requestedAccountScoped must be false`
        );
      }
      if (Object.hasOwn(transactionContext, "balanceChanges")) {
        throw new SmokeResponseShapeError(
          `${toolName}.data.transactions[${transactionIndex}].transactionContext must not include transaction-wide balanceChanges`
        );
      }
    }
    const requestedAccountEffect = objectValue(transaction.requestedAccountEffect);
    if (requestedAccountEffect !== undefined) {
      requiredLiteral(
        requestedAccountEffect.scope,
        "requested_account",
        `${toolName}.data.transactions[${transactionIndex}].requestedAccountEffect.scope`
      );
      const completeness = requiredBalanceChangeCompleteness(
        requestedAccountEffect.balanceChangeCompleteness,
        `${toolName}.data.transactions[${transactionIndex}].requestedAccountEffect.balanceChangeCompleteness`
      );
      if (completeness === "truncated") {
        requestedAccountEffectTruncatedTransactionCount += 1;
      }
      requestedAccountEffectBalanceChangeRowCount += requiredArray(
        requestedAccountEffect.balanceChanges,
        `${toolName}.data.transactions[${transactionIndex}].requestedAccountEffect.balanceChanges`
      ).length;
    }
    const compact = objectValue(transaction.compact);
    if (compact === undefined) {
      return;
    }
    compactReturned = true;
    if (compact.factScope !== "transaction") {
      throw new Error(`${toolName}.data.transactions[${transactionIndex}].compact.factScope must be "transaction"`);
    }
    if (compact.requestedAccountScoped !== false) {
      throw new Error(
        `${toolName}.data.transactions[${transactionIndex}].compact.requestedAccountScoped must be false`
      );
    }
    const balanceChanges = requiredArray(
      compact.balanceChanges,
      `${toolName}.data.transactions[${transactionIndex}].compact.balanceChanges`
    );
    compactBalanceChangeRowCount += balanceChanges.length;
    balanceChanges.forEach((changeValue, changeIndex) => {
      const change = requiredObject(
        changeValue,
        `${toolName}.data.transactions[${transactionIndex}].compact.balanceChanges[${changeIndex}]`
      );
      if (change.count === undefined) {
        return;
      }
      const count = requiredPositiveInteger(
        change.count,
        `${toolName}.data.transactions[${transactionIndex}].compact.balanceChanges[${changeIndex}].count`
      );
      if (count > 1) {
        compactAggregatedBalanceChangeRowCount += 1;
      }
    });
  });

  return {
    fullDetailsReturned,
    compactReturned,
    compactBalanceChangeRowCount,
    compactAggregatedBalanceChangeRowCount,
    transactionContextCount,
    requestedAccountEffectBalanceChangeRowCount,
    requestedAccountEffectTruncatedTransactionCount
  };
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
  const object = objectValue(value);
  if (object === undefined) {
    throw new SmokeResponseShapeError(`${path} must be an object`);
  }
  return object;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SmokeResponseShapeError(`${path} must be an array`);
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SmokeResponseShapeError(`${path} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new SmokeResponseShapeError(`${path} must be a boolean`);
  }
  return value;
}

function requiredBooleanOrNull(value: unknown, path: string): boolean | null {
  if (typeof value !== "boolean" && value !== null) {
    throw new SmokeResponseShapeError(`${path} must be a boolean or null`);
  }
  return value;
}

function requiredNonnegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SmokeResponseShapeError(`${path} must be a nonnegative integer`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SmokeResponseShapeError(`${path} must be a positive integer`);
  }
  return value;
}

function requiredAccountSource(value: unknown, path: string): "active_account_context" | "explicit_filter" {
  if (value === "active_account_context" || value === "explicit_filter") {
    return value;
  }
  throw new SmokeResponseShapeError(`${path} must be active_account_context or explicit_filter`);
}

function requiredRelationship(value: unknown, path: string): "affected" | "sent" {
  if (value === "affected" || value === "sent") {
    return value;
  }
  throw new SmokeResponseShapeError(`${path} must be affected or sent`);
}

function requiredBalanceChangeCompleteness(value: unknown, path: string): "complete" | "truncated" | "unavailable" {
  if (value === "complete" || value === "truncated" || value === "unavailable") {
    return value;
  }
  throw new SmokeResponseShapeError(`${path} must be complete, truncated, or unavailable`);
}

function requiredAccountBalanceChangeEvidence(
  value: unknown,
  path: string
): "account_balance_changes_returned"
  | "no_account_balance_changes_returned"
  | "incomplete_account_balance_changes"
  | "account_balance_changes_unavailable" {
  if (
    value === "account_balance_changes_returned" ||
    value === "no_account_balance_changes_returned" ||
    value === "incomplete_account_balance_changes" ||
    value === "account_balance_changes_unavailable"
  ) {
    return value;
  }
  throw new SmokeResponseShapeError(`${path} must be a valid account balance-change evidence marker`);
}

function requiredAccountBalanceChangeInferencePolicy(
  value: unknown,
  path: string
): "use_returned_account_balance_changes"
  | "no_account_balance_changes_in_complete_details"
  | "do_not_infer_from_transaction_context" {
  if (
    value === "use_returned_account_balance_changes" ||
    value === "no_account_balance_changes_in_complete_details" ||
    value === "do_not_infer_from_transaction_context"
  ) {
    return value;
  }
  throw new SmokeResponseShapeError(`${path} must be a valid account balance-change inference policy`);
}

function expectedAccountBalanceChangeInferencePolicy(
  evidence: "account_balance_changes_returned"
    | "no_account_balance_changes_returned"
    | "incomplete_account_balance_changes"
    | "account_balance_changes_unavailable"
): "use_returned_account_balance_changes"
  | "no_account_balance_changes_in_complete_details"
  | "do_not_infer_from_transaction_context" {
  if (evidence === "account_balance_changes_returned") {
    return "use_returned_account_balance_changes";
  }
  if (evidence === "no_account_balance_changes_returned") {
    return "no_account_balance_changes_in_complete_details";
  }
  return "do_not_infer_from_transaction_context";
}

function requiredLiteral<T extends string>(value: unknown, expected: T, path: string): T {
  if (value === expected) {
    return expected;
  }
  throw new SmokeResponseShapeError(`${path} must be ${expected}`);
}
