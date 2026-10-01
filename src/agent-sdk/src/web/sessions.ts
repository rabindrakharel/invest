import type { SessionLike } from "./session.js";

/** Live conversations, oldest first. Bounded: creating one past the cap closes the oldest. Closed ones are pruned. */
export class SessionStore {
  private readonly sessions = new Map<string, SessionLike>();

  constructor(private readonly create: (agent: string) => SessionLike, private readonly max = 20) {}

  open(agent: string): SessionLike {
    for (const [id, session] of this.sessions) if (session.closed) this.sessions.delete(id);
    while (this.sessions.size >= this.max) {
      const oldest = this.sessions.keys().next().value as string;
      this.sessions.get(oldest)?.close();
      this.sessions.delete(oldest);
    }
    const session = this.create(agent);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): SessionLike | undefined { return this.sessions.get(id); }

  remove(id: string): void { this.sessions.get(id)?.close(); this.sessions.delete(id); }

  /** Newest first, as the session picker lists them. */
  list(): SessionLike[] { return [...this.sessions.values()].reverse(); }

  closeAll(): void { for (const session of this.sessions.values()) session.close(); }
}
