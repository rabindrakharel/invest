import { readFile } from "node:fs/promises";

export interface FrontmatterDocument { attributes: Record<string, string>; body: string }

export async function readFrontmatter(path: string): Promise<FrontmatterDocument> {
  const source = await readFile(path, "utf8");
  if (!source.startsWith("---\n")) return { attributes: {}, body: source };
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`Unclosed frontmatter in ${path}`);
  const attributes: Record<string, string> = {};
  for (const line of source.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0 && !line.startsWith(" ")) {
      attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return { attributes, body: source.slice(end + 5).trim() };
}
