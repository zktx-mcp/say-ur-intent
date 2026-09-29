import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForNpmPublication } from "../scripts/wait-for-npm-publication.js";

const expected = { name: "@fixture/server", version: "1.2.3", mcpName: "io.github.fixture/server" };
const published = () => new Response(JSON.stringify(expected), { status: 200 });
const log = vi.fn();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z")); log.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe("public npm availability before Registry registration", () => {
  it("requires the exact public version and ownership marker without credentials or redirects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(published());
    await waitForNpmPublication(expected, { fetch, log });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe("https://registry.npmjs.org/%40fixture%2Fserver/1.2.3");
    const init = fetch.mock.calls[0]![1]!;
    expect(init).toMatchObject({ headers: { accept: "application/json" }, credentials: "omit", redirect: "manual" });
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(init.signal?.aborted).toBe(true);
    expect(log).toHaveBeenCalledWith("Confirmed public npm package @fixture/server@1.2.3 for io.github.fixture/server.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for 404 responses to become visible instead of treating upload acceptance as public", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("pending", { status: 404 }))
      .mockResolvedValueOnce(new Response("pending", { status: 404 })).mockResolvedValueOnce(published());
    let completed = false;
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 5000, pollIntervalMs: 1000 }).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(999); expect(fetch).toHaveBeenCalledOnce(); expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1001); await result;
    expect(fetch).toHaveBeenCalledTimes(3); expect(completed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["2", "Tue, 01 Jan 2030 00:00:02 GMT"])("respects Retry-After %s", async (retryAfter) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": retryAfter } })).mockResolvedValueOnce(published());
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 5000, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); await result; expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a long Retry-After by the overall deadline and does not issue another lookup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("slow down", { status: 429, headers: { "retry-after": "3600" } }));
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 2500, pollIntervalMs: 1000 });
    const rejected = expect(result).rejects.toThrow("re-run only the Registry job; do not re-publish this version");
    await vi.advanceTimersByTimeAsync(2500); await rejected;
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("stops after the deadline while a version stays missing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response("pending", { status: 404 }));
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 2500, pollIntervalMs: 1000 });
    const rejected = expect(result).rejects.toThrow("Timed out waiting for public npm package @fixture/server@1.2.3");
    await vi.advanceTimersByTimeAsync(2500); await rejected;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.some(([message]) => message.startsWith("Confirmed"))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient network error and a server error, then uses the returned facts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValueOnce(new TypeError("fixture network failure"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(published());
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 5000, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000); await result;
    expect(fetch).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([301, 400, 401, 403, 422])("fails HTTP %i immediately without masking a permanent failure", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("fixture rejection", { status }));
    await expect(waitForNpmPublication(expected, { fetch, log })).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [{ ...expected, name: "@someone/else" }, "differs from the release metadata"],
    [{ ...expected, version: "1.2.2" }, "differs from the release metadata"],
    [{ ...expected, mcpName: "io.github.someone/else" }, "differs from the release metadata"],
    [{ name: expected.name, version: expected.version }, "Public npm metadata requires mcpName"],
    [null, "Public npm metadata must be an object"], [[], "Public npm metadata must be an object"]
  ] as const)("rejects wrong or incomplete public metadata %j", async (metadata, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(metadata)));
    await expect(waitForNpmPublication(expected, { fetch, log })).rejects.toThrow(reason);
    expect(fetch).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("fails malformed JSON instead of waiting for it as an unpublished version", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("not json"));
    await expect(waitForNpmPublication(expected, { fetch, log })).rejects.toThrow("could not be decoded as JSON");
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a hung request at the consumer's 10-second request limit and can recover", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("fixture timeout", "AbortError")), { once: true });
    })).mockResolvedValueOnce(published());
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 20_000, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(9999); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1001); await result;
    expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("includes body reading in the remaining total timeout", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        init!.signal!.addEventListener("abort", () => controller.error(new DOMException("fixture body timeout", "AbortError")), { once: true });
      }
    })));
    const result = waitForNpmPublication(expected, { fetch, log, timeoutMs: 500, pollIntervalMs: 1000 });
    const rejected = expect(result).rejects.toThrow("Timed out waiting for public npm package");
    await vi.advanceTimersByTimeAsync(500); await rejected;
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("validates local metadata before network access", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(waitForNpmPublication({ name: expected.name }, { fetch, log })).rejects.toThrow("requires version");
    await expect(waitForNpmPublication(expected, { fetch, log, timeoutMs: 0 })).rejects.toThrow("positive safe integers");
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

it("runs the gate inside the downstream job before publisher installation and registration", () => {
  const workflow = readFileSync(".github/workflows/publish.yml", "utf8");
  const registryJob = workflow.split("  publish-mcp-registry:")[1]!;
  expect(registryJob).toContain("needs: publish-npm");
  expect(registryJob).toContain("if: ${{ !github.event.release.prerelease }}");
  expect(registryJob).toContain("timeout-minutes: 30");
  expect(registryJob).toContain("node-version: 22");
  const verify = registryJob.indexOf("- name: Verify MCP Registry package metadata");
  const wait = registryJob.indexOf("run: node scripts/wait-for-npm-publication.ts");
  const install = registryJob.indexOf("- name: Install mcp-publisher");
  const publish = registryJob.indexOf("run: ./mcp-publisher publish");
  expect(verify).toBeGreaterThan(-1); expect(wait).toBeGreaterThan(verify);
  expect(install).toBeGreaterThan(wait); expect(publish).toBeGreaterThan(install);
  expect(registryJob).not.toMatch(/continue-on-error|always\(\)|npm publish|npm-publish@/);
});
