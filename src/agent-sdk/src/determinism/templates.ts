/**
 * Path templates of a determinism contract (see DeterminismSpec): repository-relative paths with `<PARAM>`
 * placeholders, optionally `<PARAM:upper>` or `<PARAM:lower>`. `<DATE>` falls back to today, as every dated script
 * does. Pure functions: no I/O, so they are cheap to test and safe to call from any hook.
 */

const PLACEHOLDER = /<([A-Z][A-Z0-9_]*)(?::(upper|lower))?>/g;

export type Bindings = Record<string, unknown>;

/** Today as the scripts compute it (Python's date.today(): the local calendar day). */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const transform = (value: string, filter?: string) => (filter === "upper" ? value.toUpperCase() : filter === "lower" ? value.toLowerCase() : value);

/**
 * Every path a template names for these parameters. A list parameter fans the template out, one path per element.
 * A template that names a parameter the call did not supply (other than DATE) names nothing: it describes an
 * optional output, such as compute_regime's probe file, that this call did not write.
 */
export function expandTemplate(template: string, input: Bindings, today = localToday()): string[] {
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]!);
  const value = (name: string): unknown => {
    const supplied = input[name.toLowerCase()];
    return supplied === undefined && name === "DATE" ? today : supplied;
  };
  if (names.some((name) => value(name) === undefined || value(name) === null)) return [];
  const listName = names.find((name) => Array.isArray(value(name)));
  const variants = listName ? (value(listName) as unknown[]).map((item) => ({ [listName]: item })) : [{}];
  return variants.map((variant: Record<string, unknown>) =>
    template.replace(PLACEHOLDER, (_whole, name: string, filter?: string) => transform(String(variant[name] ?? value(name)), filter)));
}

/**
 * A matcher from a concrete repository-relative path back to the parameters that would name it, or undefined. A
 * placeholder matches one path segment (no `/`); a case filter is matched case-insensitively and the value is
 * returned as written in the path.
 */
export function templateMatcher(template: string): (path: string) => Bindings | undefined {
  const names: string[] = [];
  let pattern = "";
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    pattern += template.slice(last, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    names.push(match[1]!);
    pattern += match[1] === "DATE" ? "(\\d{4}-\\d{2}-\\d{2})" : "([^/]+?)";
    last = match.index! + match[0].length;
  }
  pattern += template.slice(last).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${pattern}$`);
  return (path) => {
    const found = regex.exec(path);
    if (!found) return undefined;
    return Object.fromEntries(names.map((name, i) => [name.toLowerCase(), found[i + 1]]));
  };
}
