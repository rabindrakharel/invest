import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fromSdkRoot } from "../../../src/config/paths.js";

export const MAX_ARTIFACT_CHARS = 400_000;

let cachedCss: string | undefined;
const css = () => cachedCss ??= readFileSync(fromSdkRoot("assets/tools/present/artifact.css"), "utf8");

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/**
 * The fragment, with the tags that could navigate or restyle the frame stripped. The document is also
 * sandboxed (no same-origin, no network, no forms) and locked by CSP, so this is the belt to that
 * braces: an agent that copied hostile markup from a fetched page cannot reach the operator's session.
 */
export function sanitizeFragment(html: string): string {
  return html
    .replace(/<!doctype[^>]*>|<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<(?:meta|base|link|iframe|object|embed|form)\b[^>]*>(?:[\s\S]*?<\/(?:iframe|object|form)>)?/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "");
}

/**
 * The self-contained HTML5 document an artifact is rendered as: the fixed design system, a strict CSP
 * (nothing loads from the network), links that open in a new tab, and a height report so the chat can
 * size the frame to the content.
 */
export function wrapArtifact(title: string, fragment: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)}</title>
<style>${css()}</style>
</head>
<body>
<main class="artifact">
${sanitizeFragment(fragment)}
</main>
<script>
(function () {
  document.querySelectorAll("a[href]").forEach(function (a) { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  function report() { parent.postMessage({ type: "invest-artifact-height", height: Math.ceil(document.documentElement.scrollHeight) }, "*"); }
  addEventListener("load", report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
  report();
})();
</script>
</body>
</html>
`;
}

export const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "artifact";

export interface Artifact { agent: string; title: string; html: string; caption?: string | undefined }
export interface PublishedArtifact { n: number; path: string; document: string }
/** Where a presented artifact goes. The default writes it to the run folder; the web chat also pushes it to the browser. */
export type ArtifactSink = (artifact: Artifact) => Promise<PublishedArtifact>;

/** The default sink: `<run>/artifacts/<n>-<slug>.html`, numbered per run. */
export function createFileArtifactSink(runRoot: string, relativeTo: string): ArtifactSink {
  let count = 0;
  return async (artifact) => {
    const n = ++count;
    const document = wrapArtifact(artifact.title, artifact.html);
    const dir = resolve(runRoot, "artifacts");
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${String(n).padStart(2, "0")}-${slug(artifact.title)}.html`);
    await writeFile(file, document);
    return { n, path: file.startsWith(relativeTo) ? file.slice(relativeTo.length + 1) : file, document };
  };
}

export const readArtifact = (path: string) => readFile(path, "utf8");
