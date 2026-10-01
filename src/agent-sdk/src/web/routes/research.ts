import { CSP, HttpError, json, route, sandboxedPage, type Route } from "../http.js";
import { readDocument, readOutlook, readVerdicts, researchIndex, tickerDossier } from "../research.js";

/** The Research tab: read-only views over what the skills wrote under data/ (see research.ts). */
export function researchRoutes(dataDir: string): Route[] {
  return [
    route("GET", /^\/api\/research$/, async ({ res }) => json(res, 200, await researchIndex(dataDir))),
    route("GET", /^\/api\/research\/outlook$/, async ({ res, url }) => {
      const found = await readOutlook(dataDir, url.searchParams.get("date") ?? undefined);
      if (!found) throw new HttpError(404, "No outlook on file yet");
      json(res, 200, found);
    }),
    route("GET", /^\/api\/research\/ledger$/, async ({ res }) => json(res, 200, { verdicts: await readVerdicts(dataDir) })),
    route("GET", /^\/api\/research\/tickers\/([A-Za-z0-9.]{1,10})$/, async ({ res, params }) => json(res, 200, await tickerDossier(params[0]!, dataDir))),
    route("GET", /^\/api\/research\/doc$/, async ({ res, url }) => json(res, 200, await readDocument(url.searchParams.get("path") ?? "", dataDir))),
    route("GET", /^\/api\/research\/page$/, async ({ res, url }) => {
      const document = await readDocument(url.searchParams.get("path") ?? "", dataDir);
      sandboxedPage(res, document.body, CSP.skillPage, document.kind === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
    }),
  ];
}
