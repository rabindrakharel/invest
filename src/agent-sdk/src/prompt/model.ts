/**
 * The structured, native-template representation of one agent's dispatched
 * context. This is the single source of truth that materializes as `context.yaml`
 * on disk and serializes 1:1 to the XML prompt shipped to the model.
 *
 * Region names deliberately mirror Claude's native prompt-template jargon
 * (`<role>`, `<instructions>`, `<context>`, tagged data blocks) so the same
 * object renders as YAML for authoring/observability and as XML for inference.
 * There is no markdown assembly anymore: the old `context.md` is retired.
 */

/** One required deliverable file the agent must publish. */
export interface DeliverableFile {
  filename: string;
  key_sections: string;
  required: boolean;
}

/**
 * One skill or tool capability. `body` is present when the capability is
 * inlined always-on (the full workflow/guide); `summary` is present when it is
 * disclosed progressively (one-line stub the agent loads on demand).
 */
export interface CapabilityEntry {
  name: string;
  body?: string;
  summary?: string;
}

/** One prior agent's recorded ledger outcome, parsed from the run CONTEXT.md. */
export interface PriorOutcome {
  agent: string;
  verdict?: string;
  summary?: string;
  output?: string;
}

/**
 * The dynamic per-run data injected into the `<context>` region — the only part
 * of the template that changes across a run. Assembled from the shared run
 * ledger (`CONTEXT.md`), never authored by hand.
 */
export interface RunContext {
  originalRequest: string;
  artifactPlane?: string;
  priorOutcomes: PriorOutcome[];
}

/**
 * The full agent context. The static-contract fields (role…repositoryLookup)
 * come from the agent profile + catalogs; `context` is the dynamic run data.
 */
export interface AgentContext {
  agent: string;
  /** Persona / identity — the "You are…" opener. */
  role: string;
  /** The objective for this run. */
  task: string;
  /** Success criteria: the invariants the work must hold. */
  instructions: string[];
  /** What the agent is given to work from. */
  inputs: string[];
  deliverables: {
    /** The runtime publish/record contract (agent name, required outputs). */
    runtimeContract: string;
    /** How this agent's `## <agent>` ledger block must read. */
    ledgerEntry: string;
    files: DeliverableFile[];
  };
  /** Graph-bounded handoff targets (empty = none). */
  handoffs: string[];
  /** The condition under which the agent escalates to a human (HITL). */
  escalation: string;
  skills: { alwaysOn: CapabilityEntry[]; onDemand: CapabilityEntry[] };
  tools: { alwaysOn: CapabilityEntry[]; onDemand: CapabilityEntry[] };
  /** Plan-mode write-surface clause — present only for permissionMode `plan` agents. */
  planMode?: string;
  /** Canonical repository lookup discipline. */
  repositoryLookup: string;
  /** How to consume routed docs + prior-agent artifacts. */
  artifactConsumption: string;
  /** Bounded-read discipline for source and data files. */
  readDiscipline: string;
  /** Dynamic run data (omitted from the static contract until a run is bound). */
  context?: RunContext;
}
