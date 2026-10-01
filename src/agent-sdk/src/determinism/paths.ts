import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Contract templates name files as the repository does (`data/research/...`), but the scripts honour
 * INVEST_DATA_DIR, which can move the whole data tree. This maps between the two, so a contract hashes and matches
 * the files the scripts actually wrote.
 */
export interface PathMap {
  /** A template-form path (`data/...` or any other repository-relative path) to its absolute location. */
  toDisk(path: string): string;
  /** An absolute or cwd-relative path to template form, or undefined when it is outside both trees. */
  toTemplate(path: string, cwd?: string): string | undefined;
}

export function pathMap(root: string, dataDir = process.env.INVEST_DATA_DIR): PathMap {
  const data = dataDir ? resolve(dataDir) : resolve(root, "data");
  // The path below `base`, in forward slashes, or undefined when it is `base` itself or outside it.
  const inside = (base: string, path: string): string | undefined => {
    const rel = relative(base, path);
    return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel.split(sep).join("/") : undefined;
  };
  return {
    toDisk: (path) => (path === "data" || path.startsWith("data/") ? resolve(data, path.slice(5)) : resolve(root, path)),
    toTemplate: (path, cwd = root) => {
      const full = resolve(cwd, path);
      const underData = inside(data, full);
      if (underData !== undefined) return `data/${underData}`;
      return inside(root, full);
    },
  };
}
