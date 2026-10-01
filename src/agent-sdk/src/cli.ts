#!/usr/bin/env node
import { loadAgentGraph } from "./agents/catalog.js";
import { buildAgents } from "./agents/build.js";
import { renderShims, staleShims, validateStructure, writeShims } from "./catalog/shims.js";
import { assertDeclarativeAssets, discoverSkills, validateSkillCatalog } from "./catalog/skills.js";
import { loadRuntimeConfig, loadSdkConfig } from "./config/load.js";
import { runAgent } from "./orchestrator/run.js";
import { buildToolCatalog } from "../assets/tools/catalog.js";
import { assertScriptTargets } from "../assets/tools/script/registry.js";
import { TerminalPrompter } from "../assets/tools/hitl/terminal.js";
import { parseRunArguments, resolveRunRequest } from "./cli/request.js";
import { DEFAULT_PORT, startServer } from "./web/server.js";

/** Validate the whole declarative harness: graph, profiles, skills, tool families, and every composed prompt. */
export async function check(): Promise<void> {
  const [graph, skills, toolCatalog, config] = await Promise.all([loadAgentGraph(), discoverSkills(), buildToolCatalog(), loadRuntimeConfig()]);
  await Promise.all([validateSkillCatalog(skills), assertDeclarativeAssets(), validateStructure(graph, skills), loadSdkConfig()]);
  const defaultAgent = graph.agents.get(config.defaultAgent);
  if (!defaultAgent?.orchestrator) throw new Error(`runtime.yaml defaultAgent '${config.defaultAgent}' is not an orchestrator`);
  for (const spec of graph.agents.values()) {
    for (const grant of spec.tools) if (!toolCatalog.groups.has(grant.name)) throw new Error(`Agent '${spec.name}' grants unknown tool family '${grant.name}'`);
    for (const skill of spec.skills) if (!skills.has(skill)) throw new Error(`Agent '${spec.name}' grants missing skill '${skill}' (src/agent-sdk/assets/skills/${skill}/SKILL.md)`);
  }
  await assertScriptTargets(toolCatalog.scripts);
  await buildAgents(graph, toolCatalog, { fallback: config.model });
  const stale = await staleShims(await renderShims(graph, toolCatalog));
  if (stale.length) throw new Error(`Generated pointers are out of date: ${stale.join(", ")}. Run \`pnpm agents:shims\`.`);
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args.shift() ?? "help";

  if (command === "list") {
    const [graph, skills, toolCatalog] = await Promise.all([loadAgentGraph(), discoverSkills(), buildToolCatalog()]);
    console.log(JSON.stringify({
      orchestrators: [...graph.orchestrators.keys()],
      subagents: [...graph.agents.keys()].filter((name) => !graph.orchestrators.has(name)),
      skills: [...skills.keys()],
      toolFamilies: [...toolCatalog.groups.keys()],
    }, null, 2));
  } else if (command === "shims") {
    const [graph, toolCatalog] = await Promise.all([loadAgentGraph(), buildToolCatalog()]);
    const shims = await renderShims(graph, toolCatalog);
    const removed = await writeShims(shims);
    console.log(`wrote ${shims.size} pointers under .claude/ (skill commands, agent commands, native subagents)${removed.length ? `; removed stale: ${removed.join(", ")}` : ""}`);
  } else if (command === "web") {
    const portFlag = args.indexOf("--port");
    const port = portFlag > -1 ? Number(args[portFlag + 1]) : Number(process.env.AGENT_WEB_PORT ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be 0-65535");
    const running = await startServer({ port });
    console.log(`invest research desk: ${running.url}\n  Chat with the orchestrator in your browser. Ctrl-C to stop.\n  Loopback only; every API call needs this launch's token.`);
    if (args.includes("--open")) {
      const { spawn } = await import("node:child_process");
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      spawn(opener, process.platform === "win32" ? ["/c", "start", running.url] : [running.url], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
    }
    const stop = () => { void running.close().then(() => process.exit(0)); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    return;
  } else if (command === "check") {
    await check();
    console.log("agent harness: ok");
  } else if (command === "run" || command === "agents") {
    const parsed = parseRunArguments(args);
    const prompter = new TerminalPrompter();
    let request: string;
    try {
      request = await resolveRunRequest(parsed.requestParts, prompter);
    } finally {
      // Release stdin before runAgent creates the orchestrator's long-lived HITL
      // prompter; two readline owners would race for the same terminal input.
      prompter.dispose();
    }
    await runAgent(parsed.agent, request);
  } else {
    console.log([
      "Usage:",
      "  pnpm agents list",
      "  pnpm agents check",
      "  pnpm agents shims",
      "  pnpm agents web [--port N] [--open]",
      "  pnpm agents [--agent <name>] [request]",
      "",
      "When request is omitted in an interactive terminal, the launcher asks for it.",
    ].join("\n"));
  }
}

// Run only as the entry point, so tests can import `check`.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
