import { fromBase58, toHex } from "@mysten/sui/utils";
import { SUI_MAINNET_CHAIN_IDENTIFIER } from "../src/runtime/suiEndpoint.js";

export const PURPOSE = "sui_cli_transaction_debug_evidence";
export const AUTHORITY = "debug_only_not_signing_readiness";
export const DEFAULT_READ_TIMEOUT_MS = 15_000;
export const DEFAULT_REPLAY_TIMEOUT_MS = 120_000;
export const DEFAULT_ANALYZE_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_SUI_CLI_STDIO_BUFFER_BYTES = 64 * 1024 * 1024;
export const MAX_OBJECT_IDS = 20;
export const SNIPPET_LIMIT = 500;
export const DECLARED_NETWORK = "mainnet";
export const SOURCE_CHECKED_SUI_CLI_VERSION = "1.71.1";
export const TEMP_ARTIFACT_DIR_PREFIX = "sui-mcp-sui-cli-diagnostics-";
export const UNSAFE_OUTPUT_DIR_MARKER = "[UNAVAILABLE_UNSAFE_PATH]";
export const INVALID_CLIENT_ENV_MARKER = "[UNAVAILABLE_INVALID_ALIAS]";
// Verified against Sui CLI 1.71.1 source: replay writes this trace inside the digest-specific replay output directory.
// Unsupported replay layouts report replay_layout_drift and fall back to one discovered .json.zst file.
export const TRACE_ARTIFACT_FILENAME = "trace.json.zst";
export const GAS_PROFILE_FILE_PREFIX = "gas_profile_";

// Usage is printed directly to stderr. Do not route it through redaction because it intentionally
// lists the literal rejection terms users need to remove from aliases or artifact paths.
export const SUI_CLI_TRANSACTION_DIAGNOSTICS_USAGE = `Usage:
  npm exec -- tsx scripts/sui-cli-transaction-diagnostics.ts --digest <digest> [options]

Required:
  --digest <digest>                  Sui transaction digest to inspect.

Read/debug options:
  --object <objectId>                Inspect one related object. Repeatable, max ${MAX_OBJECT_IDS}.
  --trace                            Run allowlisted \`sui replay --trace\` and record artifact paths.
  --gas-profile                      Run allowlisted gas profile analysis. Requires exactly one trace source.
  --trace-file <path>                Use an existing .json.zst trace file for gas profile analysis.
  --output-dir <dir>                 Artifact root under .WORK/sui-cli-diagnostics or a dedicated OS temp diagnostics dir.
  --mainnet                          Select exactly one existing CLI env alias whose chain id matches mainnet.
  --client-env <alias>               Use an explicit existing CLI env alias without mutating config.
  --read-timeout-ms <ms>             Per read subprocess timeout, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}, default ${DEFAULT_READ_TIMEOUT_MS}.
  --replay-timeout-ms <ms>           Per replay subprocess timeout, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}, default ${DEFAULT_REPLAY_TIMEOUT_MS}.
  --analyze-timeout-ms <ms>          Per analyze-trace subprocess timeout, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}, default ${DEFAULT_ANALYZE_TIMEOUT_MS}.
  -h, --help                         Print this help text.

Boundary:
  Manual source-checkout debug utility only. Not MCP, not CI, not packaged product functionality,
  not onchain transaction submission/execution, not wallet authorization, not signing readiness,
  and not review-time simulation. Local replay is debug evidence only. CLI env aliases must not
  contain redaction markers. Artifact paths, including the default cwd-based output path, must
  not contain Sui private key material and are redacted in output when they contain
  redaction-pattern text.

Rejection rules:
  --client-env aliases must not contain word forms of private key, mnemonic, signature,
  signed transaction, or transaction bytes using "-", "_", a space, or no separator;
  aliases also must not contain suiprivkey-style markers.
  --output-dir and --trace-file paths must not contain suiprivkey-style markers. Paths that
  only contain other redaction markers are accepted, and those markers are redacted in the
  output JSON.
`;

export const FORBIDDEN_SUI_CLI_TERMS = [
  "keytool",
  "suiprivkey",
  "mnemonic",
  "private-key",
  "private key",
  "sign",
  "sign-kms",
  "execute",
  "execute-signed-tx",
  "serialized-tx",
  "transaction bytes",
  "call",
  "ptb",
  "publish",
  "upgrade",
  "pay",
  "pay-sui",
  "pay-all-sui",
  "transfer",
  "transfer-sui",
  "split-coin",
  "merge-coin",
  "faucet",
  "new-address",
  "switch",
  "new-env",
  "--yes"
] as const;

export type SuiCliCommandSpec = {
  name: string;
  command: "sui";
  args: string[];
  shell: false;
  timeoutMs: number;
};

export type SuiCliCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean | undefined;
  error?: string | undefined;
};

export type SuiCliCommandRunner = (spec: SuiCliCommandSpec) => SuiCliCommandResult;

export type DiagnosticsInput = {
  digest: string;
  objectIds: string[];
  mainnet: boolean;
  clientEnv?: string | undefined;
  trace: boolean;
  gasProfile: boolean;
  traceFile?: string | undefined;
  outputDir: string;
  readTimeoutMs: number;
  replayTimeoutMs: number;
  analyzeTimeoutMs: number;
};

export type DiagnosticsContext = {
  cwd: string;
  now: Date;
  runner: SuiCliCommandRunner;
};

export type CommandOutput = {
  name: string;
  args: string[];
  argsRedacted: boolean;
  exitCode: number | null;
  durationMs: number;
  timeoutMs: number;
  timeout: boolean;
  error?: string;
  stdoutSnippet?: string;
  stderrSnippet?: string;
};

export type LimitationDetail = {
  kind: string;
  source?: string;
};

export type SuiCliDiagnosticsOutput = {
  generatedAt: string;
  purpose: typeof PURPOSE;
  authority: typeof AUTHORITY;
  suiCli: {
    declaredNetwork: typeof DECLARED_NETWORK;
    expectedBase58ChainIdentifier: string;
    expectedCliChainIdentifier: string;
    sourceCheckedVersion: string;
    version?: string;
    activeEnv?: string;
    selectedEnv?: string;
    chainIdentifier?: string;
  };
  input: {
    digest?: string;
    objectIds: string[];
    mainnet?: boolean;
    clientEnv?: string;
    trace: boolean;
    gasProfile: boolean;
    traceFile?: string;
    outputDir: string | null;
    timeouts?: {
      readMs: number;
      replayMs: number;
      analyzeMs: number;
    };
  };
  commands: CommandOutput[];
  limitations: string[];
  limitationDetails: LimitationDetail[];
  error?: {
    kind: string;
    message: string;
  };
  txBlockSummary?: SuiCliTxBlockSummary;
  objectSummaries?: SuiCliObjectSummary[];
  replay?: {
    outputDir: string;
    transactionOutputDir: string;
    traceFiles: string[];
  };
  gasProfile?: {
    outputDir: string;
    profileFiles: string[];
  };
};

export type SuiCliDiagnosticsRunResult = {
  exitCode: number;
  output: SuiCliDiagnosticsOutput;
};

export type SuiCliTxBlockCountField = "objectChanges" | "balanceChanges" | "events";

export type SuiCliTxBlockSummary = {
  source: "sui_cli_transaction_block_response";
  sourceCheckedVersion: typeof SOURCE_CHECKED_SUI_CLI_VERSION;
  sourceVersionMatchesInstalledCli: boolean;
  topLevelKeys: string[];
  effectsAvailable: boolean;
  countFieldsUnavailable?: SuiCliTxBlockCountField[];
  digest?: string;
  status?: "success" | "failure" | "unknown";
  unrecognizedExecutionStatus?: string;
  executionError?: string;
  executionErrorTruncated?: boolean;
  checkpoint?: string;
  timestampMs?: string;
  gas?: {
    computationCostRaw?: string;
    storageCostRaw?: string;
    storageRebateRaw?: string;
    nonRefundableStorageFeeRaw?: string;
    netGasCostRaw?: string;
  };
  counts: {
    objectChanges?: number;
    balanceChanges?: number;
    events?: number;
    dependencies?: number;
    created?: number;
    mutated?: number;
    deleted?: number;
    wrapped?: number;
    unwrapped?: number;
    unwrappedThenDeleted?: number;
  };
};

export type SuiCliObjectSummary = {
  source: "sui_cli_object_output";
  sourceCheckedVersion: typeof SOURCE_CHECKED_SUI_CLI_VERSION;
  sourceVersionMatchesInstalledCli: boolean;
  requestedObjectId: string;
  objectId?: string;
  version?: string;
  digest?: string;
  objectType?: string;
  ownerKind?: string;
  previousTransaction?: string;
  storageRebateRaw?: string;
  contentShape?: {
    topLevelKeys: string[];
    topLevelFieldTypes: Record<string, string>;
  };
};

export class DiagnosticsInputError extends Error {
  readonly kind = "input_invalid";

  constructor(message: string) {
    super(message);
    this.name = "DiagnosticsInputError";
  }
}

export class DiagnosticsAllowlistError extends Error {
  readonly kind = "allowlist_violation";

  constructor(message: string) {
    super(message);
    this.name = "DiagnosticsAllowlistError";
  }
}

export function expectedMainnetCliChainIdentifier(): string {
  return toHex(fromBase58(SUI_MAINNET_CHAIN_IDENTIFIER).slice(0, 4));
}
