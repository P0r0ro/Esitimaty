import type { Phase } from '../types'

// Which phase of a project a tool call belongs to. Pure functions, no `$`.

const RESEARCH_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'Skill',
  'NotebookRead', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
])
const PLAN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode', 'TodoWrite', 'AskUserQuestion'])
const BUILD_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHIP_TOOLS = new Set(['Artifact'])

// Commands that only look: reading, searching, inspecting state.
const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'rg', 'ag', 'find', 'fd', 'tree',
  'wc', 'file', 'stat', 'which', 'whereis', 'type', 'pwd', 'echo', 'printf', 'du', 'df', 'ps',
  'top', 'env', 'printenv', 'date', 'uname', 'whoami', 'id', 'realpath', 'dirname', 'basename',
  'readlink', 'diff', 'cmp', 'jq', 'yq', 'sort', 'uniq', 'cut', 'tr', 'column', 'xxd', 'hexdump',
  'strings', 'objdump', 'readelf', 'nm', 'ldd', 'curl', 'wget', 'man', 'tldr', 'journalctl',
  'lsblk', 'lscpu', 'free', 'uptime', 'cd', 'true', 'test', '[',
])
const READ_ONLY_SUB: Record<string, RegExp> = {
  git: /^(status|log|diff|show|blame|branch|remote|ls-files|ls-tree|rev-parse|describe|shortlog|reflog|config\s+--get|tag\s*$|tag\s+-l|fetch)\b/,
  gh: /^(issue|pr|repo|release|run|workflow)\s+(view|list|status|diff|checks)\b|^(auth\s+status|api\s+(?!-X))/,
  docker: /^(ps|images|logs|inspect|info|version)\b/,
  kubectl: /^(get|describe|logs|top|version|config\s+view)\b/,
  systemctl: /^(status|list-units|is-active|is-enabled|cat)\b/,
  npm: /^(ls|list|view|info|outdated|search|explain|why)\b/,
  pnpm: /^(ls|list|why|outdated)\b/,
  pip: /^(show|list|freeze|search)\b/,
  pip3: /^(show|list|freeze|search)\b/,
  cargo: /^(tree|metadata|search)\b/,
  sed: /^-n\b/,
}
const SHIP_CMD =
  /\b(git\s+(commit|push|tag\s+-a|merge)|gh\s+(pr\s+(create|merge)|release\s+create|repo\s+create)|(npm|yarn|pnpm)\s+publish|cargo\s+publish|twine\s+upload|docker\s+push|kubectl\s+apply|helm\s+(install|upgrade)|terraform\s+apply|vercel|netlify\s+deploy|fly\s+deploy|firebase\s+deploy|butler\s+push|steamcmd|deploy)\b/
const TEST_CMD =
  /\b(test|tests|pytest|jest|vitest|mocha|rspec|phpunit|ctest|tox|nox|lint|eslint|ruff|flake8|pylint|mypy|pyright|tsc|clippy|shellcheck|hadolint|validate|verify|typecheck|type-check|check|build|compile|make|ninja|cmake|gradle|gradlew|mvn|msbuild|xcodebuild|go\s+vet|bench|benchmark|coverage)\b/

function segmentIsReadOnly(segment: string): boolean {
  const words = segment.trim().replace(/^(sudo\s+|[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').split(/\s+/)
  const head = (words[0] ?? '').replace(/^.*\//, '')
  if (head === '') return true
  const sub = READ_ONLY_SUB[head]
  if (sub) return sub.test(words.slice(1).join(' '))
  return READ_ONLY.has(head)
}

export function phaseOfCommand(command: string): Phase {
  if (SHIP_CMD.test(command)) return 'ship'
  const segments = command.split(/&&|\|\||;|\||\n/)
  if (segments.every(segmentIsReadOnly)) return 'research'
  if (TEST_CMD.test(command)) return 'test'
  return 'build'
}

export function phaseOf(tool: string, input: Record<string, unknown>): Phase | undefined {
  if (RESEARCH_TOOLS.has(tool)) return 'research'
  if (PLAN_TOOLS.has(tool)) return 'plan'
  if (BUILD_TOOLS.has(tool)) return 'build'
  if (SHIP_TOOLS.has(tool)) return 'ship'
  if (tool === 'Bash' && typeof input.command === 'string') return phaseOfCommand(input.command)
  if (tool === 'Agent' || tool === 'Task') {
    // A subagent's own tool calls are classified as they happen; only the
    // read-only and planning agent types say something by themselves.
    const kind = String(input.subagent_type ?? '').toLowerCase()
    if (kind === 'explore' || kind.includes('guide') || kind.includes('research')) return 'research'
    if (kind === 'plan') return 'plan'
    return undefined
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.toLowerCase()
    if (/(deploy|publish|release|push|merge)/.test(name)) return 'ship'
    if (/(search|list|get|read|fetch|query|find|describe|show|status|view)/.test(name)) return 'research'
    if (/(create|update|write|edit|generate|add|set|upload|delete|remove|run|exec)/.test(name)) return 'build'
  }
  return undefined
}
