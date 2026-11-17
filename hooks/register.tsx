import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Phase, Run, Totals } from '../types'

import { phaseOf } from './classify'

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
const run = atom({ plugin: 'esitimaty', key: 'run' } as const, freshRun(0, 0), { shape: 'run-1' })
const costUsd = atom({ plugin: 'esitimaty', key: 'costUsd' } as const, 0)
const now = atom({ plugin: 'esitimaty', key: 'now' } as const, 0)

// ---------------------------------------------------------------- phases

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

// ---------------------------------------------------------------- formatting

const sumTokens = (t: Totals) => t.input + t.output + t.cacheRead + t.cacheWrite

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

const fmtUsd = (usd: number) => `$${Math.max(0, usd).toFixed(2)}`

type View = {
  elapsedMs: number
  workingMs: number
  usd: number
  tokens: Totals
  phaseMs: Record<Phase, number | null>
  current: Phase | null
  isWorking: boolean
}

async function view($: EngineInterface, at?: number): Promise<View> {
  const r = await read($, run)
  const t = await read($, totals)
  const ledger = await read($, costUsd)
  const nowMs = at ?? (await read($, now))
  const phaseMs = { ...r.phases }
  if (r.current) phaseMs[r.current] = (phaseMs[r.current] ?? 0) + Math.max(0, nowMs - r.phaseSince)
  return {
    elapsedMs: nowMs - r.startedAt,
    workingMs: r.workMs + (r.isWorking ? Math.max(0, nowMs - r.turnStartedAt) : 0),
    usd: ledger - r.baseCostUsd,
    tokens: t,
    phaseMs,
    current: r.current,
    isWorking: r.isWorking,
  }
}

async function refreshStatus($: EngineInterface) {
  const v = await view($)
  $.ui.status(
    `⏱ ${fmtDuration(v.elapsedMs)} (${fmtDuration(v.workingMs)} working) · ~${fmtUsd(v.usd)} · ${fmtTokens(sumTokens(v.tokens))} tok`,
  )
}

async function summary($: EngineInterface): Promise<string> {
  const v = await view($, await $.clock.now())
  const t = v.tokens
  const phases = ORDER.map(p => `  ${LABEL[p].padEnd(9)} ${v.phaseMs[p] === null ? '—' : fmtDuration(v.phaseMs[p] ?? 0)}`)
  return [
    `Time spent      ${fmtDuration(v.elapsedMs)}`,
    `Claude working  ${fmtDuration(v.workingMs)}`,
    `AI cost         about ${fmtUsd(v.usd)} (estimate at API prices, not your bill)`,
    `Tokens          ${fmtTokens(sumTokens(t))} (in ${fmtTokens(t.input)}, out ${fmtTokens(t.output)}, cache read ${fmtTokens(t.cacheRead)}, cache write ${fmtTokens(t.cacheWrite)})`,
    `Phases`,
    ...phases,
  ].join('\n')
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  let tick: Timer | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    const startNow = await $.clock.now()
    if (usage.cost) await update($, costUsd, () => usage.cost!.usd)
    await update($, now, () => startNow)
    // A fresh session (not a reload of this one) starts its run at the session's start.
    await update($, run, r => (r.startedAt === 0 ? freshRun(usage.startedAt, 0) : r))

    await $.command.register({
      name: 'progress',
      description: 'Show the project estimate (time, cost, tokens, phases); "/progress reset" starts a new one',
    })

    tick?.cancel()
    tick = $.clock.every(1000, () => {
      void $.clock.now().then(async t => {
        await update($, now, () => t)
        await refreshStatus($)
      })
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
      await update($, totals, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
        turns: t.turns + (e.agentId ? 0 : 1),
      }))
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
    return next(e)
  })

  // ---------------------------------------------------------------- the card

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await view($)
    const spin = ['◐', '◓', '◑', '◒'][Math.floor((await read($, now)) / 1000) % 4]

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

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="inactive">Progress</Text>
          {v.isWorking ? <Text color="claude">● working</Text> : <Text color="inactive">idle</Text>}
        </Box>
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
      </Box>
    )
  })
}
