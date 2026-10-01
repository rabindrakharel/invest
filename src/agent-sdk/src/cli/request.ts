import type { TerminalPrompter } from "../../assets/tools/hitl/terminal.js";

export interface ParsedRunArguments {
  agent?: string;
  requestParts: string[];
}

export function parseRunArguments(args: string[]): ParsedRunArguments {
  const requestParts: string[] = [];
  let agent: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value !== "--agent") {
      requestParts.push(value);
      continue;
    }
    const candidate = args[index + 1]?.trim();
    if (!candidate || candidate.startsWith("--")) {
      throw new Error("--agent requires a declared agent name");
    }
    if (agent) throw new Error("--agent may be provided only once");
    agent = candidate;
    index += 1;
  }
  return agent ? { agent, requestParts } : { requestParts };
}

export async function resolveRunRequest(
  requestParts: string[],
  prompter: Pick<TerminalPrompter, "interactive" | "ask">,
): Promise<string> {
  const supplied = requestParts.join(" ").trim();
  if (supplied) return supplied;
  if (!prompter.interactive) {
    throw new Error(
      "No request was supplied and stdin is not interactive. " +
        "Pass the request after `agents`.",
    );
  }
  const [answer] = await prompter.ask({ source: "agents launcher" }, [
    {
      header: "Request",
      question: "What should the agents do?",
      options: [],
    },
  ]);
  const request = answer?.answer.trim() ?? "";
  if (!request) throw new Error("The request cannot be empty");
  return request;
}
