const forced = Boolean(process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0");

export const colorsEnabled = (stream: NodeJS.WriteStream = process.stdout): boolean =>
  !process.env.NO_COLOR && (forced || Boolean(stream.isTTY));

export const style = (codes: string, text: string, enabled: boolean): string =>
  enabled ? `[${codes}m${text}[0m` : text;

// eslint-disable-next-line no-control-regex -- stripping ANSI escape sequences is the point
const ANSI_PATTERN = /\[[0-9;]*m/g;

export const visibleWidth = (text: string): number => text.replace(ANSI_PATTERN, "").length;

/** Word-wraps to a visible width, preserving ANSI sequences on their line. */
export function wrapVisible(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (visibleWidth(paragraph) <= width) {
      lines.push(paragraph);
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (visibleWidth(candidate) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = visibleWidth(word) > width ? word.slice(0, width) : word;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

export interface BoxOptions { title?: string; width: number; borderCodes: string; enabled: boolean }

/** Renders content lines inside a rounded box; content may contain ANSI codes. */
export function box(content: string[], { title, width, borderCodes, enabled }: BoxOptions): string {
  const edge = (text: string) => style(borderCodes, text, enabled);
  const inner = width - 4;
  const top = title
    ? edge("╭─ ") + title + edge(" " + "─".repeat(Math.max(1, width - visibleWidth(title) - 5)) + "╮")
    : edge(`╭${"─".repeat(width - 2)}╮`);
  const body = content
    .flatMap((line) => wrapVisible(line, inner))
    .map((line) => edge("│ ") + line + " ".repeat(Math.max(0, inner - visibleWidth(line))) + edge(" │"));
  const bottom = edge(`╰${"─".repeat(width - 2)}╯`);
  return [top, ...body, bottom].join("\n") + "\n";
}
