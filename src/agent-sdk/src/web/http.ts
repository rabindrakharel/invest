import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * HTTP primitives for the local web server: one error type, JSON and sandboxed-page responses, a bounded body
 * reader, and a small route table. Route modules (routes/*.ts) depend on this file only, never on each other.
 */

export const MAX_BODY_BYTES = 256 * 1024;

/** Thrown anywhere in a handler; the server turns it into `{ error }` with this status. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
/** Errors thrown by the read modules (research, logs) carry a `status`; map them onto HttpError. */
export const statusOf = (error: unknown): number => (error instanceof HttpError ? error.status : typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500);

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Standalone pages other code wrote are served sandboxed, so their script cannot reach this origin. A page the model
 * presented gets no network at all; a probe page a skill rendered may also load its Google Fonts.
 */
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; img-src data:";
export const CSP = {
  presented: `${SANDBOX}; style-src 'unsafe-inline'`,
  skillPage: `${SANDBOX}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`,
} as const;

export function sandboxedPage(res: ServerResponse, body: string, csp: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(200, { "content-type": type, "content-security-policy": csp, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch { throw new HttpError(400, "Body is not a JSON object"); }
}

export type Method = "GET" | "POST" | "DELETE";

export interface RequestContext { req: IncomingMessage; res: ServerResponse; url: URL; params: string[] }

export interface Route { method: Method; path: RegExp; handle: (ctx: RequestContext) => Promise<void> | void }

/** `route("GET", /^\/api\/x\/([\w-]+)$/, ...)`: capture groups arrive as `params`. */
export const route = (method: Method, path: RegExp, handle: Route["handle"]): Route => ({ method, path, handle });

/**
 * Finds the route for a request. A path that some route matches under another method answers 405, so a client
 * learns the difference between "no such thing" and "not like that".
 */
export function dispatch(routes: readonly Route[], method: string, pathname: string): { route: Route; params: string[] } | { status: 404 | 405 } {
  let pathMatched = false;
  for (const candidate of routes) {
    const match = candidate.path.exec(pathname);
    if (!match) continue;
    pathMatched = true;
    if (candidate.method === method) return { route: candidate, params: match.slice(1).map((p) => (p === undefined ? "" : decodeURIComponent(p))) };
  }
  return { status: pathMatched ? 405 : 404 };
}
