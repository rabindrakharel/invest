import { readdir, readFile, stat } from "node:fs/promises";
import { basename, posix, relative, resolve, sep } from "node:path";
import { fromRepoRoot } from "../config/paths.js";

/**
 * The research desk's read side: what the skills have already written under data/, indexed for the
 * browser. Read-only by construction (nothing here writes), and every path a client names is checked
 * against an allowlist of areas and extensions before it touches the disk.
 */

export const defaultDataDir = (): string => process.env.INVEST_DATA_DIR ?? fromRepoRoot("data");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
/** The only documents a client may open, relative to data/. */
const DOC = /^(?:reports\/[\w.-]+|research\/\d{4}-\d{2}-\d{2}\/[\w-]+\/[\w.-]+|probes\/corpus\/[\w.-]+|probes\/runway\/[\w-]+\/[\w.-]+)\.(md|html)$/;

export interface ReportEntry { date: string; title: string; path: string; answer: string }
export interface ProbeEntry { kind: "corpus" | "runway"; id: string; date: string; page?: string; evidence?: string; scorecard: boolean; names?: number }
export interface DateEntry { date: string; parts: Record<string, string[]> }
export interface ResearchIndex { reports: ReportEntry[]; probes: ProbeEntry[]; dates: DateEntry[]; tickers: string[]; verdicts: number; latestOutlook?: string }

const exists = async (path: string) => stat(path).then(() => true, () => false);
const list = async (path: string) => readdir(path, { withFileTypes: true }).catch(() => []);
const readJson = async <T = unknown>(path: string): Promise<T | undefined> => {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return undefined; }
};
const toPosix = (path: string) => path.split(sep).join("/");

/** Parses reports/INDEX.md (`- <DATE> [<title>](<file>) — <answer>`), then adds any report file the index missed. */
export async function readReports(data: string): Promise<ReportEntry[]> {
  const reportsDir = resolve(data, "reports");
  const text = await readFile(resolve(reportsDir, "INDEX.md"), "utf8").catch(() => "");
  const seen = new Set<string>();
  const out: ReportEntry[] = [];
  for (const line of text.split("\n")) {
    const match = /^-\s+(\d{4}-\d{2}-\d{2})\s+\[([^\]]+)\]\(([^)\s]+)\)\s*(?:[—-]+\s*(.*))?$/.exec(line.trim());
    if (!match) continue;
    const path = posix.normalize(posix.join("reports", match[3]!));
    if (!DOC.test(path)) continue;
    seen.add(path);
    out.push({ date: match[1]!, title: match[2]!, path, answer: match[4]?.trim() ?? "" });
  }
  for (const entry of await list(reportsDir)) {
    const path = `reports/${entry.name}`;
    if (!entry.isFile() || entry.name === "INDEX.md" || seen.has(path) || !DOC.test(path)) continue;
    const date = /^(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1] ?? "";
    const head = (await readFile(resolve(reportsDir, entry.name), "utf8")).split("\n", 1)[0] ?? "";
    out.push({ date, title: head.replace(/^#\s*/, "").replace(/,\s*\d{4}-\d{2}-\d{2}$/, "") || entry.name, path, answer: "" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

async function readProbes(data: string): Promise<ProbeEntry[]> {
  const out: ProbeEntry[] = [];
  for (const entry of await list(resolve(data, "probes/corpus"))) {
    const match = /^(\d{4}-\d{2}-\d{2})-probe\.html$/.exec(entry.name);
    if (entry.isFile() && match) out.push({ kind: "corpus", id: match[1]!, date: match[1]!, page: `probes/corpus/${entry.name}`, scorecard: false });
  }
  for (const entry of await list(resolve(data, "probes/runway"))) {
    if (!entry.isDirectory()) continue;
    const root = resolve(data, "probes/runway", entry.name);
    const rel = `probes/runway/${entry.name}`;
    const page = (await exists(resolve(root, "probe.html"))) ? `${rel}/probe.html` : (await exists(resolve(root, "probe.md"))) ? `${rel}/probe.md` : undefined;
    const evidence = (await exists(resolve(root, "evidence.md"))) ? `${rel}/evidence.md` : undefined;
    const names = (await list(resolve(root, "records"))).filter((file) => TICKER.test(basename(file.name, ".json")) && file.name.endsWith(".json")).length;
    out.push({ kind: "runway", id: entry.name, date: entry.name.slice(0, 10), ...(page ? { page } : {}), ...(evidence ? { evidence } : {}), scorecard: await exists(resolve(root, "records/scorecard.json")), names });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
}

async function readDates(data: string): Promise<DateEntry[]> {
  const out: DateEntry[] = [];
  for (const day of await list(resolve(data, "research"))) {
    if (!day.isDirectory() || !DATE.test(day.name)) continue;
    const parts: Record<string, string[]> = {};
    for (const part of await list(resolve(data, "research", day.name))) {
      if (!part.isDirectory()) continue;
      parts[part.name] = (await list(resolve(data, "research", day.name, part.name))).filter((file) => file.isFile()).map((file) => file.name).sort();
    }
    out.push({ date: day.name, parts });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function readVerdicts(data: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(resolve(data, "ledger/verdicts.jsonl"), "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.trim()).flatMap((line) => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } });
}

export async function researchIndex(data = defaultDataDir()): Promise<ResearchIndex> {
  const [reports, probes, dates, verdicts] = await Promise.all([readReports(data), readProbes(data), readDates(data), readVerdicts(data)]);
  const tickers = new Set<string>();
  for (const day of dates) for (const file of day.parts.tickers ?? []) if (file.endsWith(".json")) tickers.add(basename(file, ".json"));
  for (const probe of probes) {
    if (probe.kind !== "runway") continue;
    for (const file of await list(resolve(data, "probes/runway", probe.id, "records"))) {
      const name = basename(file.name, ".json");
      if (file.name.endsWith(".json") && TICKER.test(name)) tickers.add(name);
    }
  }
  for (const verdict of verdicts) if (typeof verdict.ticker === "string" && TICKER.test(verdict.ticker)) tickers.add(verdict.ticker);
  const latestOutlook = dates.find((day) => day.parts.outlook?.includes("outlook.json"))?.date;
  return { reports, probes, dates, tickers: [...tickers].sort(), verdicts: verdicts.length, ...(latestOutlook ? { latestOutlook } : {}) };
}

/** The newest outlook.json (or the one for `date`), with the regime file's date alongside so the page can show staleness. */
export async function readOutlook(data = defaultDataDir(), date?: string): Promise<{ date: string; outlook: unknown } | undefined> {
  const days = date ? [date] : (await readDates(data)).filter((day) => day.parts.outlook?.includes("outlook.json")).map((day) => day.date);
  const day = days[0];
  if (!day || !DATE.test(day)) return undefined;
  const outlook = await readJson(resolve(data, "research", day, "outlook/outlook.json"));
  return outlook ? { date: day, outlook } : undefined;
}

interface ScoreRow { ticker?: string; [key: string]: unknown }

/** Everything on file about one name: ticker briefs by date, runway records and scorecard rows by probe, ledger verdicts, and reports that mention it. */
export async function tickerDossier(ticker: string, data = defaultDataDir()) {
  const symbol = ticker.toUpperCase();
  if (!TICKER.test(symbol)) throw Object.assign(new Error("Not a ticker"), { status: 400 });
  const dates = await readDates(data);
  const briefs: { date: string; brief: unknown }[] = [];
  for (const day of dates) {
    if (!day.parts.tickers?.includes(`${symbol}.json`)) continue;
    const brief = await readJson(resolve(data, "research", day.date, "tickers", `${symbol}.json`));
    if (brief) briefs.push({ date: day.date, brief });
  }
  const runway: { probe: string; record?: unknown; score?: ScoreRow; page?: string }[] = [];
  for (const probe of (await readProbes(data)).filter((p) => p.kind === "runway")) {
    const root = resolve(data, "probes/runway", probe.id, "records");
    const record = await readJson(resolve(root, `${symbol}.json`));
    const card = probe.scorecard ? await readJson<{ rows?: ScoreRow[] }>(resolve(root, "scorecard.json")) : undefined;
    const score = card?.rows?.find((row) => row.ticker === symbol);
    if (record || score) runway.push({ probe: probe.id, ...(record ? { record } : {}), ...(score ? { score } : {}), ...(probe.page ? { page: probe.page } : {}) });
  }
  const verdicts = (await readVerdicts(data)).filter((verdict) => verdict.ticker === symbol);
  const mention = new RegExp(`(^|[^A-Za-z0-9$])\\$?${symbol.replace(".", "\\.")}([^A-Za-z0-9]|$)`);
  const reports: ReportEntry[] = [];
  for (const report of await readReports(data)) {
    if (mention.test(report.title) || mention.test(report.answer)) { reports.push(report); continue; }
    const body = await readFile(resolve(data, report.path), "utf8").catch(() => "");
    if (mention.test(body)) reports.push(report);
  }
  return { ticker: symbol, briefs, runway, verdicts, reports };
}

/** Reads one allowlisted document. The relative path is checked by pattern and again after resolution. */
export async function readDocument(path: string, data = defaultDataDir()): Promise<{ path: string; kind: "md" | "html"; body: string }> {
  const clean = posix.normalize(path.replace(/^\/+/, ""));
  const match = DOC.exec(clean);
  if (!match || clean.split("/").includes("..")) throw Object.assign(new Error("That document is not readable here"), { status: 400 });
  const full = resolve(data, clean);
  const back = toPosix(relative(resolve(data), full));
  if (back !== clean) throw Object.assign(new Error("That document is not readable here"), { status: 400 });
  const body = await readFile(full, "utf8").catch(() => { throw Object.assign(new Error("No such document"), { status: 404 }); });
  return { path: clean, kind: match[1] as "md" | "html", body };
}
