import type { AgentGraph } from "../../agents/catalog.js";
import type { RuntimeConfig } from "../../domain/types.js";
import { CSP, HttpError, json, readBody, route, sandboxedPage, type RequestContext, type Route } from "../http.js";
import type { WebAnswer } from "../prompter.js";
import type { SessionLike } from "../session.js";
import type { SessionStore } from "../sessions.js";

/** The chat: the orchestrators on offer, and one conversation's lifecycle, event stream, answers and presented pages. */
export function chatRoutes(config: RuntimeConfig, graph: AgentGraph, sessions: SessionStore): Route[] {
  const session = (id: string): SessionLike => {
    const found = sessions.get(id);
    if (!found) throw new HttpError(404, "No such conversation");
    return found;
  };

  return [
    route("GET", /^\/api\/agents$/, ({ res }) => json(res, 200, {
      default: config.defaultAgent,
      agents: [...graph.orchestrators.values()].map((spec) => ({ name: spec.name, description: spec.description, roster: spec.handoffs })),
    })),

    route("GET", /^\/api\/sessions$/, ({ res }) => json(res, 200, {
      sessions: sessions.list().map((s) => ({ id: s.id, agent: s.agent, title: s.title, startedAt: s.startedAt, state: s.state, closed: s.closed, ...(s.runId ? { runId: s.runId } : {}) })),
    })),

    route("POST", /^\/api\/sessions$/, async ({ req, res }) => {
      const body = await readBody(req);
      const agent = typeof body.agent === "string" ? body.agent : config.defaultAgent;
      if (!graph.orchestrators.has(agent)) throw new HttpError(400, `'${agent}' is not an orchestrator`);
      const opened = sessions.open(agent);
      json(res, 201, { id: opened.id, agent });
    }),

    route("GET", /^\/api\/sessions\/([\w-]+)$/, ({ res, params }) => {
      const s = session(params[0]!);
      json(res, 200, { id: s.id, agent: s.agent, closed: s.closed });
    }),

    route("DELETE", /^\/api\/sessions\/([\w-]+)$/, ({ res, params }) => {
      session(params[0]!);
      sessions.remove(params[0]!);
      json(res, 200, { ok: true });
    }),

    route("GET", /^\/api\/sessions\/([\w-]+)\/events$/, (ctx) => streamEvents(ctx, session(ctx.params[0]!))),

    route("POST", /^\/api\/sessions\/([\w-]+)\/messages$/, async ({ req, res, params }) => {
      const s = session(params[0]!);
      const { text } = await readBody(req);
      if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "text is required");
      // The run may take minutes; the page follows it over the event stream, so answer at once.
      void s.send(text).catch(() => undefined);
      json(res, 202, { ok: true });
    }),

    route("POST", /^\/api\/sessions\/([\w-]+)\/answer$/, async ({ req, res, params }) => {
      const s = session(params[0]!);
      const { id, answers } = await readBody(req);
      if (typeof id !== "string" || !Array.isArray(answers)) throw new HttpError(400, "id and answers are required");
      if (!s.answer(id, answers as WebAnswer[])) throw new HttpError(422, "That answer does not match the question, or it was already answered");
      json(res, 200, { ok: true });
    }),

    route("POST", /^\/api\/sessions\/([\w-]+)\/interrupt$/, async ({ res, params }) => {
      await session(params[0]!).interrupt();
      json(res, 200, { ok: true });
    }),

    route("GET", /^\/api\/sessions\/([\w-]+)\/artifacts\/(\d+)$/, ({ res, params }) => {
      const document = session(params[0]!).artifact(Number(params[1]));
      if (!document) throw new HttpError(404, "No such artifact");
      sandboxedPage(res, document, CSP.presented);
    }),
  ];
}

/** Server-Sent Events with replay: everything after `Last-Event-ID` (or `?after=`), then live, with a keep-alive. */
function streamEvents({ req, res, url }: RequestContext, session: SessionLike): void {
  const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write("retry: 2000\n\n");
  const write = (event: { seq: number }) => res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
  for (const event of session.events) if (event.seq > after) write(event);
  const unsubscribe = session.subscribe(write);
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
  req.on("close", () => { clearInterval(keepAlive); unsubscribe(); });
}
