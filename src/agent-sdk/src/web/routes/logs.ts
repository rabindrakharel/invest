import { json, route, type Route } from "../http.js";
import { listRuns, readRunLog } from "../logs.js";

/** The Logs tab's past runs (live sessions are listed and streamed by the chat routes). */
export function logRoutes(runsDir: string): Route[] {
  return [
    route("GET", /^\/api\/runs$/, async ({ res }) => json(res, 200, { runs: await listRuns(runsDir) })),
    route("GET", /^\/api\/runs\/([\w.-]+)\/events$/, async ({ res, params }) => json(res, 200, await readRunLog(runsDir, params[0]!))),
  ];
}
