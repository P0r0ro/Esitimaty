# Esitimaty

A **Progress card for Claude Code** that estimates what a piece of work took: a project, a tool, a mod or a bug fix. It shows which phases the work went through and how long each one took. It also shows time spent, time Claude was actually working, what it would cost at API prices, and how many tokens it used. It runs right in your terminal.

```
╭──────────────────────────────────────╮
│ Progress                        idle │
│                                      │
│  ✓   Research           Done · 4m 0s │
│  │                                   │
│  ✓   Plan               Done · 2m 0s │
│  │                                   │
│  ✓   Build             Done · 25m 0s │
│  │                                   │
│  ✓   Test               Done · 8m 0s │
│  │                                   │
│  ✓   Ship               Done · 1m 0s │
│                                      │
│ Time spent                    50m 0s │
│ Claude working                40m 0s │
│ AI cost (estimate)     about $148.19 │
│ The coding agent's estimate at API   │
│ prices, not your bill. A             │
│ subscription isn't charged this.     │
│ Tokens                        115.4M │
│ in 1.2M · out 300.0K · cache 113.9M  │
╰──────────────────────────────────────╯
```

## What you get

- **A Progress pane** beside the chat. It shows the five phases, then these numbers:

  | Row | What it shows |
  | --- | --- |
  | **Time spent** | wall-clock time since the session started (or since your last reset) |
  | **Claude working** | only the time Claude was busy on your requests, not time it sat waiting for you |
  | **AI cost (estimate)** | the same running total Claude Code's `/cost` shows, at API list prices. **It is not your bill.** On a Pro/Max subscription you aren't charged this amount. |
  | **Tokens** | every token used, subagents included: input, output, cache reads and cache writes |

- **A status line entry**, always visible: `⏱ 50m 0s (40m 0s working) · ~$148.19 · 115.4M tok`
- **`/progress`** opens the pane and prints a text summary you can copy into a quote or a report.
- **`/progress reset`** starts a new estimate from now. Use it to measure a single fix or feature inside a longer session.

## The phases

The phases build up over the whole session (or since your last `/progress reset`), not just your latest message. A phase you never needed shows `—`. The spinning icon marks the phase under way right now.

| Phase | What counts |
| --- | --- |
| **Research** | Reading and searching: Read, Grep, Glob, web search and fetch, exploring subagents, read-only MCP tools. Also inspection-only shell commands: `ls`, `cat`, `grep`, `find`, `git status/log/diff`, `strings`, `objdump`, `readelf`, `curl`… |
| **Plan** | Plan mode, to-do lists, questions to you, the Plan subagent |
| **Build** | Edit, Write, and any shell command that changes things: `npm install`, `mkdir`, `mv`, `sed -i`, running scripts, `git add` |
| **Test** | Tests, linters, type checks and builds: `npm test`, `pytest`, `cargo build`, `tsc`, `make`, `eslint`, `… validate`… |
| **Ship** | Commits, pushes and releases: `git commit/push`, `gh pr create`, `npm publish`, `docker push`, `butler push`, deploy commands, publishing tools |

Time is assigned to the phase that's under way until the next phase starts. Tool calls that don't fit any phase leave the current phase running. Time Claude spends thinking before its first tool call counts toward **Claude working**, but toward no phase.

## Install

You need [Claude Code](https://claude.com/claude-code) installed in a terminal.

At the Claude Code prompt:

```
/plugin install esitimaty --marketplace P0r0ro/Esitimaty
```

1. When asked `Add marketplace?` for `github:P0r0ro/Esitimaty`, answer **y**.
2. Pick a scope. **User** (the first option) turns it on for every session.
3. You'll see `Installed esitimaty. Plugin is now active.` The pane and status line start right away, with no restart needed.

Or from a shell:

```sh
claude plugin install esitimaty --marketplace P0r0ro/Esitimaty
```

**Desktop app:** `/plugin` doesn't run there. Click **+** next to the prompt box, then **Plugins**, then **Add marketplace**, enter `P0r0ro/Esitimaty`, then **Add plugin**.

### Update / uninstall

```
/plugin marketplace update esitimaty
/plugin uninstall esitimaty
```

## Using it

- The pane opens by itself when your terminal is **at least 144 columns wide**. In a narrower window, type `/progress` to open it.
- To estimate one job: `/progress reset`, do the work, then `/progress` to get the summary.

## Accuracy

- **Cost** comes from Claude Code's own cost ledger, the same number `/cost` gives. It's an estimate at public API prices. After `/progress reset`, the cost before the reset is subtracted.
- **Tokens** are added up from each turn's usage as the API reports it. Cache reads are counted, which is why totals grow quickly in long sessions.
- **Phases** are worked out from which tools Claude uses, so they're a good guide, not an exact record. A shell command that both builds and tests counts as one or the other.
- Tokens and phases are counted from the moment the plugin loads. If you resume a session that ran before you installed it, the earlier work isn't included in them. Time and cost still are.

## Development

Run it from a clone without installing:

```sh
git clone https://github.com/P0r0ro/Esitimaty
claude --plugin-dir ./Esitimaty
```

Check and test it:

```sh
claude plugin validate .
claude plugin test .
```

The tests check how the phase rules sort about 30 commands and tools. They also simulate four jobs (building a tool, a bug fix, a reverse-engineering mod spread over two messages, and a reset mid-session) and print the card for each.

| Path | What it is |
| --- | --- |
| `.claude-plugin/plugin.json` | plugin manifest |
| `.claude-plugin/marketplace.json` | makes this repo installable with `/plugin install` |
| `hooks/register.tsx` | the plugin: hooks, pane, status line, `/progress` |
| `hooks/classify.ts` | the phase rules: which tool or command is which phase |
| `types/index.d.ts` | types for the values it keeps in session state |
| `tests/progress.test.tsx` | phase rules and job simulations |

To teach it a new command, add it to the lists in `hooks/classify.ts` and add a line to the test's `cases`.

## License

[MIT](LICENSE)
