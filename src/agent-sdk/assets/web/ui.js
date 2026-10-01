// Shared by the chat and the research view: the launch token, DOM building, the API client and a safe
// markdown renderer. Model and file text is only ever placed through DOM nodes, never innerHTML.

export const token = document.querySelector('meta[name="invest-token"]').content;
export const $ = (id) => document.getElementById(id);
export const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== undefined && child !== null && child !== false) node.append(child);
  return node;
};

export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-invest-token": token, ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error ?? response.statusText), { status: response.status });
  return body;
}

/** Resolves a relative link inside a data/ document (`../research/…/outlook.md`) to its data/-relative path. */
export function resolveDataPath(base, href) {
  const parts = base.split("/").slice(0, -1);
  for (const part of href.split("#")[0].split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

// ---------- markdown (safe: builds DOM, escapes everything) ----------
// `options.base` is the data/-relative path of the document, so its relative .md/.html links open in the research view.
export function inline(text, options = {}) {
  const out = document.createDocumentFragment();
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0; let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.append(text.slice(last, match.index));
    const [whole] = match;
    if (match[1]) out.append(el("code", { text: whole.slice(1, -1) }));
    else if (match[2]) out.append(el("strong", {}, inline(whole.slice(2, -2), options)));
    else if (match[3]) out.append(el("em", { text: whole.slice(1, -1) }));
    else {
      const [, label, href] = /\[([^\]]+)\]\((.+)\)/.exec(whole);
      if (/^https?:\/\//.test(href)) out.append(el("a", { href, target: "_blank", rel: "noopener noreferrer", text: label }));
      else if (options.base && /^[\w./-]+\.(md|html)(#.*)?$/.test(href)) out.append(el("a", { href: `#/research/doc/${resolveDataPath(options.base, href)}`, text: label }));
      else out.append(label);
    }
    last = match.index + whole.length;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}

export function markdown(source, options = {}) {
  const root = el("div", { class: "md" });
  const lines = source.replace(/\r/g, "").split("\n");
  const span = (text) => inline(text, options);
  let i = 0;
  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^```(\w*)/.exec(line);
    if (fence) { const code = []; i++; while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]); i++; root.append(el("pre", {}, el("code", { text: code.join("\n") }))); continue; }
    const heading = /^(#{1,4})\s+(.*)/.exec(line);
    if (heading) { root.append(el(`h${heading[1].length}`, {}, span(heading[2]))); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { root.append(el("hr")); i++; continue; }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      root.append(el("table", {}, el("thead", {}, el("tr", {}, head.map((cell) => el("th", {}, span(cell))))), el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell) => el("td", {}, span(cell))))))));
      continue;
    }
    if (/^\s*>/.test(line)) { const quote = []; while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, "")); root.append(el("blockquote", {}, span(quote.join(" ")))); continue; }
    const listed = /^(\s*)([-*]|\d+[.)])\s+/.exec(line);
    if (listed) {
      const ordered = /\d/.test(listed[2]); const items = [];
      while (i < lines.length && (/^(\s*)([-*]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^(\s*)([-*]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^(\s*)([-*]|\d+[.)])\s+/, ""));
        else items[items.length - 1] += ` ${lines[i++].trim()}`;
      }
      root.append(el(ordered ? "ol" : "ul", {}, items.map((item) => el("li", {}, span(item)))));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*]|\d+[.)])\s+)/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
    // Wrapped lines join; a "Label: …" line (the reports' "As of:" and "Regime:" headers) keeps its own line.
    root.append(el("p", {}, para.flatMap((text, n) => (!n ? [span(text)] : /^[A-Z][\w -]{1,24}:\s/.test(text) ? [el("br"), span(text)] : [" ", span(text)]))));
  }
  return root;
}
