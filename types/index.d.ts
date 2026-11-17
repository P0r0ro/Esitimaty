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

declare module 'claude-code' {
  interface PluginState {
    esitimaty: {
      totals: Shaped<Totals>
      run: Shaped<Run>
      costUsd: number
      now: number
    }
  }
}
