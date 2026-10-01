import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// `paths` is declared, not spread in ad hoc: a conditional spread slips past
// excess-property checking, so the field the continuation packet reads back out
// of tools.jsonl would have been untyped at the one place it is written.
export interface AuditEvent { at?: string; event: string; agent?: string; runId?: string; toolUseId?: string; tool?: string; status?: string; paths?: string[]; data?: unknown }

export async function emitAudit(path: string, event: AuditEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify({ ...event, at: event.at ?? new Date().toISOString() }) + "\n");
}

/**
 * Create an agent's `context.yaml` if it does not exist, seeding it with the
 * given YAML content. Exclusive-create (`wx`): the authoritative context is
 * written later by the orchestrator/SubagentStart hook, so this only guarantees
 * the file exists as a valid-YAML stub for early workspace consumers.
 */
export async function seedAgentContext(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { flag: "wx" });
}

export async function appendAgentTrace(path: string, message: string): Promise<void> {
  await appendFile(path, `\n- ${new Date().toISOString()} ${message}\n`);
}
