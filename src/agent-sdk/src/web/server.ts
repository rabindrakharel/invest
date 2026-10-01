import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentGraph } from "../agents/catalog.js";
import { loadAgentGraph } from "../agents/catalog.js";
import { loadRuntimeConfig } from "../config/load.js";
import { fromSdkRoot } from "../config/paths.js";
import type { RuntimeConfig } from "../domain/types.js";
import type { WebAnswer } from "./prompter.js";
import { listRuns, readRunLog, runsRoot } from "./logs.js";
import { defaultDataDir, readDocument, readOutlook, readVerdicts, researchIndex, tickerDossier } from "./research.js";
import { ChatSession, type SessionLike } from "./session.js";

export const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SESSIONS = 20;

const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "assets/web/index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "assets/web/app.js", type: "text/javascript; charset=utf-8" },
  "/ui.js": { file: "assets/web/ui.js", type: "text/javascript; charset=utf-8" },
  "/research.js": { file: "assets/web/research.js", type: "text/javascript; charset=utf-8" },
  "/logs.js": { file: "assets/web/logs.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "assets/web/styles.css", type: "text/css; charset=utf-8" },
};

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

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Body is not valid JSON"), { status: 400 }); }
}

const sameToken = (given: string | undefined, expected: string) => {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
};

/**
 * The local web chat. It can run shell commands and spend money on the operator's behalf, so it is
 * locked down like a local admin tool: loopback only, a Host allowlist (DNS rebinding), a same-origin
 * check on every write (CSRF from another site's page), and a per-launch token on every API call.
 */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const config = options.config ?? await loadRuntimeConfig();
  const graph = options.graph ?? await loadAgentGraph();
  const token = options.token ?? randomBytes(24).toString("hex");
  const sessions = new Map<string, SessionLike>();
  const createSession = options.createSession ?? ((agent: string) => new ChatSession(agent, config, graph));
  const dataDir = options.dataDir ?? defaultDataDir();
  const runsDir = options.runsDir ?? runsRoot(config.runsDirectory);
  let port = options.port ?? DEFAULT_PORT;

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const prune = () => {
    for (const [id, session] of sessions) if (session.closed) sessions.delete(id);
    while (sessions.size >= MAX_SESSIONS) { const oldest = sessions.keys().next().value as string; sessions.get(oldest)?.close(); sessions.delete(oldest); }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? "";
    if (!allowedHosts().has(host)) return json(res, 403, { error: "Forbidden host" });
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    const asset = method === "GET" ? STATIC[path] : undefined;
    if (asset) {
      let body = await readFile(fromSdkRoot(asset.file), "utf8");
      if (path === "/") body = body.replace("__TOKEN__", token);
      res.writeHead(200, {
        "content-type": asset.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; frame-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(body);
      return;
    }

    if (!path.startsWith("/api/")) return json(res, 404, { error: "Not found" });
    if (!sameToken(req.headers["x-invest-token"] as string | undefined ?? url.searchParams.get("token") ?? undefined, token)) return json(res, 401, { error: "Missing or wrong token" });
    if (method !== "GET") {
      const origin = req.headers.origin;
      if (origin !== `http://${host}`) return json(res, 403, { error: "Cross-origin request refused" });
    }

    if (method === "GET" && path === "/api/agents") {
      return json(res, 200, { default: config.defaultAgent, agents: [...graph.orchestrators.values()].map((spec) => ({ name: spec.name, description: spec.description, roster: spec.handoffs })) });
    }
    if (path.startsWith("/api/research")) {
      if (method !== "GET") return json(res, 405, { error: "The research view is read-only" });
      if (path === "/api/research") return json(res, 200, await researchIndex(dataDir));
      if (path === "/api/research/outlook") {
        const found = await readOutlook(dataDir, url.searchParams.get("date") ?? undefined);
        return found ? json(res, 200, found) : json(res, 404, { error: "No outlook on file yet" });
      }
      if (path === "/api/research/ledger") return json(res, 200, { verdicts: await readVerdicts(dataDir) });
      const ticker = /^\/api\/research\/tickers\/([A-Za-z0-9.]{1,10})$/.exec(path);
      if (ticker) return json(res, 200, await tickerDossier(ticker[1]!, dataDir));
      if (path === "/api/research/doc" || path === "/api/research/page") {
        const document = await readDocument(url.searchParams.get("path") ?? "", dataDir);
        if (path === "/api/research/doc") return json(res, 200, document);
        // Probe pages are standalone HTML written by the skills: served sandboxed, so their script cannot reach this origin.
        res.writeHead(200, {
          "content-type": document.kind === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:",
        });
        res.end(document.body);
        return;
      }
      return json(res, 404, { error: "Not found" });
    }
    if (method === "GET" && path === "/api/sessions") {
      return json(res, 200, { sessions: [...sessions.values()].reverse().map((s) => ({ id: s.id, agent: s.agent, title: s.title, startedAt: s.startedAt, state: s.state, closed: s.closed, ...(s.runId ? { runId: s.runId } : {}) })) });
    }
    if (method === "GET" && path === "/api/runs") return json(res, 200, { runs: await listRuns(runsDir) });
    const runLog = /^\/api\/runs\/([\w.-]+)\/events$/.exec(path);
    if (method === "GET" && runLog) return json(res, 200, await readRunLog(runsDir, runLog[1]!));
    if (method === "POST" && path === "/api/sessions") {
      const body = (await readBody(req)) as { agent?: unknown };
      const agent = typeof body.agent === "string" ? body.agent : config.defaultAgent;
      if (!graph.orchestrators.has(agent)) return json(res, 400, { error: `'${agent}' is not an orchestrator` });
      prune();
      const session = createSession(agent);
      sessions.set(session.id, session);
      return json(res, 201, { id: session.id, agent });
    }

    const match = /^\/api\/sessions\/([\w-]+)\/(events|messages|answer|interrupt|artifacts\/(\d+))$/.exec(path);
    const solo = /^\/api\/sessions\/([\w-]+)$/.exec(path);
    const session = sessions.get((match ?? solo)?.[1] ?? "");
    if (!match && !solo) return json(res, 404, { error: "Not found" });
    if (!session) return json(res, 404, { error: "No such conversation" });

    if (solo && method === "GET") return json(res, 200, { id: session.id, agent: session.agent, closed: session.closed });
    if (solo && method === "DELETE") { session.close(); sessions.delete(session.id); return json(res, 200, { ok: true }); }
    if (!match) return json(res, 405, { error: "Method not allowed" });
    const action = match[2]!;

    if (action === "events" && method === "GET") {
      const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write("retry: 2000\n\n");
      const write = (event: { seq: number }) => res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      for (const event of session.events) if (event.seq > after) write(event);
      const unsubscribe = session.subscribe(write);
      const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
      req.on("close", () => { clearInterval(keepAlive); unsubscribe(); });
      return;
    }
    if (action === "messages" && method === "POST") {
      const body = (await readBody(req)) as { text?: unknown };
      if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { error: "text is required" });
      // The run may take minutes; the page follows it over the event stream, so answer at once.
      void session.send(body.text).catch(() => undefined);
      return json(res, 202, { ok: true });
    }
    if (action === "answer" && method === "POST") {
      const body = (await readBody(req)) as { id?: unknown; answers?: unknown };
      if (typeof body.id !== "string" || !Array.isArray(body.answers)) return json(res, 400, { error: "id and answers are required" });
      return session.answer(body.id, body.answers as WebAnswer[]) ? json(res, 200, { ok: true }) : json(res, 422, { error: "That answer does not match the question, or it was already answered" });
    }
    if (action === "interrupt" && method === "POST") { await session.interrupt(); return json(res, 200, { ok: true }); }
    if (match[3] && method === "GET") {
      const document = session.artifact(Number(match[3]));
      if (!document) return json(res, 404, { error: "No such artifact" });
      // Served as a download-safe standalone page: sandboxed so its script cannot reach this origin.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:", "cache-control": "no-store" });
      res.end(document);
      return;
    }
    return json(res, 405, { error: "Method not allowed" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = (error as { status?: number }).status ?? 500;
      if (!res.headersSent) json(res, status, { error: error instanceof Error ? error.message : String(error) });
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
      for (const session of sessions.values()) session.close();
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}
