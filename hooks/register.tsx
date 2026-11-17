import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { ByModel, Gauges, Phase, Run, Totals } from '../types'

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
const freshRun = (at: number, baseCostUsd: number): Run => ({
  startedAt: at,
  baseCostUsd,
  workMs: 0,
  isWorking: false,
  turnStartedAt: at,
  current: null,
  phaseSince: at,
  phases: { ...NO_PHASES },
})

const totals = atom({ plugin: 'esitimaty', key: 'totals' } as const, ZERO, { shape: 'totals-1' })
const byModel = atom({ plugin: 'esitimaty', key: 'byModel' } as const, {} as ByModel, { shape: 'by-model-1' })
const run = atom({ plugin: 'esitimaty', key: 'run' } as const, freshRun(0, 0), { shape: 'run-1' })
const gauges = atom({ plugin: 'esitimaty', key: 'gauges' } as const, NO_GAUGES, { shape: 'gauges-1' })
const model = atom({ plugin: 'esitimaty', key: 'model' } as const, '')
const costUsd = atom({ plugin: 'esitimaty', key: 'costUsd' } as const, 0)
const now = atom({ plugin: 'esitimaty', key: 'now' } as const, 0)

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

function toGauges(context: SessionContextUsage, rateLimits: readonly SessionRateLimit[]): Gauges {
  return {
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    contextPercent: context.percent ?? null,
    limits: rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
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
  elapsedMs: number
  workingMs: number
  usd: number
  tokens: Totals
  models: { id: string; name: string; tokens: number; usd: number; isPriced: boolean }[]
  model: string
  phaseMs: Record<Phase, number | null>
  current: Phase | null
  isWorking: boolean
  gauges: Gauges
  nowMs: number
}

async function view($: EngineInterface, at?: number): Promise<View> {
  const r = await read($, run)
  const t = await read($, totals)
  const per = await read($, byModel)
  const ledger = await read($, costUsd)
  const nowMs = at ?? (await read($, now))
  const phaseMs = { ...r.phases }
  if (r.current) phaseMs[r.current] = (phaseMs[r.current] ?? 0) + Math.max(0, nowMs - r.phaseSince)
  const usd = ledger - r.baseCostUsd

  // Each model's share at its own list price, scaled so the shares add up to
  // the session's ledger, which already priced every response at its model's rate.
  const priced = Object.entries(per).map(([id, tok]) => ({ id, tok, list: costOf(id, tok) }))
  const listTotal = priced.reduce((s, p) => s + (p.list ?? 0), 0)
  const scale = usd > 0 && listTotal > 0 ? usd / listTotal : 1
  const models = priced
    .map(p => ({
      id: p.id,
      name: displayName(p.id),
      tokens: sumTokens(p.tok),
      usd: (p.list ?? 0) * scale,
      isPriced: p.list !== undefined,
    }))
    .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens)

  return {
    elapsedMs: nowMs - r.startedAt,
    workingMs: r.workMs + (r.isWorking ? Math.max(0, nowMs - r.turnStartedAt) : 0),
    usd: usd > 0 || listTotal === 0 ? usd : listTotal,
    tokens: t,
    models,
    model: await read($, model),
    phaseMs,
    current: r.current,
    isWorking: r.isWorking,
    gauges: await read($, gauges),
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
    `⏱ ${fmtDuration(v.elapsedMs)} (${fmtDuration(v.workingMs)} working)`,
    `~${fmtUsd(v.usd)}`,
    `${fmtTokens(sumTokens(v.tokens))} tok`,
    v.gauges.contextPercent !== null ? `ctx ${Math.round(v.gauges.contextPercent)}%` : '',
    ...v.gauges.limits.map(l => `${limitShort[l.kind] ?? limitLabel(l.kind)} ${Math.round(l.percentUsed)}%`),
  ]
  $.ui.status(parts.filter(Boolean).join(' · '))
}

async function summary($: EngineInterface): Promise<string> {
  const v = await view($, await $.clock.now())
  const t = v.tokens
  const r = v.model ? ratesFor(v.model) : undefined
  const out = [
    `Model           ${v.model ? displayName(v.model) : 'unknown'}${
      r ? `  ($${r.input} in / $${r.output} out / ${fmtRate(r.cacheRead)} cache read per 1M)` : ''
    }`,
    `Time spent      ${fmtDuration(v.elapsedMs)}`,
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
  for (const p of ORDER) {
    out.push(`  ${LABEL[p].padEnd(9)} ${v.phaseMs[p] === null ? '—' : fmtDuration(v.phaseMs[p] ?? 0)}`)
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
  return out.join('\n')
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  let tick: Timer | undefined
  let ticks = 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    const startNow = await $.clock.now()
    if (usage.cost) await update($, costUsd, () => usage.cost!.usd)
    await update($, now, () => startNow)
    await update($, gauges, () => toGauges(usage.context, usage.rateLimits))
    const current = await $.session.model()
    await update($, model, () => current)
    // A fresh session (not a reload of this one) starts its run at the session's start.
    await update($, run, r => (r.startedAt === 0 ? freshRun(usage.startedAt, 0) : r))

    await $.command.register({
      name: 'progress',
      description: 'Show the project monitor (model, time, cost, tokens, phases, limits); "/progress reset" starts a new estimate',
    })

    tick?.cancel()
    tick = $.clock.every(1000, () => {
      ticks += 1
      void (async () => {
        const t = await $.clock.now()
        await update($, now, () => t)
        // The model can change with /model between turns: look every few seconds.
        if (ticks % 5 === 0) {
          const m = await $.session.model()
          await update($, model, () => m)
        }
        await refreshStatus($)
      })()
    })

    void $.ui.open({ id: PANE, title: 'Progress' })
    return result
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      const at = await $.clock.now()
      const ledger = await read($, costUsd)
      await update($, run, () => freshRun(at, ledger))
      await update($, totals, () => ZERO)
      await update($, byModel, () => ({}))
      await refreshStatus($)
      return { text: 'Estimate reset: time, cost, tokens and phases count from now.' }
    }
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

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const add = (t: Totals): Totals => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
        turns: t.turns + (e.agentId ? 0 : 1),
      })
      await update($, totals, add)
      if (u.model) await update($, byModel, per => ({ ...per, [u.model]: add(per[u.model] ?? ZERO) }))
      if (!e.agentId && u.model) await update($, model, () => u.model)
    }
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, run, r => {
        const closed = closePhase(r, at)
        const worked = r.isWorking ? Math.max(0, at - r.turnStartedAt) : e.durationMs
        return { ...closed, isWorking: false, workMs: r.workMs + worked }
      })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost) await update($, costUsd, () => e.cost!.usd)
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
        {ORDER.map((p, i) => Step(p, i === ORDER.length - 1))}
        <Text> </Text>
        {Row('Time spent', fmtDuration(v.elapsedMs))}
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
      </Box>
    )
  })
}
