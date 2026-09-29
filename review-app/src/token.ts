// Bearer-token reader for the remaining Settings page. The token is the URL fragment value after "#";
// it is never a query parameter, which would leak into server logs and browser
// history. Every request to a token-gated endpoint carries the token in the
// header below, which the server checks with a constant-time compare.
const TOKEN_HEADER = "x-say-ur-intent-token";

export function readPageToken(): string {
  const hash = window.location.hash;
  return hash.startsWith("#") ? hash.slice(1) : "";
}

export function tokenHeaders(
  token: string,
  extra?: Record<string, string>
): Record<string, string> {
  return { ...extra, [TOKEN_HEADER]: token };
}
