# Esitimaty

<p align="center">
  <a href="docs/esitimaty-intro.mp4">
    <img src="docs/esitimaty-intro.gif" alt="Esitimaty intro: the Progress card tracking phases, time, cost, tokens, model pricing and usage limits in Claude Code" width="900">
  </a>
  <br>
  <sub><a href="docs/esitimaty-intro.mp4">Watch the full-quality video (MP4)</a></sub>
</p>

A **project monitor for Claude Code** that estimates what a piece of work took: a project, a tool, a mod or a bug fix. It shows:
- **which model** is working, and what it charges
- **which phases** the work went through, and how long each took
- **time spent**, and how much of it Claude was actually working
- **what it would cost** at API prices, split by model
- **how many tokens** it used
- **how full** the context window and your plan's usage limits are

It runs right in your terminal.

```
╭──────────────────────────────────────╮
│ Progress                        idle │
│ Model                       Opus 5.5 │
│ $4 in · $20 out · $0.20 cache / 1M   │
│                                      │
│  ✓   Research           Done · 3m 0s │
│  │                                   │
│  ○   Plan                          — │
│  │                                   │
│  ✓   Build             Done · 12m 0s │
│  │                                   │
│  ○   Test                          — │
│  │                                   │
│  ○   Ship                          — │
│                                      │
│ Time spent                    15m 0s │
│ Claude working                15m 0s │
│ AI cost (estimate)      about $23.40 │
│ The coding agent's estimate at API   │
│ prices, not your bill. A             │
│ subscription isn't charged this.     │
│ Tokens                         36.5M │
│ in 800K · out 170K · cache 35.5M     │
│ By model                             │
│ Opus 5.5                31.9M $23.26 │
│ Haiku 5.5                 4.5M $0.14 │
│ Limits                               │
│ Context                          41% │
│ ██████░░░░░░░░           412K / 1.0M │
│ Session (5h)                     67% │
│ █████████░░░░░         resets 2h 10m │
│ Weekly (7d)                      24% │
│ ███░░░░░░░░░░░          resets 4d 3h │
╰──────────────────────────────────────╯
```

The bars turn from green to yellow at 60% and to red at 85%.

## What you get

- **A Progress pane** beside the chat:

  | Row | What it shows |
  | --- | --- |
  | **Model** | the model Claude Code is using right now (it follows `/model` switches), with its price per million tokens |
  | **Phases** | Research → Plan → Build → Test → Ship, with time in each ([below](#the-phases)) |
  | **Time spent** | how long the session has been open, across every time you resumed it |
  | **Claude working** | only the time Claude was busy on your requests, not time it sat waiting for you |
  | **AI cost (estimate)** | what the session would cost at API list prices, each response priced at the rate of the model that answered it. **It is not your bill.** On a Pro/Max subscription you aren't charged this amount. |
  | **Tokens** | every token used, subagents included: input, output, cache reads and cache writes |
  | **By model** | tokens and cost for each model that worked, e.g. Opus for the main work and Haiku for a quick search subagent. Appears once more than one model has worked. |
  | **Context** | how full the context window is, e.g. `412K / 1.0M` |
  | **Session (5h) / Weekly (7d)** | your Pro/Max plan's usage limits, with when each resets |
  | **This project** | time, Claude-working time, cost and tokens of **every session in this project folder** added up. Appears once the project has more than one session. |

- **A status line entry**, always visible: `Opus 5.5 · ⏱ 15m 0s (15m 0s working) · ~$23.40 · 36.5M tok · ctx 41% · 5h 67% · 7d 24% · project ~$60.00`
- **`/progress`** opens the pane and prints a text summary you can copy into a quote or a report.
- **`/progress sessions`** lists every session of this project: when it started, its ID (to resume it), open time, working time, cost and tokens, with a total.
- **`/progress reset`** zeroes this session's numbers so it counts from now. Other sessions keep theirs.

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

## Model pricing

The **total cost** comes from Claude Code's own cost ledger, the same number `/cost` shows. Claude Code prices every response at the rate of the model that produced it, so switching models mid-session, or subagents running on a cheaper model, are already counted correctly.

The **By model** split and the rates under the model name come from the list prices in [`hooks/pricing.ts`](hooks/pricing.ts). Each model's tokens are priced at its own rates, and the split is scaled so it adds up exactly to the ledger total.

| Model | Input | Output | Cache write (1h) | Cache read |
| --- | --- | --- | --- | --- |
| Fable 5.2 / Mythos 5.2 | $8 | $40 | $16 | $0.20 |
| Fable 5.1 / Mythos 5.1 | $10 | $50 | $20 | $0.25 |
| Fable 5 / Mythos 5 | $10 | $50 | $20 | $1.00 |
| Opus 5.5 | $4 | $20 | $8 | $0.20 |
| Opus 5, 4.8, 4.7, 4.6, 4.5 | $5 | $25 | $10 | $0.50 |
| Opus 4.1, 4 | $15 | $75 | $30 | $1.50 |
| Sonnet 5.5 | $2 | $10 | $4 | $0.10 |
| Sonnet 5 | $2 | $10 | $4 | $0.20 |
| Sonnet 4.6, 4.5, 4 | $3 | $15 | $6 | $0.30 |
| Haiku 5.5 | $0.10 | $0.50 | $0.20 | $0.01 |
| Haiku 4.5 | $1 | $5 | $2 | $0.10 |

These are USD per million tokens, from the [Claude pricing page](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-11-17. Cache writes use the 1-hour rate (2× input), because Claude Code caches its prompts for an hour. Haiku 5.5 costs 5× more on prompts over 100K tokens; the ledger total accounts for that, but the per-model split uses the base rate. If prices change, edit `hooks/pricing.ts`. A model missing from the table still counts in the total, but shows "no price" in the split.

### Is the cost right?

Yes. Claude Code records each finished session's cost per model. Multiplying that session's token counts by the prices above reproduces those costs **to the cent**:

| Session | Model | Claude Code recorded | Tokens × list prices |
| --- | --- | --- | --- |
| A | Opus 5.5 | $1.5511852 | $1.5511852 |
| B | Opus 4.7 | $8.4714245 | $8.4714245 |
| C | Haiku 5.5 | $0.0158721 | $0.0158721 |
| D | Haiku 4.5 | $0.062762 | $0.042762 + 2 web searches ($0.01 each) |

`/progress` ends with a **Price check** that does the same thing live: it compares the tokens it counted, priced with the table above, against Claude Code's ledger. Any difference is an extra the ledger counts that tokens don't show, such as web searches ($10 per 1,000), fast mode or long-prompt Haiku 5.5 pricing.

What the figure is **not**: it's the API list price of what the session used, not a bill. On Pro/Max you pay your subscription. It also leaves out Claude Code's own small background calls, which Claude Code doesn't count either.

## Saved per session

Every session's numbers are saved. **Resume a session and it carries on adding up** instead of starting over, so each session keeps its true total cost and time:

- **What's saved:** time spent, Claude-working time, cost, tokens, the split by model and the phases.
- **When:** every 10 seconds, at the end of every turn, and when the session ends.
- **Where:** in the plugin's own store in your Claude Code configuration folder. Each session is saved under its ID, the one `claude --resume` takes.
- **Resume:** `claude --resume <id>`, `claude --continue` and `/resume` all pick the saved numbers back up. `/clear` starts a new session; the old one stays saved and counts toward the project.
- **Cost on resume:** the cost adds up from each increase of Claude Code's ledger. If Claude Code restores a session's cost when you resume it, the plugin sees that and doesn't count it twice. If the ledger starts from zero in a new process, the plugin keeps the saved amount and adds the new spending on top.
- **Time spent** only counts time the session was open. Days between a session and its resume don't count, and neither does a laptop asleep with Claude Code open (gaps over 10 seconds are capped).
- **Projects:** sessions are grouped by project folder (where Claude Code started). The **This project** section and `/progress sessions` add them all up, so you can quote what a whole project took across many sessions.

## Live updates

Everything on the card moves while Claude works, not only when it finishes:

| Field | How often it updates |
| --- | --- |
| Tokens | Counted the moment each API request finishes (main loop and subagents). While a response streams, a provisional `streaming +N` estimate rises with the text, at about 4 characters per token. |
| AI cost | Re-read from Claude Code's ledger after every request and every 2 seconds, plus the estimated cost of output still streaming |
| Context, Session (5h), Weekly (7d) | Re-read after every request and every 2 seconds |
| Time spent, Claude working, phase times | Every second |
| Model | Every 5 seconds, and at the end of each turn |

## Limits

- **Context** fills as the conversation grows. Near 100%, Claude Code compacts (summarizes) the conversation, so a full bar means a compaction is coming.
- **Session (5h)** and **Weekly (7d)** are your Pro/Max plan's usage windows, as Claude Code last read them, with a countdown to each reset. They appear after the first reply. If you use an API key, there are no plan limits to show.

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
- To see what a whole project took: `/progress sessions`.
- To measure one job inside a longer session: `/progress reset`, do the work, then `/progress`.

## Accuracy

- **Cost** comes from Claude Code's own cost ledger, the same prices `/cost` uses, added up across every run of the session. It's an estimate at public API prices.
- **Tokens** are added up from each API request's usage as the API reports it. Cache reads are counted, which is why totals grow quickly in long sessions. The live `streaming` estimate is replaced by the real count when each response ends.
- **Phases** are worked out from which tools Claude uses, so they're a good guide, not an exact record. A shell command that both builds and tests counts as one or the other.
- Tokens, phases and time are counted from the moment the plugin first sees a session. For a session already under way when you install it, cost includes everything Claude Code had counted, but tokens and phases only include what came after.

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

The tests check:
- how the phase rules sort about 30 commands and tools
- that model ids in every spelling find their price, and that each token kind is charged at its own rate
- that cost, tokens, context and limits update mid-turn, and that output still streaming shows as a live estimate
- that a resumed session carries on from its saved numbers, that a restored ledger isn't counted twice, that a project's sessions add up, and that `/clear` saves the old session and starts the new one at zero
- six simulated sessions, printing the card for each:
  - building a tool
  - a bug fix
  - a reverse-engineering mod spread over two messages
  - a reset mid-session
  - an Opus session with a Haiku subagent and plan limits, where the per-model costs must add up to the total
  - a fresh API-key session

| Path | What it is |
| --- | --- |
| `.claude-plugin/plugin.json` | plugin manifest |
| `.claude-plugin/marketplace.json` | makes this repo installable with `/plugin install` |
| `hooks/register.tsx` | the plugin: hooks, pane, status line, `/progress` |
| `hooks/classify.ts` | the phase rules: which tool or command is which phase |
| `hooks/pricing.ts` | list prices per model, and matching any spelling of a model id to its price |
| `types/index.d.ts` | types for the values it keeps in session state |
| `tests/progress.test.tsx` | phase rules and job simulations |

To teach it a new command, add it to the lists in `hooks/classify.ts` and add a line to the test's `cases`.

## License

[MIT](LICENSE)
