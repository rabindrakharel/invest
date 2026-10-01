import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentGraph } from "../agents/catalog.js";
import { loadAgentGraph } from "../agents/catalog.js";
import { loadRuntimeConfig } from "../config/load.js";
import { fromSdkRoot } from "../config/paths.js";
import type { RuntimeConfig } from "../domain/types.js";
import { dispatch, json, statusOf, type Route } from "./http.js";
import { runsRoot } from "./logs.js";
import { defaultDataDir } from "./research.js";
import { chatRoutes } from "./routes/chat.js";
import { logRoutes } from "./routes/logs.js";
import { researchRoutes } from "./routes/research.js";
import { ChatSession, type SessionLike } from "./session.js";
import { SessionStore } from "./sessions.js";

export const DEFAULT_PORT = 4317;
const MAX_SESSIONS = 20;

const STATIC: Record<string, { file: string; type: string }> = Object.fromEntries([
  ["/", "index.html", "text/html"],
  ...["app.js", "ui.js", "orch.js", "hitl.js", "logs.js", "research.js"].map((file) => [`/${file}`, file, "text/javascript"]),
  ["/styles.css", "styles.css", "text/css"],
].map(([path, file, type]) => [path!, { file: `assets/web/${file}`, type: `${type}; charset=utf-8` }]));
const PAGE_CSP = "default-src 'self'; frame-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface ServerOptions {
  port?: number;
  /** Loopback only, always. Exposed so tests can ask for an ephemeral port. */
  host?: "127.0.0.1";
  createSession?: (agent: string) => SessionLike;
  /** Overrides for tests. */
  config?: RuntimeConfig;
  graph?: AgentGraph;
  token?: string;
  /** The data/ tree the research view reads; defaults to INVEST_DATA_DIR or the repo's data/. */
  dataDir?: string;
  /** Where run workspaces live (the Logs tab's past runs); defaults to AGENT_RUNS_DIR or runtime.yaml's runsDirectory. */
  runsDir?: string;
}

export interface RunningServer { server: Server; port: number; url: string; token: string; close(): Promise<void> }

const sameToken = (given: string | undefined, expected: string) =>
  Boolean(given) && given!.length === expected.length && timingSafeEqual(Buffer.from(given!), Buffer.from(expected));

/**
 * The local web app: chat with an orchestrator, its logs, and the research on disk. It can run shell commands and
 * spend money on the operator's behalf, so it is locked down like a local admin tool: loopback only, a Host
 * allowlist (DNS rebinding), a same-origin check on every write (CSRF from another site's page), and a per-launch
 * token on every API call. Those checks live here; each feature's routes live in routes/.
 */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const config = options.config ?? await loadRuntimeConfig();
  const graph = options.graph ?? await loadAgentGraph();
  const token = options.token ?? randomBytes(24).toString("hex");
  const sessions = new SessionStore(options.createSession ?? ((agent) => new ChatSession(agent, config, graph)), MAX_SESSIONS);
  const routes: Route[] = [
    ...chatRoutes(config, graph, sessions),
    ...logRoutes(options.runsDir ?? runsRoot(config.runsDirectory)),
    ...researchRoutes(options.dataDir ?? defaultDataDir()),
  ];
  let port = options.port ?? DEFAULT_PORT;

  const serveStatic = async (res: ServerResponse, path: string): Promise<boolean> => {
    const asset = STATIC[path];
    if (!asset) return false;
    let body = await readFile(fromSdkRoot(asset.file), "utf8");
    if (path === "/") body = body.replace("__TOKEN__", token);
    res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": PAGE_CSP });
    res.end(body);
    return true;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 403, { error: "Forbidden host" });
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    if (method === "GET" && await serveStatic(res, url.pathname)) return;
    if (!url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
    if (!sameToken((req.headers["x-invest-token"] as string | undefined) ?? url.searchParams.get("token") ?? undefined, token)) return json(res, 401, { error: "Missing or wrong token" });
    if (method !== "GET" && req.headers.origin !== `http://${host}`) return json(res, 403, { error: "Cross-origin request refused" });
    const found = dispatch(routes, method, url.pathname);
    if ("status" in found) return json(res, found.status, { error: found.status === 405 ? "Method not allowed" : "Not found" });
    await found.route.handle({ req, res, url, params: found.params });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) json(res, statusOf(error), { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, options.host ?? "127.0.0.1", () => resolveListen());
  });
  port = (server.address() as AddressInfo).port;
  return {
    server, port, token, url: `http://127.0.0.1:${port}`,
    close: async () => {
      sessions.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}
