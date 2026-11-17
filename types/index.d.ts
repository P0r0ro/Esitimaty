export type Totals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

export type Phase = 'research' | 'plan' | 'build' | 'test' | 'ship'

/** One estimate's running record; `/progress reset` starts a new one. */
export type Run = {
  /** When this estimate began (session start, or the last reset). */
  startedAt: number
  /** The session's ledger cost at the last reset, subtracted from what is shown. */
  baseCostUsd: number
  /** Time Claude spent working on finished turns. */
  workMs: number
  /** A turn is running now, since `turnStartedAt`. */
  isWorking: boolean
  turnStartedAt: number
  /** The phase under way, since `phaseSince`. */
  current: Phase | null
  phaseSince: number
  /** Time per phase; null for a phase that never happened. */
  phases: Record<Phase, number | null>
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

declare module 'claude-code' {
  interface PluginState {
    esitimaty: {
      totals: Shaped<Totals>
      byModel: Shaped<ByModel>
      run: Shaped<Run>
      gauges: Shaped<Gauges>
      model: string
      costUsd: number
      now: number
    }
  }
}
