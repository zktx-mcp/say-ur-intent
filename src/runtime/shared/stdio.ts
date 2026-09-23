import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, CallToolResultSchema, CompleteRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "../../mcp/serverInfo.js";
import { createAuthenticatedFetch, probeAuthenticatedServer } from "./authenticatedFetch.js";
import { INTERNAL_MCP_PATH, type ControlIdentity } from "./control.js";

// The SDK owns request IDs, initialization, cancellation and response parsing.
// This proxy has no domain services or writable stores. A new request may open a
// new MCP session after ownership changes; an already dispatched call is never replayed.
export async function startSharedStdio(input: {
  stdio: Transport; port: number; control: ControlIdentity; onError(error: Error): void;
}) {
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, {
    capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} }, instructions: SERVER_INSTRUCTIONS
  });
  let connection: { instanceId: string; client: Client } | undefined;
  let connecting: Promise<Client> | undefined;
  let closed = false;
  async function owner(signal?: AbortSignal): Promise<Client> {
    if (closed) throw new Error("MCP connection is closed.");
    if (connecting) return connecting;
    const identity = await probeAuthenticatedServer(input.port, input.control);
    signal?.throwIfAborted();
    if (connection?.instanceId === identity.instanceId) return connection.client;
    if (connecting) return connecting;
    const open = (async () => {
      await connection?.client.close(); connection = undefined;
      if (closed) throw new Error("MCP connection is closed.");
      const clientInfo = server.getClientVersion();
      if (!clientInfo) throw new Error("MCP client initialization is required.");
      const client = new Client(clientInfo, { capabilities: server.getClientCapabilities() ?? {} });
      const http = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${input.port}${INTERNAL_MCP_PATH}`), {
        fetch: createAuthenticatedFetch(input.port, input.control, identity.instanceId)
      });
      const transport: Transport = {
        start: () => http.start(), send: (message, options) => http.send(message, options),
        setProtocolVersion: (version) => http.setProtocolVersion(version),
        close: async () => { try { await http.terminateSession(); } catch { /* The prior owner may already be gone. */ } await http.close(); }
      };
      http.onmessage = (message) => { if (http.sessionId !== undefined) transport.sessionId = http.sessionId; transport.onmessage?.(message); };
      http.onerror = (error) => transport.onerror?.(error);
      http.onclose = () => transport.onclose?.();
      try {
        await client.connect(transport, signal === undefined ? undefined : { signal });
        if (closed) { await client.close(); throw new Error("MCP connection is closed."); }
        connection = { instanceId: identity.instanceId, client };
        return client;
      } catch (error) { await client.close(); throw error; }
    })();
    connecting = open;
    try { return await open; } finally { if (connecting === open) connecting = undefined; }
  }
  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).listTools(request.params, { signal: extra.signal }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).callTool(request.params, CallToolResultSchema, { signal: extra.signal }));
  server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).listResources(request.params, { signal: extra.signal }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).listResourceTemplates(request.params, { signal: extra.signal }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).readResource(request.params, { signal: extra.signal }));
  server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).listPrompts(request.params, { signal: extra.signal }));
  server.setRequestHandler(GetPromptRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).getPrompt(request.params, { signal: extra.signal }));
  server.setRequestHandler(CompleteRequestSchema, async (request, extra) =>
    (await owner(extra.signal)).complete(request.params, { signal: extra.signal }));
  server.onerror = input.onError;
  await server.connect(input.stdio);
  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await server.close();
      try { await connecting; } catch { /* Initialization was cancelled with the stdio connection. */ }
      await connection?.client.close(); connection = undefined;
    }
  };
}
