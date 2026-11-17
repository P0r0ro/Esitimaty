export type Totals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

export type Phase = 'research' | 'plan' | 'build' | 'test' | 'ship'

/** The session being measured, as it stands in this process. */
export type Run = {
  /** Time the session has been open, across every run of it (resumes included). */
  activeMs: number
  /** When the clock last added to `activeMs`, in this process. */
  lastTickAt: number
  /** Time Claude spent working on finished turns, across every run. */
  workMs: number
  /** A turn is running now, since `turnStartedAt`. */
  isWorking: boolean
  turnStartedAt: number
  /** The phase under way, since `phaseSince`. */
  current: Phase | null
  phaseSince: number
  /** Time per phase; null for a phase that never happened. */
  phases: Record<Phase, number | null>
  /** The session's cost, added up from every increase of Claude Code's ledger. */
  costUsd: number
  /** The ledger reading last added to `costUsd`; a lower reading means the ledger started over. */
  ledgerPrev: number
  /**
   * `costUsd` when token counting began (the plugin first saw the session, or the
   * last reset): the price check compares the tokens counted with the cost since then.
   */
  tokensFromUsd: number
  /** When the plugin first saw this session. */
  firstSeen: number
}

/** Tokens per model id, as the API reported the model that answered. */
export type ByModel = Record<string, Totals>

export type Limit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** The context window and plan usage limits, as Claude Code last measured them. */
export type Gauges = {
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  limits: Limit[]
}

/** A response still streaming: what it has generated so far, estimated. */
export type Live = {
  outputTokens: number
  usd: number
}

/** One session's numbers as saved in the plugin's store, under `session:<id>`. */
export type SessionRecord = {
  v: 1
  id: string
  /** The project folder the session ran in. */
  root: string
  firstSeen: number
  updatedAt: number
  activeMs: number
  workMs: number
  costUsd: number
  lastLedger: number
  tokensFromUsd: number
  phases: Record<Phase, number | null>
  totals: Totals
  byModel: ByModel
}

/** The project's other saved sessions, added up. */
export type ProjectTotals = {
  sessions: number
  activeMs: number
  workMs: number
  costUsd: number
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    esitimaty: {
      totals: Shaped<Totals>
      byModel: Shaped<ByModel>
      run: Shaped<Run>
      gauges: Shaped<Gauges>
      live: Shaped<Live>
      project: Shaped<ProjectTotals>
      model: string
      now: number
    }
  }
}
