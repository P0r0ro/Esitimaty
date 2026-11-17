import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { ByModel, Gauges, Live, Phase, ProjectTotals, Run, SessionRecord, Totals } from '../types'

import { phaseOf } from './classify'
import { costOf, displayName, ratesFor } from './pricing'

const PANE = 'esitimaty'
const ORDER: Phase[] = ['research', 'plan', 'build', 'test', 'ship']
const LABEL: Record<Phase, string> = {
  research: 'Research',
  plan: 'Plan',
  build: 'Build',
  test: 'Test',
  ship: 'Ship',
}
const ZERO: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
const NO_PHASES: Record<Phase, number | null> = { research: null, plan: null, build: null, test: null, ship: null }
const NO_GAUGES: Gauges = { contextTokens: null, contextWindow: 0, contextPercent: null, limits: [] }
const NO_LIVE: Live = { outputTokens: 0, usd: 0 }
const NO_PROJECT: ProjectTotals = { sessions: 0, activeMs: 0, workMs: 0, costUsd: 0, tokens: 0 }
const freshRun = (at: number, ledger: number): Run => ({
  activeMs: 0,
  lastTickAt: at,
  workMs: 0,
  isWorking: false,
  turnStartedAt: at,
  current: null,
  phaseSince: at,
  phases: { ...NO_PHASES },
  costUsd: 0,
  ledgerPrev: ledger,
  tokensFromUsd: 0,
  firstSeen: at,
})

const totals = atom({ plugin: 'esitimaty', key: 'totals' } as const, ZERO, { shape: 'totals-1' })
const byModel = atom({ plugin: 'esitimaty', key: 'byModel' } as const, {} as ByModel, { shape: 'by-model-1' })
const run = atom({ plugin: 'esitimaty', key: 'run' } as const, freshRun(0, 0), { shape: 'run-3' })
const gauges = atom({ plugin: 'esitimaty', key: 'gauges' } as const, NO_GAUGES, { shape: 'gauges-1' })
const live = atom({ plugin: 'esitimaty', key: 'live' } as const, NO_LIVE, { shape: 'live-1' })
const project = atom({ plugin: 'esitimaty', key: 'project' } as const, NO_PROJECT, { shape: 'project-1' })
const model = atom({ plugin: 'esitimaty', key: 'model' } as const, '')
const now = atom({ plugin: 'esitimaty', key: 'now' } as const, 0)

const RECORD = 'session:'
// The longest stretch one clock tick may add to the session's open time: a
// laptop asleep with the session open does not count as hours spent.
const MAX_TICK_MS = 10_000

// The session this process is measuring, and its project folder.
const current = { id: '', root: '' }

// Responses streaming right now, by step: the model answering and how many
// characters of text, thinking and tool input it has sent so far. Read once a
// second by the clock, so a streaming chunk costs no engine call.
const streaming = new Map<string, { model: string; chars: number }>()
const CHARS_PER_TOKEN = 4

function liveEstimate(): Live {
  let outputTokens = 0
  let usd = 0
  for (const s of streaming.values()) {
    const tokens = Math.round(s.chars / CHARS_PER_TOKEN)
    outputTokens += tokens
    usd += (tokens * (ratesFor(s.model)?.output ?? 0)) / 1_000_000
  }
  return { outputTokens, usd }
}

// ---------------------------------------------------------------- state helpers

// Close the phase under way at `at`, adding its time.
function closePhase(r: Run, at: number): Run {
  if (!r.current) return r
  const spent = Math.max(0, at - r.phaseSince)
  return {
    ...r,
    phases: { ...r.phases, [r.current]: (r.phases[r.current] ?? 0) + spent },
    current: null,
    phaseSince: at,
  }
}

function phasesAt(r: Run, at: number): Record<Phase, number | null> {
  const out = { ...r.phases }
  if (r.current) out[r.current] = (out[r.current] ?? 0) + Math.max(0, at - r.phaseSince)
  return out
}

function toGauges(context: SessionContextUsage, rateLimits: readonly SessionRateLimit[]): Gauges {
  return {
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    contextPercent: context.percent ?? null,
    limits: rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
}

// Add what Claude Code's ledger grew by since the last reading. A reading below
// the last one means the ledger started over (a new process, a /clear): all of
// it is new.
function addLedger(r: Run, ledger: number): Run {
  if (Math.abs(ledger - r.ledgerPrev) < 1e-9) return r
  const grew = ledger >= r.ledgerPrev ? ledger - r.ledgerPrev : ledger
  return { ...r, costUsd: r.costUsd + grew, ledgerPrev: ledger }
}

// Re-read the ledger, the context window and the plan limits as Claude Code has them now.
async function refreshUsage($: EngineInterface) {
  const usage = await $.session.usage()
  const ledger = usage.cost?.usd
  if (ledger !== undefined) await update($, run, r => addLedger(r, ledger))
  await update($, gauges, () => toGauges(usage.context, usage.rateLimits))
}

// ---------------------------------------------------------------- saving

const isRecord = (v: unknown): v is SessionRecord =>
  typeof v === 'object' && v !== null && (v as SessionRecord).v === 1 && typeof (v as SessionRecord).id === 'string'

async function snapshot($: EngineInterface): Promise<SessionRecord> {
  const r = await read($, run)
  const at = await $.clock.now()
  return {
    v: 1,
    id: current.id,
    root: current.root,
    firstSeen: r.firstSeen,
    updatedAt: at,
    activeMs: r.activeMs,
    workMs: r.workMs + (r.isWorking ? Math.max(0, at - r.turnStartedAt) : 0),
    costUsd: r.costUsd,
    lastLedger: r.ledgerPrev,
    tokensFromUsd: r.tokensFromUsd,
    phases: phasesAt(r, at),
    totals: await read($, totals),
    byModel: await read($, byModel),
  }
}

async function save($: EngineInterface) {
  if (!current.id) return
  await $.store.set(RECORD + current.id, await snapshot($))
}

// Start measuring session `id`: pick up its saved record, or begin a new one.
// `isNewProcess`: Claude Code has just started, so its ledger either carries on
// from the saved reading (a restored session) or starts from nothing.
async function load($: EngineInterface, id: string, isNewProcess: boolean) {
  const saved = await $.store.get(RECORD + id)
  const rec = isRecord(saved) ? saved : undefined
  const usage = await $.session.usage()
  const ledger = usage.cost?.usd ?? 0
  const at = await $.clock.now()
  current.id = id
  current.root = await $.session.root()

  // Where to count the ledger from, so nothing is counted twice or missed.
  const ledgerPrev = !isNewProcess
    ? ledger // switched sessions in this process: only what comes next is this session's
    : rec && ledger + 1e-9 >= rec.lastLedger
      ? rec.lastLedger // the ledger carried on from where it was saved
      : 0 // a fresh ledger: everything in it is this session's

  await update($, run, () => ({
    ...freshRun(at, ledgerPrev),
    activeMs: rec?.activeMs ?? 0,
    workMs: rec?.workMs ?? 0,
    phases: rec?.phases ?? { ...NO_PHASES },
    costUsd: rec?.costUsd ?? 0,
    // A session first seen mid-way: its earlier tokens were never counted.
    tokensFromUsd: rec?.tokensFromUsd ?? (isNewProcess ? ledger : 0),
    firstSeen: rec?.firstSeen ?? at,
  }))
  await update($, totals, () => rec?.totals ?? ZERO)
  await update($, byModel, () => rec?.byModel ?? {})
  await update($, live, () => NO_LIVE)
  await update($, gauges, () => toGauges(usage.context, usage.rateLimits))
  await update($, run, r => addLedger(r, ledger))
  await save($)
  await refreshProject($)
}

async function savedSessions($: EngineInterface): Promise<SessionRecord[]> {
  const out: SessionRecord[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(RECORD)) continue
    const v = await $.store.get(key)
    if (isRecord(v)) out.push(v)
  }
  return out
}

// Add up this project's other saved sessions.
async function refreshProject($: EngineInterface) {
  const others = (await savedSessions($)).filter(s => s.root === current.root && s.id !== current.id)
  const sum: ProjectTotals = { ...NO_PROJECT }
  for (const s of others) {
    sum.sessions += 1
    sum.activeMs += s.activeMs
    sum.workMs += s.workMs
    sum.costUsd += s.costUsd
    sum.tokens += sumTokens(s.totals)
  }
  await update($, project, () => sum)
}

// ---------------------------------------------------------------- formatting

const sumTokens = (t: Totals) => t.input + t.output + t.cacheRead + t.cacheWrite

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return `${n}`
}

const fmtUsd = (usd: number) => `$${Math.max(0, usd).toFixed(2)}`
const fmtRate = (usd: number) => `$${usd < 1 ? usd.toFixed(2) : String(+usd.toFixed(2))}`
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Session (5h)',
  seven_day: 'Weekly (7d)',
  seven_day_opus: 'Weekly Opus',
  seven_day_sonnet: 'Weekly Sonnet',
  spend_limit: 'Spend limit',
}
const limitLabel = (kind: string) => LIMIT_LABEL[kind] ?? kind.replace(/_/g, ' ')
const limitShort: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

type View = {
  activeMs: number
  workingMs: number
  usd: number
  tokens: Totals
  /** Output still streaming, estimated: already inside `usd` and `tokens.output`. */
  live: Live
  /** The tokens counted, priced at list prices, and the cost over the same span. */
  check: { listUsd: number; ledgerUsd: number }
  models: { id: string; name: string; tokens: number; usd: number; isPriced: boolean }[]
  model: string
  phaseMs: Record<Phase, number | null>
  current: Phase | null
  isWorking: boolean
  gauges: Gauges
  project: ProjectTotals
  nowMs: number
}

async function view($: EngineInterface, at?: number): Promise<View> {
  const r = await read($, run)
  const t = await read($, totals)
  const per = await read($, byModel)
  const lv = await read($, live)
  const nowMs = at ?? (await read($, now))

  // Each model's tokens at its own list price; Claude Code's prices, to the cent.
  const models = Object.entries(per)
    .map(([id, tok]) => {
      const list = costOf(id, tok)
      return { id, name: displayName(id), tokens: sumTokens(tok), usd: list ?? 0, isPriced: list !== undefined }
    })
    .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens)
  const listTotal = models.reduce((s, m) => s + m.usd, 0)

  return {
    activeMs: r.activeMs,
    workingMs: r.workMs + (r.isWorking ? Math.max(0, nowMs - r.turnStartedAt) : 0),
    usd: r.costUsd + lv.usd,
    tokens: { ...t, output: t.output + lv.outputTokens },
    live: lv,
    check: { listUsd: listTotal, ledgerUsd: r.costUsd - r.tokensFromUsd },
    models,
    model: await read($, model),
    phaseMs: phasesAt(r, nowMs),
    current: r.current,
    isWorking: r.isWorking,
    gauges: await read($, gauges),
    project: await read($, project),
    nowMs,
  }
}

function resetsIn(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  return at <= nowMs ? 'resetting' : `resets ${fmtDuration(at - nowMs)}`
}

async function refreshStatus($: EngineInterface) {
  const v = await view($)
  const parts = [
    v.model ? displayName(v.model) : '',
    `⏱ ${fmtDuration(v.activeMs)} (${fmtDuration(v.workingMs)} working)`,
    `~${fmtUsd(v.usd)}`,
    `${fmtTokens(sumTokens(v.tokens))} tok`,
    v.gauges.contextPercent !== null ? `ctx ${Math.round(v.gauges.contextPercent)}%` : '',
    ...v.gauges.limits.map(l => `${limitShort[l.kind] ?? limitLabel(l.kind)} ${Math.round(l.percentUsed)}%`),
    v.project.sessions > 0 ? `project ~${fmtUsd(v.project.costUsd + v.usd)}` : '',
  ]
  $.ui.status(parts.filter(Boolean).join(' · '))
}

async function summary($: EngineInterface): Promise<string> {
  const v = await view($, await $.clock.now())
  const t = v.tokens
  const r = v.model ? ratesFor(v.model) : undefined
  const p = v.project
  const out = [
    `Session         ${current.id}`,
    `Model           ${v.model ? displayName(v.model) : 'unknown'}${
      r ? `  ($${r.input} in / $${r.output} out / ${fmtRate(r.cacheRead)} cache read per 1M)` : ''
    }`,
    `Time spent      ${fmtDuration(v.activeMs)}`,
    `Claude working  ${fmtDuration(v.workingMs)}`,
    `AI cost         about ${fmtUsd(v.usd)} (estimate at API prices, not your bill)`,
    `Tokens          ${fmtTokens(sumTokens(t))} (in ${fmtTokens(t.input)}, out ${fmtTokens(t.output)}, cache read ${fmtTokens(t.cacheRead)}, cache write ${fmtTokens(t.cacheWrite)})`,
  ]
  if (v.models.length > 0) {
    out.push('By model')
    for (const m of v.models) {
      out.push(`  ${m.name.padEnd(13)} ${fmtTokens(m.tokens).padStart(7)}  ${m.isPriced ? fmtUsd(m.usd) : 'no price'}`)
    }
  }
  out.push('Phases')
  for (const ph of ORDER) {
    out.push(`  ${LABEL[ph].padEnd(9)} ${v.phaseMs[ph] === null ? '—' : fmtDuration(v.phaseMs[ph] ?? 0)}`)
  }
  const g = v.gauges
  out.push('Limits')
  out.push(
    g.contextPercent === null
      ? '  Context       no reading yet'
      : `  Context       ${Math.round(g.contextPercent)}% (${fmtTokens(g.contextTokens ?? 0)} / ${fmtTokens(g.contextWindow)})`,
  )
  for (const l of g.limits) {
    const when = resetsIn(l.resetsAt, v.nowMs)
    out.push(`  ${limitLabel(l.kind).padEnd(13)} ${Math.round(l.percentUsed)}%${when ? `, ${when}` : ''}`)
  }
  if (g.limits.length === 0) out.push('  Plan limits   none reported (API key, or no reply yet)')
  out.push(`This project (${current.root}), ${p.sessions + 1} session${p.sessions === 0 ? '' : 's'}`)
  out.push(`  Time spent      ${fmtDuration(p.activeMs + v.activeMs)}`)
  out.push(`  Claude working  ${fmtDuration(p.workMs + v.workingMs)}`)
  out.push(`  AI cost         about ${fmtUsd(p.costUsd + v.usd)}`)
  out.push(`  Tokens          ${fmtTokens(p.tokens + sumTokens(t))}`)
  if (v.check.listUsd > 0) {
    const diff = v.check.ledgerUsd - v.check.listUsd
    out.push('Price check')
    out.push(`  Tokens counted × list prices  ${fmtUsd(v.check.listUsd)}`)
    out.push(`  Claude Code's cost ledger     ${fmtUsd(v.check.ledgerUsd)}`)
    out.push(
      Math.abs(diff) < 0.01
        ? '  They match.'
        : `  Difference ${diff > 0 ? '+' : '-'}${fmtUsd(Math.abs(diff))}: web searches, fast mode, long-prompt Haiku pricing or other extras the ledger counts.`,
    )
  }
  return out.join('\n')
}

async function sessionsList($: EngineInterface): Promise<string> {
  await save($)
  const mine = (await savedSessions($))
    .filter(s => s.root === current.root)
    .sort((a, b) => a.firstSeen - b.firstSeen)
  const idWidth = Math.max(8, ...mine.map(s => s.id.length + 1))
  const rows = mine.map(
    s =>
      `  ${fmtDate(s.firstSeen)}  ${(s.id + (s.id === current.id ? '*' : ' ')).padEnd(idWidth)}  ${fmtDuration(s.activeMs).padStart(8)}  ${fmtDuration(s.workMs).padStart(8)}  ${fmtUsd(s.costUsd).padStart(9)}  ${fmtTokens(sumTokens(s.totals)).padStart(7)}`,
  )
  const sum = mine.reduce(
    (a, s) => ({
      activeMs: a.activeMs + s.activeMs,
      workMs: a.workMs + s.workMs,
      costUsd: a.costUsd + s.costUsd,
      tokens: a.tokens + sumTokens(s.totals),
    }),
    { activeMs: 0, workMs: 0, costUsd: 0, tokens: 0 },
  )
  return [
    `Sessions in ${current.root}  (* = this one)`,
    `  ${'started (UTC)'.padEnd(16)}  ${'session'.padEnd(idWidth)}  ${'open'.padStart(8)}  ${'working'.padStart(8)}  ${'cost'.padStart(9)}  ${'tokens'.padStart(7)}`,
    ...rows,
    `  ${'Total'.padEnd(18 + idWidth)}  ${fmtDuration(sum.activeMs).padStart(8)}  ${fmtDuration(sum.workMs).padStart(8)}  ${fmtUsd(sum.costUsd).padStart(9)}  ${fmtTokens(sum.tokens).padStart(7)}`,
    `Resume one with: claude --resume <session id>`,
  ].join('\n')
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  let tick: Timer | undefined
  let ticks = 0
  let isTicking = false

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await load($, await $.session.id(), true)
    const at = await $.clock.now()
    await update($, now, () => at)
    const m = await $.session.model()
    await update($, model, () => m)

    await $.command.register({
      name: 'progress',
      description:
        'Show the project monitor; "/progress sessions" lists this project\'s sessions, "/progress reset" zeroes this session',
    })

    tick?.cancel()
    tick = $.clock.every(1000, () => {
      ticks += 1
      if (isTicking) return
      isTicking = true
      void (async () => {
        try {
          const t = await $.clock.now()
          await update($, now, () => t)
          // The session's open time grows with the clock, a long gap capped.
          await update($, run, r => ({
            ...r,
            activeMs: r.activeMs + Math.min(MAX_TICK_MS, Math.max(0, t - r.lastTickAt)),
            lastTickAt: t,
          }))
          // What is streaming right now, estimated from the characters received.
          const est = liveEstimate()
          await update($, live, prev => (prev.outputTokens === est.outputTokens && prev.usd === est.usd ? prev : est))
          if (ticks % 2 === 0) {
            // A /clear or /resume moves this process to another session with no session.start.
            const id = await $.session.id()
            if (id !== current.id) {
              await save($)
              await load($, id, false)
            }
            // Cost, context and limits as Claude Code has them now (a free call).
            await refreshUsage($)
          }
          if (ticks % 5 === 0) {
            const m2 = await $.session.model()
            await update($, model, () => m2)
          }
          if (ticks % 10 === 0) await save($)
          if (ticks % 30 === 0) await refreshProject($)
          await refreshStatus($)
        } finally {
          isTicking = false
        }
      })()
    })

    void $.ui.open({ id: PANE, title: 'Progress' })
    return result
  })

  on('session.end', async ($, e, next) => {
    await save($)
    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'reset') {
      const at = await $.clock.now()
      const ledger = (await read($, run)).ledgerPrev
      await update($, run, () => freshRun(at, ledger))
      await update($, totals, () => ZERO)
      await update($, byModel, () => ({}))
      await save($)
      await refreshStatus($)
      return { text: 'This session\'s numbers are zeroed and count from now. Other sessions are untouched.' }
    }
    if (arg === 'sessions') return { text: await sessionsList($) }
    await $.ui.open({ id: PANE, title: 'Progress' })
    return { text: await summary($) }
  })

  on('prompt.submit', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, run, r => (r.isWorking ? r : { ...r, isWorking: true, turnStartedAt: at }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const phase = phaseOf(e.tool, e as unknown as Record<string, unknown>)
    if (phase) {
      const at = await $.clock.now()
      await update($, run, r => {
        let out = r.isWorking ? r : { ...r, isWorking: true, turnStartedAt: at }
        if (out.current === phase) return out
        out = closePhase(out, at)
        return {
          ...out,
          current: phase,
          phaseSince: at,
          phases: { ...out.phases, [phase]: out.phases[phase] ?? 0 },
        }
      })
    }
    return next(e)
  })

  // Every model request, main loop and subagents alike, counted the moment its
  // response ends; while it streams, the characters received feed a live estimate.
  on('turn.step', async function* ($, e, next) {
    const key = `${e.agentId ?? 'main'}:${e.turnId}:${e.index}`
    const stream = next(e)
    streaming.set(key, { model: e.model, chars: 0 })
    try {
      for await (const chunk of stream) {
        const s = streaming.get(key)
        if (s) {
          if (chunk.kind === 'text' || chunk.kind === 'thinking') s.chars += chunk.text.length
          else if (chunk.kind === 'input') s.chars += chunk.json.length
        }
        yield chunk
      }
    } finally {
      streaming.delete(key)
    }
    const result = await stream.result
    const u = result.usage
    if (u) {
      const add = (t: Totals): Totals => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
        turns: t.turns,
      })
      await update($, totals, add)
      if (u.model) await update($, byModel, per => ({ ...per, [u.model]: add(per[u.model] ?? ZERO) }))
      await update($, live, () => liveEstimate())
      await refreshUsage($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, totals, t => ({ ...t, turns: t.turns + 1 }))
      if (e.usage?.model) {
        const m = e.usage.model
        await update($, model, () => m)
      }
      const at = await $.clock.now()
      await update($, run, r => {
        const closed = closePhase(r, at)
        const worked = r.isWorking ? Math.max(0, at - r.turnStartedAt) : e.durationMs
        return { ...closed, isWorking: false, workMs: r.workMs + worked }
      })
      await refreshUsage($)
      await save($)
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const ledger = e.cost?.usd
    if (ledger !== undefined) await update($, run, r => addLedger(r, ledger))
    await update($, gauges, () => toGauges(e.context, e.rateLimits))
    return next(e)
  })

  // ---------------------------------------------------------------- the card

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await view($)
    const spin = ['◐', '◓', '◑', '◒'][Math.floor(v.nowMs / 1000) % 4]
    const rates = v.model ? ratesFor(v.model) : undefined

    const Step = (p: Phase, isLast: boolean) => {
      const ms = v.phaseMs[p]
      const isActive = v.current === p
      const isSeen = ms !== null
      const icon = isActive ? (
        <Text color="claude" bold> {spin} </Text>
      ) : isSeen ? (
        <Text backgroundColor="text" color="inverseText" bold> ✓ </Text>
      ) : (
        <Text color="inactive"> ○ </Text>
      )
      const right = isActive ? fmtDuration(ms ?? 0) : isSeen ? `Done · ${fmtDuration(ms ?? 0)}` : '—'
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              {icon}
              <Text bold={isSeen} color={isSeen ? 'text' : 'inactive'}>
                {'  '}
                {LABEL[p]}
              </Text>
            </Box>
            <Text color={isActive ? 'claude' : 'inactive'}>{right}</Text>
          </Box>
          {!isLast && <Text color="inactive"> │ </Text>}
        </Box>
      )
    }

    const Row = (label: string, value: string) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="inactive">{label}</Text>
        <Text bold>{value}</Text>
      </Box>
    )

    const Section = (title: string) => (
      <Box marginTop={1}>
        <Text color="inactive" bold>
          {title}
        </Text>
      </Box>
    )

    const BAR = 14
    const Gauge = (label: string, pct: number | null, detail: string) => {
      const p = pct === null ? 0 : Math.max(0, Math.min(100, pct))
      const filled = Math.round((p / 100) * BAR)
      const color = p >= 85 ? 'error' : p >= 60 ? 'warning' : 'success'
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text>{label}</Text>
            <Text bold color={pct === null ? 'inactive' : color}>
              {pct === null ? '—' : `${Math.round(pct)}%`}
            </Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text color="inactive">{'░'.repeat(BAR - filled)}</Text>
            </Text>
            <Text color="subtle">{detail}</Text>
          </Box>
        </Box>
      )
    }

    const g = v.gauges
    const p = v.project

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="inactive">Progress</Text>
          {v.isWorking ? <Text color="claude">● working</Text> : <Text color="inactive">idle</Text>}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text color="inactive">Model</Text>
          <Text bold color="claude">
            {v.model ? displayName(v.model) : '—'}
          </Text>
        </Box>
        {rates ? (
          <Text color="subtle">
            ${rates.input} in · ${rates.output} out · {fmtRate(rates.cacheRead)} cache / 1M
          </Text>
        ) : (
          v.model !== '' && <Text color="subtle">no list price for this model</Text>
        )}
        <Text> </Text>
        {ORDER.map((ph, i) => Step(ph, i === ORDER.length - 1))}
        <Text> </Text>
        {Row('Time spent', fmtDuration(v.activeMs))}
        {Row('Claude working', fmtDuration(v.workingMs))}
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text bold>AI cost (estimate)</Text>
          <Text bold>
            <Text color="inactive">about </Text>
            {fmtUsd(v.usd)}
          </Text>
        </Box>
        <Text color="inactive" wrap="wrap">
          The coding agent's estimate at API prices, not your bill. A subscription isn't charged this.
        </Text>
        <Box marginTop={1} flexDirection="column">
          {Row('Tokens', fmtTokens(sumTokens(v.tokens)))}
          <Text color="subtle">
            in {fmtTokens(v.tokens.input)} · out {fmtTokens(v.tokens.output)} · cache{' '}
            {fmtTokens(v.tokens.cacheRead + v.tokens.cacheWrite)}
            {v.live.outputTokens > 0 && <Text color="claude"> · streaming +{fmtTokens(v.live.outputTokens)}</Text>}
          </Text>
        </Box>
        {v.models.length > 1 && Section('By model')}
        {v.models.length > 1 &&
          v.models.map(m => (
            <Box flexDirection="row" justifyContent="space-between">
              <Text>{m.name}</Text>
              <Text>
                <Text color="subtle">{fmtTokens(m.tokens)} </Text>
                <Text bold>{m.isPriced ? fmtUsd(m.usd) : 'no price'}</Text>
              </Text>
            </Box>
          ))}
        {Section('Limits')}
        {Gauge(
          'Context',
          g.contextPercent,
          g.contextTokens === null ? 'no reading yet' : `${fmtTokens(g.contextTokens)} / ${fmtTokens(g.contextWindow)}`,
        )}
        {g.limits.map(l => Gauge(limitLabel(l.kind), l.percentUsed, resetsIn(l.resetsAt, v.nowMs)))}
        {g.limits.length === 0 && <Text color="subtle">Plan limits show here on Pro/Max after the first reply.</Text>}
        {p.sessions > 0 && Section(`This project · ${p.sessions + 1} sessions`)}
        {p.sessions > 0 && Row('Time spent', fmtDuration(p.activeMs + v.activeMs))}
        {p.sessions > 0 && Row('Claude working', fmtDuration(p.workMs + v.workingMs))}
        {p.sessions > 0 && Row('AI cost', `about ${fmtUsd(p.costUsd + v.usd)}`)}
        {p.sessions > 0 && Row('Tokens', fmtTokens(p.tokens + sumTokens(v.tokens)))}
      </Box>
    )
  })
}
