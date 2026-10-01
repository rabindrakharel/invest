import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The SDK package root (src/agent-sdk) is the nearest ancestor holding assets/config/runtime.yaml;
// the repository root is two levels above it (src/agent-sdk -> src -> repo).
let cursor = dirname(fileURLToPath(import.meta.url));
while (!existsSync(resolve(cursor, "assets/config/runtime.yaml"))) {
  const parent = dirname(cursor);
  if (parent === cursor) throw new Error("Unable to locate the agent-sdk root (no assets/config/runtime.yaml above this file)");
  cursor = parent;
}
export const sdkRoot = cursor;
export const repoRoot = resolve(sdkRoot, "../..");
export const fromSdkRoot = (...parts: string[]) => resolve(sdkRoot, ...parts);
export const fromRepoRoot = (...parts: string[]) => resolve(repoRoot, ...parts);
