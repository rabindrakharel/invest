import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { PRESENT_SERVER } from "../catalog.js";
import { MAX_ARTIFACT_CHARS, type ArtifactSink } from "./document.js";

/**
 * `mcp__present__show_html`: the agent's way to put a designed, self-contained HTML5 page in front of the
 * operator. In the web chat it renders inline in the conversation; in any run it is also saved under the
 * run folder. The page is a fragment styled by the fixed design system (see the `present` guide).
 */
export function createPresentServer(sink: ArtifactSink, agent: string) {
  return createSdkMcpServer({ name: PRESENT_SERVER, version: "0.1.0", tools: [
    tool(
      "show_html",
      "Show the operator a designed HTML5 page inline in the chat: a report, a regime dashboard, a ranked table, a chart. Pass an HTML FRAGMENT (no html/head/body), using the design-system classes from the `present` guide; it renders sandboxed with no network and no external resources, so charts are inline SVG and every number is in the markup. Present the finished answer, not drafts, and keep the chat text to the verdict.",
      {
        title: z.string().min(1).max(120).describe("Short page title, shown on the card and used as the file name"),
        html: z.string().min(1).max(MAX_ARTIFACT_CHARS).describe("The HTML fragment to render"),
        caption: z.string().max(240).optional().describe("One line under the page: what it is and its as-of date"),
      },
      async ({ title, html, caption }) => {
        const published = await sink({ agent, title, html, caption });
        return { content: [{ type: "text" as const, text: `Presented "${title}" (#${published.n}); saved at ${published.path}. Do not repeat its contents in the chat: give the verdict in a sentence or two.` }] };
      },
    ),
  ] });
}
