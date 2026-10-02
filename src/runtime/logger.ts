export type Logger = {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

export function flushStderr(): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => { process.stderr.off("error", failed); reject(error); };
    process.stderr.once("error", failed);
    process.stderr.write("", (error) => {
      // A failed stream write also emits error; keep its handler through that
      // event instead of allowing EPIPE to replace the intended exit code.
      if (error) { reject(error); return; }
      process.stderr.off("error", failed); resolve();
    });
  });
}

export function createStderrLogger(scope: string): Logger {
  const write = (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => {
    const record = {
      level,
      scope,
      message,
      meta: meta ? redactMeta(meta) : undefined,
      at: new Date().toISOString()
    };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  };

  return {
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

const REDACTED = "[redacted]";
const CIRCULAR = "[circular]";
const SENSITIVE_META_KEY = /token|secret|private|signature|bytes/i;

export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return redactRecord(meta, new WeakSet<object>());
}

function redactRecord(
  record: Record<string, unknown>,
  seen: WeakSet<object>
): Record<string, unknown> {
  if (seen.has(record)) {
    return { value: CIRCULAR };
  }
  seen.add(record);

  const redacted = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_META_KEY.test(key) ? REDACTED : redactValue(value, seen)
    ])
  );
  seen.delete(record);
  return redacted;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);
    const redacted = value.map((item) => redactValue(item, seen));
    seen.delete(value);
    return redacted;
  }

  return redactRecord(value as Record<string, unknown>, seen);
}
