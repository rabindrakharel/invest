import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFrontmatter } from "../../../src/catalog/markdown.js";
import { GUIDE_SERVER, readGuide } from "../catalog.js";

export function createGuideServer(guides: Map<string, string>, loaded: Set<string>, skills: Map<string, string>, loadedSkills: Set<string>) {
  const areas = [...guides.keys()];
  const skillNames = [...skills.keys()];
  return createSdkMcpServer({ name: GUIDE_SERVER, version: "0.1.0", tools: [
    // A granted family always shows its name + frontmatter description in the
    // prompt; this is the inquiry step that adds the rest — guardrails, the
    // input/output contract, examples, success criteria — and opens the gate.
    tool("load_guide", "Load one tool family's full guide — guardrails, input/output contract, examples — before using its tools", {
      area: z.enum(areas as [string, ...string[]]).describe("Tool capability area"),
    }, async ({ area }) => {
      const path = guides.get(area);
      if (!path) throw new Error(`Unknown tool guide area: ${area}`);
      loaded.add(area);
      return { content: [{ type: "text" as const, text: await readGuide(path) }] };
    }),
    tool("load_skill", "Load one disclosed skill's complete workflow on demand — the metadata-only (Load on Demand) skills show only a summary; this fetches the full SKILL.md body", {
      name: z.enum((skillNames.length ? skillNames : ["none"]) as [string, ...string[]]).describe("Skill name from the agent's disclosed skill list"),
    }, async ({ name }) => {
      const path = skills.get(name);
      if (!path) throw new Error(`Unknown skill: ${name}`);
      const { body } = await readFrontmatter(path);
      loadedSkills.add(name);
      return { content: [{ type: "text" as const, text: body }] };
    }),
  ] });
}
