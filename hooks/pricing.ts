// Claude API list prices, USD per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-17).
// Cache writes are priced at the 1-hour rate (2x input): Claude Code caches its
// prompts for an hour, and its own recorded session costs match this table to the
// cent only at that rate. Pure functions, no `$`.

export type Rates = {
  /** Display name, as people say it. */
  name: string
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export type TokenCounts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const rates = (name: string, input: number, output: number, cacheRead: number): Rates => ({
  name,
  input,
  output,
  cacheWrite: input * 2,
  cacheRead,
})

/** Keyed by `<family>-<major>[-<minor>]`, the way model ids spell it. */
export const PRICES: Record<string, Rates> = {
  'fable-5-2': rates('Fable 5.2', 8, 40, 0.2),
  'mythos-5-2': rates('Mythos 5.2', 8, 40, 0.2),
  'fable-5-1': rates('Fable 5.1', 10, 50, 0.25),
  'mythos-5-1': rates('Mythos 5.1', 10, 50, 0.25),
  'fable-5': rates('Fable 5', 10, 50, 1),
  'mythos-5': rates('Mythos 5', 10, 50, 1),
  'opus-5-5': rates('Opus 5.5', 4, 20, 0.2),
  'opus-5': rates('Opus 5', 5, 25, 0.5),
  'opus-4-8': rates('Opus 4.8', 5, 25, 0.5),
  'opus-4-7': rates('Opus 4.7', 5, 25, 0.5),
  'opus-4-6': rates('Opus 4.6', 5, 25, 0.5),
  'opus-4-5': rates('Opus 4.5', 5, 25, 0.5),
  'opus-4-1': rates('Opus 4.1', 15, 75, 1.5),
  'opus-4': rates('Opus 4', 15, 75, 1.5),
  'sonnet-5-5': rates('Sonnet 5.5', 2, 10, 0.1),
  'sonnet-5': rates('Sonnet 5', 2, 10, 0.2),
  'sonnet-4-6': rates('Sonnet 4.6', 3, 15, 0.3),
  'sonnet-4-5': rates('Sonnet 4.5', 3, 15, 0.3),
  'sonnet-4': rates('Sonnet 4', 3, 15, 0.3),
  // Haiku 5.5 doubles to $0.50/$2.50 on prompts over 100K tokens; a turn's summed
  // usage can't tell which requests crossed that line, so the base tier is used and
  // the session total (Claude Code's own ledger) corrects the split.
  'haiku-5-5': rates('Haiku 5.5', 0.1, 0.5, 0.01),
  'haiku-4-5': rates('Haiku 4.5', 1, 5, 0.1),
}

/**
 * The price-table key of a model as any part of Claude Code names it:
 * `claude-opus-5-5`, `claude-haiku-4-5-20251001`, `claude-opus-4-20250514`,
 * `Opus 5.5`, `opus[1m]`, `us.anthropic.claude-sonnet-4-6`.
 */
export function modelKey(model: string): string | undefined {
  const m = /(fable|mythos|opus|sonnet|haiku)[-\s_]?(\d)(?:[-.](\d{1,2})(?!\d))?/i.exec(model)
  if (!m) return undefined
  const family = m[1]!.toLowerCase()
  const key = m[3] ? `${family}-${m[2]}-${m[3]}` : `${family}-${m[2]}`
  return PRICES[key] ? key : undefined
}

export function ratesFor(model: string): Rates | undefined {
  const key = modelKey(model)
  return key ? PRICES[key] : undefined
}

/** A friendly name for any model string; the string itself when unknown. */
export function displayName(model: string): string {
  return ratesFor(model)?.name ?? model.replace(/^claude-/, '')
}

/** What these tokens cost at the model's list price; undefined for an unknown model. */
export function costOf(model: string, t: TokenCounts): number | undefined {
  const r = ratesFor(model)
  if (!r) return undefined
  return (
    (t.input * r.input + t.output * r.output + t.cacheRead * r.cacheRead + t.cacheWrite * r.cacheWrite) /
    1_000_000
  )
}
