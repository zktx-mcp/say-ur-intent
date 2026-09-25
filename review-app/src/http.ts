export class HttpJsonRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(`HTTP JSON request failed: ${status} ${code}`);
  }
}

export async function errorCodeFromResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // Fall through to the HTTP status code when the server did not return JSON.
  }
  return `http_${response.status}`;
}

export function messageForHttpError(error: unknown, fallback: string): string {
  if (error instanceof HttpJsonRequestError) {
    if (error.code === "wallet_request_unsettled") return "A wallet request is still being settled. Local data cannot be replaced yet.";
    return `${fallback} (${error.code})`;
  }
  return fallback;
}
