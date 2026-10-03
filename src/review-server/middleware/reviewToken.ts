import type { IncomingHttpHeaders } from "node:http";

export function readReviewToken(headers: IncomingHttpHeaders): string | undefined {
  const headerValue = headers["x-sui-mcp-token"];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }
  return undefined;
}
