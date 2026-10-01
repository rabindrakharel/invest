import assert from "node:assert/strict";
import { test } from "vitest";
import type { HitlAnswer, HitlContext, HitlQuestion, TerminalPrompter } from "../assets/tools/hitl/terminal.js";
import { parseRunArguments, resolveRunRequest } from "../src/cli/request.js";

function stubPrompter(answer: string, interactive = true) {
  const questions: HitlQuestion[] = [];
  const prompter = {
    interactive,
    ask: async (_context: HitlContext, entries: HitlQuestion[]): Promise<HitlAnswer[]> => {
      questions.push(...entries);
      return entries.map((entry) => ({ question: entry.question, answer, freeText: true }));
    },
  } as Pick<TerminalPrompter, "interactive" | "ask">;
  return { prompter, questions };
}

test("agents CLI parsing keeps request words and extracts one optional agent", () => {
  assert.deepEqual(parseRunArguments(["build", "the", "feature"]), {
    requestParts: ["build", "the", "feature"],
  });
  assert.deepEqual(parseRunArguments(["--agent", "play", "audit", "the", "page"]), {
    agent: "play",
    requestParts: ["audit", "the", "page"],
  });
  assert.throws(() => parseRunArguments(["--agent"]), /requires a declared agent name/);
  assert.throws(() => parseRunArguments(["--agent", "play", "--agent", "ddb-modeler"]), /only once/);
});

test("agents CLI uses supplied request without prompting", async () => {
  const { prompter, questions } = stubPrompter("unused");
  assert.equal(await resolveRunRequest(["Implement", "it"], prompter), "Implement it");
  assert.equal(questions.length, 0);
});

test("agents CLI asks for a missing interactive request", async () => {
  const { prompter, questions } = stubPrompter("Implement the tenant dashboard");
  assert.equal(await resolveRunRequest([], prompter), "Implement the tenant dashboard");
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.options.length, 0);
});

test("agents CLI fails fast without request or interactive terminal", async () => {
  const { prompter } = stubPrompter("unused", false);
  await assert.rejects(resolveRunRequest([], prompter), /stdin is not interactive/);
});
