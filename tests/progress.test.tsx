import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

function engine(on: On, ledger: { usd: number }, current = 'claude-opus-5-5') {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: current }))
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

test('building a tool from scratch walks every phase', async ($, on) => {
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
  await $.turn.complete({
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
  await $.turn.complete({
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

test('a reverse-engineering mod job across several messages keeps adding up', async ($, on) => {
  const ledger = { usd: 0 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Message 1: take the tool apart.
  await $.prompt.submit({ text: 'figure out how this tool works', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'strings ./tool.bin | grep -i config' })
  await clock.advance(12 * 60_000)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1', usage: usage(1000, 1000, 1000, 1000) })
  await clock.advance(5 * 60_000)

  // Message 2: plan and build the mod.
  await $.prompt.submit({ text: 'now make a mod that adds dark mode', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'EnterPlanMode' })
  await clock.advance(3 * 60_000)
  await $.tool.call({ tool: 'Write', file_path: '/mod/patch.py', content: '' })
  await clock.advance(20 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await clock.advance(2 * 60_000)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't2', usage: usage(1000, 1000, 1000, 1000) })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  console.log(card('── reverse-engineering a mod, two messages', await ui.drawn()))
  // Research from message 1 is still there after message 2.
  expect((await ui.find({ type: 'Text', text: /^Done · 12m 0s$/ }))?.text).toBe('Done · 12m 0s')
  // 12m (msg 1) + 25m (msg 2) of work; the 5 minutes between them are not work.
  expect((await ui.find({ type: 'Text', text: /^37m 0s$/ }))?.text).toBe('37m 0s')
  expect((await ui.find({ type: 'Text', text: /^42m 0s$/ }))?.text).toBe('42m 0s')
  await ui.unmount()
})

test('/progress reset starts a new estimate inside a longer session', async ($, on) => {
  const ledger = { usd: 50 }
  const clock = engine(on, ledger)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 50 }, changed: ['cost'] })
  await $.prompt.submit({ text: 'earlier work', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  await clock.advance(60 * 60_000)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1', usage: usage(9, 9, 9, 9) })

  const reset = await $.command.run({ command: 'progress', args: 'reset', origin: { kind: 'composer' }, presentation: 'text' } as never)
  expect(reset.text).toBe('Estimate reset: time, cost, tokens and phases count from now.')

  await $.prompt.submit({ text: 'quick fix', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: '/b' })
  await clock.advance(90_000)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't2', usage: usage(10, 20, 30, 40) })
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
    expect(costOf('claude-opus-5-5', { ...million, input: 0, cacheWrite: 1e6 })).toBe(5)
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
  await $.turn.complete({
    reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 's1', agentId: 'a1',
    usage: { ...usage(200_000, 20_000, 4_000_000, 300_000), model: 'claude-haiku-5-5' },
  })
  await $.tool.call({ tool: 'Edit', file_path: '/api/auth.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(12 * 60_000)
  await $.turn.complete({
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

  // The per-model costs add up to the session's ledger total.
  const text = (await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: 'text' } as never)).text ?? ''
  console.log('\n── /progress summary\n' + text)
  const dollars = [...text.matchAll(/^  (?:Opus|Haiku) 5\.5 +\S+ +\$([\d.]+)$/gm)].map(m => Number(m[1]))
  expect(dollars.length).toBe(2)
  expect(Math.abs(dollars.reduce((a, b) => a + b, 0) - 23.4) < 0.02).toBe(true)
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
