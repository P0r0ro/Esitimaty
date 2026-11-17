import { describe, expect, mock, test } from 'claude-code/testing'
import type {
  HookStream,
  On,
  TurnCompleteInput,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
  TurnUsage,
} from 'claude-code'

import { phaseOf, phaseOfCommand } from '../hooks/classify'
import { costOf, displayName, modelKey } from '../hooks/pricing'

// The test runner provides a console; the plugin's own environment has none.
declare const console: { log: (...args: unknown[]) => void }

const PANE = {
  plugin: 'esitimaty',
  component: 'Pane',
  requestId: 'esitimaty',
  props: {
    title: 'Progress',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// ------------------------------------------------ a rough text rendering

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
function lines(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (!node || typeof node !== 'object') return []
  const n = node as Node
  const kids = (n.children ?? (n.props?.children as unknown[] | undefined) ?? []) as unknown[]
  const list = Array.isArray(kids) ? kids : [kids]
  if (n.type === 'Text') return [list.map(k => lines(k).join('')).join('')]
  const parts = list.map(lines)
  if (n.props?.flexDirection === 'row') {
    const cells = parts.map(p => p.join(' '))
    if (n.props?.justifyContent === 'space-between' && cells.length === 2) {
      const [left = '', right = ''] = cells
      return [left + ' '.repeat(Math.max(1, 36 - left.length - right.length)) + right]
    }
    return [cells.join('')]
  }
  return parts.flat()
}
function wrap(s: string, w: number): string[] {
  if (s.length <= w) return [s]
  const out: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    if ((line + ' ' + word).trim().length > w) {
      out.push(line)
      line = word
    } else line = (line + ' ' + word).trim()
  }
  return [...out, line]
}
function card(title: string, tree: unknown): string {
  const w = 36
  const body = lines(tree).flatMap(l => wrap(l, w))
  return [
    `\n${title}`,
    '╭' + '─'.repeat(w + 2) + '╮',
    ...body.map(s => '│ ' + s.padEnd(w) + ' │'),
    '╰' + '─'.repeat(w + 2) + '╯',
  ].join('\n')
}

// ------------------------------------------------ the engine beneath

// What the next simulated model request reports, and the text it streams.
const nextStep: { usage: TurnUsage | null; text: string } = { usage: null, text: '' }

async function drain<C, R>(stream: HookStream<C, R>): Promise<R> {
  for await (const _ of stream) {
    // read to the end
  }
  return stream.result
}

type Turns = {
  turn: {
    step: (input: TurnStepInput) => HookStream<TurnStepChunk, TurnStepResult>
    complete: (input: TurnCompleteInput) => Promise<unknown>
  }
}

const stepInput = (turnId: string, model: string, agentId?: string): TurnStepInput =>
  ({ turnId, index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}) }) as TurnStepInput

// One model request (its usage counted as its response ends), then the turn's end.
async function finish($: Turns, fields: TurnCompleteInput) {
  nextStep.usage = fields.usage ?? null
  nextStep.text = 'x'.repeat(400)
  await drain($.turn.step(stepInput(fields.turnId, fields.usage?.model ?? 'claude-opus-5-5', fields.agentId)))
  await $.turn.complete(fields)
}


// Which session Claude Code is on, and the project folder it runs in.
const where = { id: 'session-1', root: '/work/app' }

function engine(
  on: On,
  ledger: { usd: number },
  current = 'claude-opus-5-5',
  saved: Readonly<Record<string, unknown>> = {},
) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, saved)
  where.id = 'session-1'
  where.root = '/work/app'
  on('session.model', () => ({ value: current }))
  on('session.id', () => ({ value: where.id }))
  on('session.root', () => ({ value: where.root }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 1_000_000, context: { window: 200000 }, rateLimits: [], cost: { usd: ledger.usd } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => e)
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    if (nextStep.text) yield { kind: 'text', index: 0, text: nextStep.text } as TurnStepChunk
    const usage = nextStep.usage
    nextStep.usage = null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as TurnStepResult
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.run', () => ({ text: '' }))
  return clock
}

const usage = (inTok: number, outTok: number, read: number, write: number) => ({
  model: 'claude-opus-5-5',
  input_tokens: inTok,
  output_tokens: outTok,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

// ------------------------------------------------ phase rules

describe('phase rules', () => {
  test('shell commands land in the phase they belong to', () => {
    const cases: [string, string][] = [
      ['ls -la', 'research'],
      ['cat src/main.c | grep -n init', 'research'],
      ['git status && git diff', 'research'],
      ['strings ./tool.bin | head -50', 'research'],
      ['objdump -d ./tool.bin', 'research'],
      ['cd app && rg TODO', 'research'],
      ['npm install', 'build'],
      ['mkdir -p src && mv a.ts src/', 'build'],
      ['python3 scripts/patch.py', 'build'],
      ["sed -i 's/a/b/' x.c", 'build'],
      ['git add .', 'build'],
      ['npm test', 'test'],
      ['pytest -q', 'test'],
      ['cargo build --release', 'test'],
      ['npx tsc --noEmit', 'test'],
      ['claude plugin validate .', 'test'],
      ['make', 'test'],
      ['git commit -m "fix" && git push', 'ship'],
      ['gh pr create --fill', 'ship'],
      ['npm publish', 'ship'],
      ['butler push build user/game:linux', 'ship'],
    ]
    for (const [command, phase] of cases) {
      expect(`${command} → ${phaseOfCommand(command)}`).toBe(`${command} → ${phase}`)
    }
  })

  test('tools land in the phase they belong to', () => {
    expect(phaseOf('Read', {})).toBe('research')
    expect(phaseOf('WebSearch', {})).toBe('research')
    expect(phaseOf('TodoWrite', {})).toBe('plan')
    expect(phaseOf('ExitPlanMode', {})).toBe('plan')
    expect(phaseOf('Edit', {})).toBe('build')
    expect(phaseOf('Write', {})).toBe('build')
    expect(phaseOf('Agent', { subagent_type: 'Explore' })).toBe('research')
    expect(phaseOf('Agent', { subagent_type: 'Plan' })).toBe('plan')
    expect(phaseOf('Agent', { subagent_type: 'general-purpose' })).toBe(undefined)
    expect(phaseOf('mcp__github__search_issues', {})).toBe('research')
    expect(phaseOf('mcp__vercel__deploy_project', {})).toBe('ship')
  })
})

// ------------------------------------------------ whole jobs

test('building a tool from scratch walks every phase', { timeoutMs: 30_000 }, async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'make me a CLI that renames photos', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: '/README.md' })
  await clock.advance(4 * 60_000)
  await $.tool.call({ tool: 'TodoWrite', todos: [] })
  await clock.advance(2 * 60_000)
  await $.tool.call({ tool: 'Write', file_path: '/src/cli.ts', content: '' })
  await clock.advance(25 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const mid = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── building a tool: while testing', await mid.drawn()))
  expect((await mid.find({ type: 'Text', text: /working/ }))?.text).toBe('● working')
  await mid.unmount()

  await clock.advance(8 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "v1" && git push' })
  await clock.advance(60_000)
  await finish($, {
    reason: 'answer', answer: 'done', durationMs: 0, isAborted: false, turnId: 't1',
    usage: usage(1_200_000, 300_000, 110_000_000, 3_900_000),
  })
  ledger.usd = 148.19
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 148.19 }, changed: ['cost'] })
  await clock.advance(10 * 60_000) // the person reads the result

  const done = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── building a tool: finished', await done.drawn()))
  expect((await done.findAll({ type: 'Text', text: /^Done · / })).length).toBe(5)
  expect((await done.find({ type: 'Text', text: /Build$/ })) !== undefined).toBe(true)
  expect((await done.find({ type: 'Text', text: /115\.4M/ }))?.text).toBe('115.4M')
  expect((await done.find({ type: 'Text', text: /idle/ }))?.text).toBe('idle')
  await done.unmount()
})

test('a bug fix shows research, build and test; plan and ship stay empty', async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'the export crashes on empty files, fix it', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Grep', pattern: 'export' })
  await clock.advance(3 * 60_000)
  await $.tool.call({ tool: 'Edit', file_path: '/src/export.py', old_string: 'a', new_string: 'b' })
  await clock.advance(2 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q tests/test_export.py' })
  await clock.advance(60_000)
  await finish($, {
    reason: 'answer', answer: 'fixed', durationMs: 0, isAborted: false, turnId: 't1',
    usage: usage(40_000, 9_000, 1_800_000, 120_000),
  })
  ledger.usd = 2.41
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 2.41 }, changed: ['cost'] })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── fixing a bug', await ui.drawn()))
  expect((await ui.findAll({ type: 'Text', text: /^Done · / })).length).toBe(3)
  expect((await ui.findAll({ type: 'Text', text: /^ ○ $/ })).length).toBe(2)
  await ui.unmount()
})

test('a reverse-engineering mod job across several messages keeps adding up', { timeoutMs: 30_000 }, async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Message 1: take the tool apart.
  await $.prompt.submit({ text: 'figure out how this tool works', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'strings ./tool.bin | grep -i config' })
  await clock.advance(12 * 60_000)
  await finish($, { reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1', usage: usage(1000, 1000, 1000, 1000) })
  await clock.advance(5 * 60_000)

  // Message 2: plan and build the mod.
  await $.prompt.submit({ text: 'now make a mod that adds dark mode', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'EnterPlanMode' })
  await clock.advance(3 * 60_000)
  await $.tool.call({ tool: 'Write', file_path: '/mod/patch.py', content: '' })
  await clock.advance(20 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await clock.advance(2 * 60_000)
  await finish($, { reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't2', usage: usage(1000, 1000, 1000, 1000) })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── reverse-engineering a mod, two messages', await ui.drawn()))
  // Research from message 1 is still there after message 2.
  expect((await ui.find({ type: 'Text', text: /^Done · 12m 0s$/ }))?.text).toBe('Done · 12m 0s')
  // 12m (msg 1) + 25m (msg 2) of work; the 5 minutes between them are not work.
  expect((await ui.find({ type: 'Text', text: /^37m 0s$/ }))?.text).toBe('37m 0s')
  expect((await ui.find({ type: 'Text', text: /^42m 0s$/ }))?.text).toBe('42m 0s')
  await ui.unmount()
})

test('/progress reset starts a new estimate inside a longer session', { timeoutMs: 30_000 }, async ($, on) => {
  const ledger = { usd: 50 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 50 }, changed: ['cost'] })
  await $.prompt.submit({ text: 'earlier work', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  await clock.advance(60 * 60_000)
  await finish($, { reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1', usage: usage(9, 9, 9, 9) })

  const reset = await $.command.run({ command: 'progress', args: 'reset', origin: { kind: 'composer' }, presentation: 'text' } as never)
  expect(reset.text).toBe("This session's numbers are zeroed and count from now. Other sessions are untouched.")

  await $.prompt.submit({ text: 'quick fix', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: '/b' })
  await clock.advance(90_000)
  await finish($, { reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't2', usage: usage(10, 20, 30, 40) })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 51.25 }, changed: ['cost'] })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── after /progress reset, one quick fix', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /\$1\.25/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^100$/ }))?.text).toBe('100')
  expect((await ui.findAll({ type: 'Text', text: /^Done · / })).length).toBe(1)
  await ui.unmount()
})

// ------------------------------------------------ pricing

describe('pricing', () => {
  test('model ids in every spelling find their price', () => {
    expect(modelKey('claude-opus-5-5')).toBe('opus-5-5')
    expect(modelKey('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
    expect(modelKey('claude-opus-4-20250514')).toBe('opus-4')
    expect(modelKey('us.anthropic.claude-sonnet-4-6')).toBe('sonnet-4-6')
    expect(modelKey('Opus 5.5')).toBe('opus-5-5')
    expect(modelKey('claude-fable-5-2[1m]')).toBe('fable-5-2')
    expect(modelKey('gpt-4o')).toBe(undefined)
    expect(displayName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  })

  test('each token kind is charged at its own rate', () => {
    const million = { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }
    expect(costOf('claude-opus-5-5', million)).toBe(4)
    expect(costOf('claude-opus-5-5', { ...million, input: 0, output: 1e6 })).toBe(20)
    expect(costOf('claude-opus-5-5', { ...million, input: 0, cacheRead: 1e6 })).toBe(0.2)
    expect(costOf('claude-opus-5-5', { ...million, input: 0, cacheWrite: 1e6 })).toBe(8)
    expect(costOf('claude-fable-5-2', { ...million, input: 0, cacheRead: 1e6 })).toBe(0.2)
    expect(costOf('claude-sonnet-5-5', { ...million, input: 0, cacheRead: 1e6 })).toBe(0.1)
    expect(costOf('claude-sonnet-4-6', { ...million, input: 0, cacheRead: 1e6 })).toBe(0.3)
    expect(costOf('claude-haiku-5-5', million)).toBe(0.1)
    expect(costOf('claude-opus-4-1', million)).toBe(15)
    expect(costOf('mystery-model', million)).toBe(undefined)
  })
})

// ------------------------------------------------ the full monitor

test('the monitor shows the model, a split by model, the context and plan limits', async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'add OAuth to the API', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', prompt: 'find auth code', description: 'explore' })
  await clock.advance(3 * 60_000)
  // The Explore subagent ran on Haiku 5.5.
  await finish($, {
    reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 's1', agentId: 'a1',
    usage: { ...usage(200_000, 20_000, 4_000_000, 300_000), model: 'claude-haiku-5-5' },
  })
  await $.tool.call({ tool: 'Edit', file_path: '/api/auth.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(12 * 60_000)
  await finish($, {
    reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1',
    usage: usage(600_000, 150_000, 30_000_000, 1_200_000),
  })
  const resets = new Date(1_000_000 + 15 * 60_000 + (2 * 60 + 10) * 60_000).toISOString()
  const weekly = new Date(1_000_000 + 15 * 60_000 + (4 * 24 + 3) * 3600_000).toISOString()
  await $.session.measure({
    context: { tokens: 412_000, window: 1_000_000, percent: 41 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 67, resetsAt: resets },
      { kind: 'seven_day', percentUsed: 23.5, resetsAt: weekly },
    ],
    cost: { usd: 23.4 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── the full monitor: Opus 5.5 with a Haiku subagent', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.text).toBe('Opus 5.5')
  expect((await ui.find({ type: 'Text', text: /\$4 in · \$20 out · \$0\.20 cache/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Haiku 5\.5$/ }))?.text).toBe('Haiku 5.5')
  expect((await ui.find({ type: 'Text', text: /^41%$/ }))?.text).toBe('41%')
  expect((await ui.find({ type: 'Text', text: /^412K \/ 1\.0M$/ }))?.text).toBe('412K / 1.0M')
  expect((await ui.find({ type: 'Text', text: /^67%$/ }))?.text).toBe('67%')
  expect((await ui.find({ type: 'Text', text: /^resets 2h 10m$/ }))?.text).toBe('resets 2h 10m')
  expect((await ui.find({ type: 'Text', text: /^resets 4d 3h$/ }))?.text).toBe('resets 4d 3h')
  await ui.unmount()

  // Each model's cost is its tokens at its own list price (1-hour cache writes).
  const text = (await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: 'text' } as never)).text ?? ''
  console.log('\n── /progress summary\n' + text)
  const dollars = [...text.matchAll(/^  (?:Opus|Haiku) 5\.5 +\S+ +\$([\d.]+)$/gm)].map(m => Number(m[1]))
  // Opus 5.5: 600K in × $4 + 150K out × $20 + 30M cache read × $0.20 + 1.2M cache write × $8 = $21.00
  // Haiku 5.5: 200K × $0.10 + 20K × $0.50 + 4M × $0.01 + 300K × $0.20 = $0.13
  expect(dollars).toEqual([21, 0.13])
})

test('an API-key session with no plan limits says so', async ($, on) => {
  const ledger = { usd: 0 }
  engine(on, ledger, 'claude-sonnet-5-5')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── fresh API-key session on Sonnet 5.5', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /^Sonnet 5\.5$/ }))?.text).toBe('Sonnet 5.5')
  expect((await ui.find({ type: 'Text', text: /Plan limits show here/ })) !== undefined).toBe(true)
  await ui.unmount()
})

// ------------------------------------------------ live updates

test('cost, tokens, context and limits update after each request, before the turn ends', async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'refactor the parser', wait: false, origin: { kind: 'composer' } })

  // First request of the turn finishes; Claude Code's ledger has moved.
  ledger.usd = 1.84
  nextStep.usage = usage(2_000, 6_000, 300_000, 40_000)
  nextStep.text = ''
  await drain($.turn.step(stepInput('t1', 'claude-opus-5-5')))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── mid-turn, after the first request', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /\$1\.84/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^348K$/ }))?.text).toBe('348K')
  await ui.unmount()

  // Second request; the clock's poll also picks up the ledger on its own.
  ledger.usd = 3.1
  nextStep.usage = usage(1_000, 4_000, 340_000, 10_000)
  await drain($.turn.step({ ...stepInput('t1', 'claude-opus-5-5'), index: 1 }))
  await clock.advance(2000)
  const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await later.find({ type: 'Text', text: /\$3\.10/ })) !== undefined).toBe(true)
  expect((await later.find({ type: 'Text', text: /^703K$/ }))?.text).toBe('703K')
  await later.unmount()
})

test('output still streaming shows as a live estimate', async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'write the docs', wait: false, origin: { kind: 'composer' } })

  nextStep.usage = usage(1_000, 2_000, 50_000, 0)
  nextStep.text = 'x'.repeat(4_000) // about 1,000 output tokens
  const stream = $.turn.step(stepInput('t1', 'claude-opus-5-5'))
  await stream.next() // the first chunk has arrived; the response is still open
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── mid-stream', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /streaming \+1\.0K/ })) !== undefined).toBe(true)
  // 1,000 output tokens on Opus 5.5 at $20 per million.
  expect((await ui.find({ type: 'Text', text: /\$0\.02/ })) !== undefined).toBe(true)
  await ui.unmount()

  // When the response ends, the real count replaces the estimate.
  await drain(stream)
  await clock.advance(1000)
  const done = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await done.find({ type: 'Text', text: /streaming/ })) === undefined).toBe(true)
  expect((await done.find({ type: 'Text', text: /^53\.0K$/ }))?.text).toBe('53.0K')
  await done.unmount()
})

// ------------------------------------------------ saved per session

const progress = (args: string) =>
  ({ command: 'progress', args, origin: { kind: 'composer' }, presentation: 'text' }) as never

const savedRecord = (id: string, root: string, costUsd: number, activeMs: number, lastLedger = costUsd) => ({
  v: 1,
  id,
  root,
  firstSeen: 500_000,
  updatedAt: 900_000,
  activeMs,
  workMs: activeMs / 2,
  costUsd,
  lastLedger,
  tokensFromUsd: 0,
  phases: { research: 600_000, plan: null, build: 1_200_000, test: null, ship: null },
  totals: { input: 1000, output: 20_000, cacheRead: 2_000_000, cacheWrite: 100_000, turns: 4 },
  byModel: {},
})

test('resuming a session carries on from its saved numbers', async ($, on) => {
  const ledger = { usd: 0 } // a new Claude Code process: its ledger starts from nothing
  engine(on, ledger, 'claude-opus-5-5', {
    'session:session-1': savedRecord('session-1', '/work/app', 10, 3_600_000),
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── resumed: the saved session picks up where it was', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /\$10\.00/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^1h 0m$/ }))?.text).toBe('1h 0m')
  expect((await ui.find({ type: 'Text', text: /^2\.1M$/ }))?.text).toBe('2.1M')
  expect((await ui.find({ type: 'Text', text: /^Done · 20m 0s$/ }))?.text).toBe('Done · 20m 0s')
  await ui.unmount()

  // New work in the resumed session adds on top.
  await $.prompt.submit({ text: 'keep going', wait: false, origin: { kind: 'composer' } })
  ledger.usd = 2.5
  await finish($, { reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1', usage: usage(1000, 1000, 1000, 1000) })
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await after.find({ type: 'Text', text: /\$12\.50/ })) !== undefined).toBe(true)
  await after.unmount()

  // And it is saved for next time.
  const list = (await $.command.run(progress('sessions'))).text ?? ''
  console.log('\n── /progress sessions after resuming\n' + list)
  expect(/session-1\* +1h 0m .*\$12\.50/.test(list)).toBe(true)
})

test('a ledger Claude Code restored on resume is not counted twice', async ($, on) => {
  const ledger = { usd: 10 } // Claude Code brought the session's $10 back with it
  engine(on, ledger, 'claude-opus-5-5', {
    'session:session-1': savedRecord('session-1', '/work/app', 10, 600_000, 10),
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  ledger.usd = 11
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 11 }, changed: ['cost'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /\$11\.00/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('every session of the project adds up, and /progress sessions lists them', async ($, on) => {
  const ledger = { usd: 0 }
  engine(on, ledger, 'claude-opus-5-5', {
    'session:older-a': savedRecord('older-a', '/work/app', 40, 2 * 3_600_000),
    'session:older-b': savedRecord('older-b', '/work/app', 15.5, 3_600_000),
    'session:elsewhere': savedRecord('elsewhere', '/work/other', 99, 9 * 3_600_000),
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  ledger.usd = 4.5
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 4.5 }, changed: ['cost'] })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── a project with two earlier sessions', await ui.drawn()))
  expect((await ui.find({ type: 'Text', text: /This project · 3 sessions/ })) !== undefined).toBe(true)
  // $40 + $15.50 + this session's $4.50; the other project's $99 stays out.
  expect((await ui.find({ type: 'Text', text: /^about \$60\.00$/ }))?.text).toBe('about $60.00')
  await ui.unmount()

  const list = (await $.command.run(progress('sessions'))).text ?? ''
  console.log('\n── /progress sessions\n' + list)
  expect(list.includes('older-a')).toBe(true)
  expect(list.includes('elsewhere')).toBe(false)
  expect(/Total .* \$60\.00/.test(list)).toBe(true)
})

test('/clear saves the old session and starts the new one from zero', async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  ledger.usd = 7
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 7 }, changed: ['cost'] })

  // /clear: same process, a new session id, no session.start.
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } } as never)
  where.id = 'session-2'
  await clock.advance(2000)

  const list = (await $.command.run(progress('sessions'))).text ?? ''
  console.log('\n── /progress sessions after /clear\n' + list)
  expect(/session-1 +\S+ +\S+ +\$7\.00/.test(list)).toBe(true)
  ledger.usd = 8 // whatever the ledger does next belongs to session-2
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^about \$1\.00$/ })) !== undefined).toBe(true)
  // session-1 now counts toward the project.
  expect((await ui.find({ type: 'Text', text: /This project · 2 sessions/ })) !== undefined).toBe(true)
  await ui.unmount()
})
