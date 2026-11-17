import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { phaseOf, phaseOfCommand } from '../hooks/classify'

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

function engine(on: On, ledger: { usd: number }) {
  const clock = mock.clock(on, { now: 1_000_000 })
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
  expect((await ui.findAll({ type: 'Text', text: /^—$/ })).length).toBe(2)
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
