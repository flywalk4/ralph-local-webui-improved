<p align="center">
  <h1 align="center">Open Ralph Wiggum</h1>
  <h3 align="center">Autonomous Agentic Loop for Claude Code, Codex, Copilot CLI & OpenCode</h3>
</p>

<p align="center">
 
<img src="screenshots/dashboard-launch.png" alt="Dashboard Launch page" width="100%">
</p>

<p align="center">
  <em>Works with <b>Claude Code</b>, <b>OpenAI Codex</b>, <b>Copilot CLI</b>, and <b>OpenCode</b> — switch agents with <code>--agent</code>.</em><br>
  <em>Based on the <a href="https://ghuntley.com/ralph/">Ralph Wiggum technique</a> by Geoffrey Huntley</em>
</p>

<p align="center">
  <a href="https://github.com/flywalk4/open-ralph-wiggum/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/flywalk4/open-ralph-wiggum"><img src="https://img.shields.io/badge/built%20with-Bun%20%2B%20TypeScript-f472b6.svg" alt="Built with Bun + TypeScript"></a>
  <a href="https://github.com/flywalk4/open-ralph-wiggum/releases"><img src="https://img.shields.io/github/v/release/flywalk4/open-ralph-wiggum?include_prereleases" alt="Release"></a>

</p>

<p align="center">
  <a href="#supported-agents">Agents</a> •
  <a href="#what-is-open-ralph-wiggum">What is Ralph?</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#commands--options">Commands</a> •
  <a href="#web-dashboard">Dashboard</a> •
  <a href="#plan-mode">Plan Mode</a> •
  <a href="#presets">Presets</a>
</p>

Quick run
```bash
ralph dashboard --open
```

---

## Supported Agents

Open Ralph Wiggum works with multiple AI coding agents. Switch between them using the `--agent` flag:

| Agent | Flag | Description |
|-------|------|-------------|
| **OpenCode** | `--agent opencode` | Default agent — open-source AI coding assistant |
| **Claude Code** | `--agent claude-code` | Anthropic's Claude Code CLI for autonomous coding |
| **Codex** | `--agent codex` | OpenAI's Codex CLI for AI-powered development |
| **Copilot CLI** | `--agent copilot` | GitHub Copilot CLI for agentic coding |
| **Aider** | `--agent aider` | Aider AI pair programming (supports local models via `--base-url`) |
| **LLM** | `--agent llm` | Built-in agent — calls any OpenAI-compatible API directly, no extra tools needed |

```bash
ralph "Build a REST API" --agent claude-code --max-iterations 10
ralph "Create a CLI tool" --agent codex --max-iterations 10
ralph "Fix failing tests" --agent aider --model ollama/qwen2.5-coder --base-url http://localhost:11434/v1
ralph "Create a website" --agent llm --model qwen2.5-coder:32b --base-url http://localhost:11434/v1
```

---

## What is Open Ralph Wiggum?

Open Ralph Wiggum implements the **Ralph Wiggum technique** — an autonomous agentic loop where an AI coding agent receives the **same prompt repeatedly** until it completes a task. Each iteration, the agent sees its previous work in files and git history, enabling self-correction and incremental progress.

```bash
# The essence of the Ralph loop:
while true; do
  claude-code "Build feature X. Output <promise>DONE</promise> when complete."
done
```

**Why this works:** The AI doesn't talk to itself between iterations. It sees the same prompt each time, but the codebase has changed from previous work. This creates a feedback loop where the agent iteratively improves until the task is genuinely done.

---

## Key Features

- **Multi-Agent Support** — Use Claude Code, Codex, Copilot CLI, Aider, or OpenCode with the same workflow
- **Self-Correcting Loops** — Agent sees its previous work and fixes its own mistakes
- **Git Self-Diagnosis** — Automatically scans recent commits for `TODO`, `FIXME`, `ERROR`, `FAIL`, `BUG`, `BROKEN`, `HACK` keywords and injects a warning section into every prompt
- **Web Dashboard** — `ralph dashboard` opens a full dark web UI to launch loops, monitor progress, view plans/logs, inject context, and stop runs — all from the browser
- **✨ Prompt Enrichment** — One-click button on the Launch page expands a short task description into a detailed, agent-ready specification using the configured LLM (works with Anthropic API, OpenAI API, or any local model via `--base-url`)
- **⏹ Stop Loop** — Stop the running loop instantly from the sidebar button (visible on every page) or from the Status page, without touching the terminal
- **Plan Mode** — `--plan` keeps `IMPLEMENTATION_PLAN.md` and `activity.md` in sync across iterations
- **Improving Mode** — `--improving [N]` keeps running after the task is done; each cycle ralph autonomously picks the most valuable improvement (design, performance, tests, security, features, etc.) and implements it. Works on existing projects too: `ralph --improving 5`
- **Task Tracking** — `--tasks` mode breaks complex projects into a managed checklist
- **Presets** — `--preset NAME` loads saved prompt/config combos from `presets.json`
- **Local Model Support** — built-in `llm` agent + `--base-url` for any OpenAI-compatible API; `--optimize` and `--max-prompt-tokens` tune the prompt for small models; Ollama model list auto-detected when `--model` is omitted
- **Agent Rotation** — `--rotation` cycles through different agent/model pairs each iteration
- **Mid-Loop Hints** — Inject guidance with `--add-context` or via the dashboard without stopping the loop
- **Auto Stuck Detection** — after 3 consecutive iterations with no file changes, automatically injects a warning into the prompt urging the agent to try a different approach
- **Diff Injection** — `--diff` shows the agent exactly what it changed in the previous iteration via `git diff HEAD~1`
- **Live Monitoring** — Check progress with `--status` or the web dashboard from another terminal

---

## Installation

**Prerequisites:**
- [Bun](https://bun.sh) runtime
- At least one AI coding agent CLI installed and authenticated

### npm (recommended)

```bash
npm install -g @flywalk4/ralph-wiggum
```

### Bun

```bash
bun add -g @flywalk4/ralph-wiggum
```

### From source

```bash
git clone https://github.com/flywalk4/open-ralph-wiggum
cd open-ralph-wiggum
./install.sh        # Linux / macOS
.\install.ps1       # Windows (PowerShell)
```

### Uninstall

```bash
npm uninstall -g @flywalk4/ralph-wiggum
# or from the repo:
./uninstall.sh      # Linux / macOS
.\uninstall.ps1     # Windows
```

---

## Quick Start

```bash
# Simple task
ralph "Create a hello.txt with 'Hello World'." --max-iterations 5

# Build something real
ralph "Build a REST API for todos with CRUD operations and tests. \
  Run tests after each change. Output <promise>COMPLETE</promise> when all tests pass." \
  --max-iterations 20

# Use Claude Code
ralph "Refactor auth module and ensure tests pass" \
  --agent claude-code --model claude-sonnet-4 --max-iterations 15

# Use a local model via Ollama
ralph "Fix the failing tests" \
  --agent aider --model ollama/qwen2.5-coder \
  --base-url http://localhost:11434/v1

# Complex project with plan tracking
ralph "Build a full-stack web app with user auth and database" \
  --plan --max-iterations 50

# Build, then auto-improve 5 times
ralph "Build a REST API" --plan --improving 5

# Improve an existing project (no initial task needed)
ralph --improving 3 --plan

# Load a saved preset
ralph --preset my_api_task

# Monitor the loop in your browser
ralph dashboard --open
```

---

## Commands & Options

```
ralph "<prompt>" [options]
ralph --prompt-file <path> [options]
ralph dashboard [--port N] [--open]
```

### Core Options

| Option | Default | Description |
|--------|---------|-------------|
| `--agent AGENT` | `opencode` | Agent: `opencode`, `claude-code`, `codex`, `copilot`, `aider`, `llm` |
| `--model MODEL` | agent default | Model name (e.g. `anthropic/claude-sonnet-4`) |
| `--min-iterations N` | `1` | Minimum iterations before completion is accepted |
| `--max-iterations N` | unlimited | Stop after N iterations |
| `--completion-promise TEXT` | `COMPLETE` | Text that signals task completion |
| `--abort-promise TEXT` | — | Text that signals early abort (precondition failed) |

### Prompt Sources

| Option | Description |
|--------|-------------|
| `--prompt-file, --file, -f PATH` | Read prompt from a file |
| `--prompt-template PATH` | Use a custom prompt template with `{{variables}}` |
| `--preset NAME` | Load a saved prompt/config combo from `presets.json` |
| `--init-presets` | Write a starter `presets.json` to `.ralph/presets.json` |

### Modes

| Option | Description |
|--------|-------------|
| `--tasks, -t` | Tasks Mode — work through a checklist in `.ralph/ralph-tasks.md` |
| `--task-promise TEXT` | Signal for one task done (default: `READY_FOR_NEXT_TASK`) |
| `--plan` | Plan Mode — agent maintains `IMPLEMENTATION_PLAN.md` + `activity.md` |
| `--optimize` | Strip all non-essential prompt sections (git diagnosis, plan files, verbose instructions). Recommended for small/weak local models |
| `--diff` | Inject `git diff HEAD~1` into every prompt so the agent can see exactly what it changed in the previous iteration |
| `--max-prompt-tokens N` | Truncate the prompt to ~N tokens. Keeps the task (start) and completion signal (end); removes middle sections |
| `--improving [N]` | Improving Mode — see below |

### Improving Mode

After the initial task is done, `--improving` keeps the loop running. Each cycle ralph autonomously picks the most valuable improvement area and implements it — no human input needed.

```bash
# Build a project, then run 5 improvement cycles
ralph "Build a todo app" --plan --improving 5

# Unlimited improvement cycles (runs until Ctrl+C or --max-iterations)
ralph "Create a REST API" --plan --improving

# Improve an existing project — no initial task needed
ralph --improving 5 --plan

# Quick polish pass without plan files
ralph --improving 2
```

**What ralph improves each cycle (agent's choice):**
- 🏗 Architecture & design — better abstractions, cleaner separation of concerns
- ⚡ Performance — speed up slow paths, reduce memory, optimize algorithms
- 🎨 User experience — interface, visual design, usability, feedback
- ✅ Reliability — tests, error handling, edge cases, validation
- 🔒 Security — input hardening, vulnerability fixes, dependency audits
- 📖 Code quality — refactoring, naming, documentation
- ✨ New features — whatever adds the most value

With `--plan`, each cycle archives the previous `IMPLEMENTATION_PLAN.md` as `IMPLEMENTATION_PLAN.cycle{N}.md` and creates a fresh plan for the new improvement focus.

**Dashboard:** The Launch form has an `--improving` checkbox and an optional cycle count field. The Status and Activity pages show the current cycle number as a `🔧 Cycle N / M` badge.

### Multi-Agent Rotation

```bash
# Cycle between agents/models across iterations
ralph "Build feature" \
  --rotation "opencode:claude-sonnet-4,claude-code:claude-sonnet-4" \
  --max-iterations 10
```

Each entry must be `agent:model`. When `--rotation` is used, `--agent` and `--model` are ignored.

### Local / OpenAI-compatible Models

```bash
# Built-in LLM agent — no extra tools, works with any model that generates text
ralph "Fix the failing tests" \
  --agent llm --model qwen2.5-coder:32b \
  --base-url http://192.168.1.100:11434/v1

# With optimizations for small/weak models
ralph "Create a landing page" \
  --agent llm --model qwen2.5-coder:7b \
  --base-url http://localhost:11434/v1 \
  --optimize --max-prompt-tokens 2048

# Aider with a local model
ralph "Fix the failing tests" \
  --agent aider --model ollama/qwen2.5-coder \
  --base-url http://localhost:11434/v1

# OpenCode with a local model (auto-registers the provider)
ralph "Fix the failing tests" \
  --agent opencode --model qwen2.5-coder:32b \
  --base-url http://localhost:11434/v1
```

The `--base-url` flag works with any OpenAI-compatible server (Ollama, LM Studio, vLLM, etc.).

**Ollama model auto-detect:** if you pass `--base-url` without `--model`, ralph will fetch the available models from Ollama and show a usage example.

**Agent comparison for local models:**

| Agent | Requires | Best for |
|-------|----------|----------|
| `llm` | Nothing extra | Any model, simple file generation |
| `opencode` | opencode CLI | 14B+ models with function calling |
| `aider` | aider CLI | Models with good diff-following |

### Output & Permissions

| Option | Description |
|--------|-------------|
| `--no-stream` | Buffer output and print at end instead of streaming |
| `--verbose-tools` | Print every tool call (disables compact tool summary) |
| `--questions` | Enable interactive question handling (default: on) |
| `--no-questions` | Disable interactive question handling |
| `--no-plugins` | Disable non-auth OpenCode plugins (opencode only) |
| `--no-commit` | Skip auto-commit after each iteration |
| `--allow-all` | Auto-approve all tool permissions (default: on) |
| `--no-allow-all` | Require interactive permission prompts |

### Status & Control Commands

```bash
ralph --status                          # Active loop state + history
ralph --status --tasks                  # Include current task list
ralph --add-context "Focus on auth.ts"  # Inject hint into next iteration
ralph --clear-context                   # Clear pending context note
ralph --list-tasks                      # Show task list with indices
ralph --add-task "Implement login page"  # Add a task
ralph --remove-task 3                   # Remove task at index 3
```

### Config Commands

```bash
ralph --init-config              # Write default agent config to ~/.config/open-ralph-wiggum/agents.json
ralph --init-config ./my.json    # Write to custom path
ralph --config ./my.json         # Use custom agent config for this run
ralph --init-presets             # Write starter presets.json to .ralph/presets.json
ralph --version                  # Show version
ralph --help                     # Show help
```

### Passing Flags to the Agent

```bash
# Everything after -- is forwarded to the underlying agent process
ralph "Build API" -- --extra-agent-flag value
```

---

## Web Dashboard

`ralph dashboard` opens a full-featured dark web UI for launching loops, monitoring progress, and intervening mid-run — all without touching the terminal.

```bash
ralph dashboard               # Start on http://localhost:5000
ralph dashboard --port 8080   # Custom port
ralph dashboard --open        # Start and open in browser automatically
```

Run the dashboard in one terminal while the loop runs in another:

```bash
# Terminal 1 — run the loop
ralph "Build a REST API" --plan --max-iterations 30

# Terminal 2 — open the dashboard
ralph dashboard --open
```

### Launch page

Compose and fire off a ralph loop entirely from the browser — no CLI needed.

<img src="screenshots/dashboard-launch.png" alt="Dashboard Launch page" width="100%">

Every CLI option is available as a form control:

- **Prompt** — full task description textarea with a **✨ Enrich** button that expands a rough description into a detailed spec using the configured LLM
- **Agent & Model** — dropdown for all 6 agent types, model text input, Base URL field with **↓ Models** button that fetches available models directly from Ollama (or any OpenAI-compatible endpoint)
- **Rotation** — cycle through agent:model pairs each iteration
- **Iteration control** — max/min iterations, completion signal, abort signal, max prompt tokens
- **Modes** — `--plan`, `--tasks`, `--optimize`, `--diff` checkboxes
- **Options** — `--allow-all`, `--no-commit`, `--no-plugins`, `--no-stream`, `--verbose-tools`, `--no-questions`
- **Advanced** — preset name, project directory (with **📁 Browse** file explorer modal)
- **Stop Loop** — a red **⏹ Stop Loop** button appears in the warning banner when a loop is already running

### Status page

<img src="screenshots/dashboard-status.png" alt="Dashboard Status page" width="100%">

Shows the active loop state with live polling (auto-refreshes every 5 seconds while a loop is running):

- Current iteration, agent, model, base URL
- Elapsed time, started timestamp, completion signal
- Plan mode / tasks mode indicators
- **⏹ Stop Loop** button to terminate the running process (also available in the sidebar on every page)
- Per-iteration history: duration, completion ✓/✗, tools used

### Logs page

<img src="screenshots/dashboard-logs.png" alt="Dashboard Logs page" width="100%">

Detailed breakdown of the last 10 iterations — duration, agent/model, exit code, files modified, errors, and full tool usage JSON.

### Intervene page

<img src="screenshots/dashboard-intervene.png" alt="Dashboard Intervene page" width="100%">

Inject a plain-text context note that gets prepended to the next iteration's prompt, then cleared automatically. Useful for nudging the agent mid-task without stopping the loop.

### Other pages

| Route | Description |
|-------|-------------|
| `/plan` | Live markdown view of `IMPLEMENTATION_PLAN.md`, auto-refreshes every 3s when active |
| `/activity` | Parsed iteration timeline with task progress tracking, auto-updates every 3s when active |
| `/console` | Raw agent output log (last 200 lines), auto-updates every 2s when active |
| `/readme` | Full documentation rendered from the installed `README.md` |

---

## Plan Mode

`--plan` keeps the agent accountable across iterations via two files it maintains itself.

```bash
ralph "Build a full-stack app with auth and dashboard" --plan --max-iterations 50
```

**On the first iteration**, if neither file exists, the agent is instructed to create:
- `IMPLEMENTATION_PLAN.md` — structured plan with tasks, subtasks, and status markers
- `activity.md` — running log of what was done each iteration

**On every subsequent iteration**, ralph reads both files and injects them into the prompt. The agent is reminded to update task statuses and append a new activity log entry before and after making changes.

**In the dashboard:**
- `/plan` renders `IMPLEMENTATION_PLAN.md` with live markdown formatting, auto-refreshing every 3s
- `/activity` shows `activity.md` as a parsed iteration timeline with task progress tracking

---

## Git Self-Diagnosis

Always active — no flag needed.

Before each iteration, ralph runs `git log --oneline -10` and scans for commits containing:

```
TODO  FIXME  ERROR  FAIL  BROKEN  BUG  HACK
```

If any matching commits are found, a **"Recent Git Issues"** section is injected into the prompt, telling the agent to address those issues before advancing. This catches stale TODOs, failed test commits, and debugging hacks automatically.

---

## Tasks Mode

Tasks Mode breaks complex projects into a managed checklist.

```bash
ralph "Build a complete web application" --tasks --max-iterations 20

# Custom task completion signal
ralph "Multi-feature project" --tasks --task-promise "TASK_DONE"
```

#### Task Management

```bash
ralph --list-tasks                         # Show current tasks
ralph --add-task "Implement user auth"     # Add a task
ralph --remove-task 3                      # Remove task at index 3
ralph --status                             # Status shows tasks automatically in tasks mode
```

#### Task File Format (`.ralph/ralph-tasks.md`)

```markdown
# Ralph Tasks

- [x] Set up project structure
- [ ] Initialize database schema
- [/] Implement user authentication
  - [ ] Create login page
  - [ ] Add JWT handling
- [ ] Build dashboard UI
```

Status markers:
- `[ ]` — not started
- `[/]` — in progress
- `[x]` — complete

---

## Presets

Presets save frequently used prompt/config combos so you don't repeat long flags.

#### Create a presets file

```bash
ralph --init-presets
```

This writes a starter `.ralph/presets.json`. Edit it:

```json
{
  "version": "1.0",
  "defaults": {
    "agent": "claude-code",
    "maxIterations": 30
  },
  "presets": {
    "crud_api": {
      "prompt": "Build a FastAPI CRUD app for users with PostgreSQL. Run tests. Output <promise>COMPLETE</promise> when all tests pass.",
      "model": "claude-sonnet-4",
      "maxIterations": 25,
      "completionPromise": "COMPLETE"
    },
    "fix_tests": {
      "prompt": "Find and fix all failing tests. Do not change test definitions, only fix the implementation. Output <promise>COMPLETE</promise> when all tests pass.",
      "maxIterations": 15,
      "planMode": true
    }
  }
}
```

#### Use a preset

```bash
ralph --preset crud_api
ralph --preset fix_tests

# CLI flags always override preset values:
ralph --preset crud_api --max-iterations 5 --agent opencode
```

Presets are loaded from `.ralph/presets.json` first, then `~/.config/open-ralph-wiggum/presets.json`.

#### Preset fields

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | Task prompt |
| `agent` | string | Agent name |
| `model` | string | Model name |
| `baseUrl` | string | OpenAI-compatible API base URL |
| `maxIterations` | number | Max iterations |
| `minIterations` | number | Min iterations |
| `completionPromise` | string | Completion signal text |
| `planMode` | boolean | Enable plan mode |

---

## Custom Prompt Templates

Fully customize the prompt sent to the agent with `--prompt-template`:

```bash
ralph "Build a REST API" --prompt-template ./my-template.md
```

**Available variables:**

| Variable | Description |
|----------|-------------|
| `{{iteration}}` | Current iteration number |
| `{{max_iterations}}` | Max iterations (or "unlimited") |
| `{{min_iterations}}` | Min iterations |
| `{{prompt}}` | The user's task prompt |
| `{{completion_promise}}` | Completion promise text |
| `{{abort_promise}}` | Abort promise text (if set) |
| `{{task_promise}}` | Task promise text (for tasks mode) |
| `{{context}}` | Additional context added mid-loop |
| `{{tasks}}` | Task list content (for tasks mode) |

---

## Mid-Loop Context Injection

Guide a struggling agent without stopping the loop:

```bash
# In another terminal while the loop is running:
ralph --add-context "The bug is in utils/parser.ts line 42"
ralph --add-context "Try using the singleton pattern for config"

# Or use the dashboard /intervene page
ralph dashboard --open
```

Context is automatically consumed after one iteration.

---

## Writing Good Prompts

### Include Clear Success Criteria

❌ Bad:
```
Build a todo API
```

✅ Good:
```
Build a REST API for todos with:
- CRUD endpoints (GET, POST, PUT, DELETE)
- Input validation
- Tests for each endpoint

Run tests after changes. Output <promise>COMPLETE</promise> when all tests pass.
```

### Use Verifiable Conditions

❌ Bad: `Make the code better`

✅ Good:
```
Refactor auth.ts to:
1. Extract validation into separate functions
2. Add error handling for network failures
3. Ensure all existing tests still pass

Output <promise>DONE</promise> when refactored and tests pass.
```

### Always Set Max Iterations

```bash
ralph "Your task" --max-iterations 20   # Safety net for runaway loops
```

### Use a PRD File for Complex Tasks

```bash
ralph --prompt-file ./prd.md --max-iterations 30 --plan
```

Example `prd.md`:

```markdown
## Goal
Add CSV export to the dashboard.

## Requirements
1. "Export CSV" button in dashboard header
2. CSV includes: date, revenue, sessions columns
3. Works for reports up to 10k rows

## Acceptance Criteria
- Clicking button downloads a valid CSV
- CSV opens cleanly in Excel/Sheets
- All existing tests pass

<promise>COMPLETE</promise>
```

---

## Agent Rotation

Cycle through different agent/model pairs across iterations:

```bash
# Alternate between two agents
ralph "Build a REST API" \
  --rotation "opencode:claude-sonnet-4,claude-code:claude-sonnet-4" \
  --max-iterations 10

# Three-way rotation
ralph "Refactor the auth module" \
  --rotation "opencode:claude-sonnet-4,claude-code:claude-sonnet-4,codex:gpt-5-codex" \
  --max-iterations 15
```

Rotation cycles back to entry 1 after the last entry. The `--status` command shows which entry is currently active.

---

## Monitoring & Status

```
╔══════════════════════════════════════════════════════════════════╗
║                    Ralph Wiggum Status                           ║
╚══════════════════════════════════════════════════════════════════╝

🔄 ACTIVE LOOP
   Iteration:    3 / 20
   Elapsed:      5m 23s
   Promise:      COMPLETE
   Plan Mode:    ENABLED
   Prompt:       Build a REST API...

📊 HISTORY (3 iterations)
   Total time:   5m 23s

   Recent iterations:
   #1  2m 10s  claude-code / claude-sonnet-4  Bash(5) Write(3) Read(2)
   #2  1m 45s  claude-code / claude-sonnet-4  Edit(4) Bash(3) Read(2)
   #3  1m 28s  claude-code / claude-sonnet-4  Bash(2) Edit(1)

⚠️  STRUGGLE INDICATORS:
   - No file changes in 3 iterations
   💡 Consider: ralph --add-context "your hint here"
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────┐    prompt + context    ┌──────────┐             │
│   │          │ ─────────────────────▶ │          │             │
│   │  ralph   │                        │ AI Agent │             │
│   │   CLI    │ ◀───────────────────── │          │             │
│   │          │   output + file edits  │          │             │
│   └──────────┘                        └──────────┘             │
│        │                                   │                   │
│        │ scan git log                       │ modify            │
│        │ check promise                      │ files             │
│        ▼                                   ▼                   │
│   ┌──────────┐                        ┌──────────┐             │
│   │ Complete │                        │   Git    │             │
│   │   or     │                        │  Repo    │             │
│   │  Retry   │                        │ (state)  │             │
│   └──────────┘                        └──────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

1. Ralph sends your prompt (plus context, plan files, git issues) to the agent
2. The agent works on the task and modifies files
3. Ralph scans recent git commits for issue keywords
4. Ralph checks the output for the completion promise
5. If not found, repeat with the same prompt (agent sees its previous work in files)
6. Loop until the promise is detected or max iterations is reached

---

## Project Structure

```
ralph-wiggum/
├── bin/ralph.js          # CLI entrypoint (npm wrapper)
├── ralph.ts              # Main loop implementation (~3100 lines)
├── dashboard.ts          # Web dashboard (Bun HTTP server, ~3200 lines)
├── completion.ts         # Completion detection & git issue filtering helpers
├── llm-agent.ts          # Built-in LLM agent (OpenAI-compatible API, no extra CLI needed)
├── package.json
├── install.sh / install.ps1
└── uninstall.sh / uninstall.ps1
```

### State Files (in `.ralph/`)

| File | Description |
|------|-------------|
| `ralph-loop.state.json` | Active loop state (agent, iteration, prompt, flags) |
| `ralph-history.json` | Iteration history and metrics |
| `ralph-context.md` | Pending context note for next iteration |
| `ralph-tasks.md` | Task checklist (created by `--tasks` mode) |
| `presets.json` | Saved prompt/config presets |

### Plan Mode Files (in project root)

| File | Description |
|------|-------------|
| `IMPLEMENTATION_PLAN.md` | Structured plan maintained by the agent |
| `activity.md` | Running log of what happened each iteration |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RALPH_OPENCODE_BINARY` | `opencode` | Path to OpenCode CLI |
| `RALPH_CLAUDE_BINARY` | `claude` | Path to Claude Code CLI |
| `RALPH_CODEX_BINARY` | `codex` | Path to Codex CLI |
| `RALPH_COPILOT_BINARY` | `copilot` | Path to Copilot CLI |
| `RALPH_AIDER_BINARY` | `aider` | Path to Aider CLI |

**Windows note:** Ralph automatically tries `.cmd` extensions for npm-installed CLIs. If you get "command not found" errors, set the full path via these variables.

---

## Troubleshooting

### Plugin errors

This package is **CLI-only**. If OpenCode tries to load a `ralph-wiggum` plugin, remove it from your `opencode.json`, or run:

```bash
ralph "Your task" --no-plugins
```

### ProviderModelNotFoundError

Configure a default model in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "your-provider/model-name"
}
```

Or use `--model` explicitly: `ralph "task" --model provider/model`

### "command not found" on Windows

```powershell
$env:RALPH_CLAUDE_BINARY = "C:\path\to\claude.cmd"
```

### "bun: command not found"

Install Bun: https://bun.sh

---

## When to Use Ralph

**Good for:**
- Tasks with automatic verification (tests, linters, type checking)
- Well-defined tasks with clear completion criteria
- Greenfield projects where you can walk away
- Iterative refinement (getting a test suite to pass)
- Long-running projects tracked with `--plan` or `--tasks`

**Not good for:**
- Tasks requiring human judgment at each step
- One-shot operations (just use the agent directly)
- Unclear success criteria
- Production debugging with no tests

---

## Learn More

- [Original Ralph Wiggum technique by Geoffrey Huntley](https://ghuntley.com/ralph/)
- [Ralph Orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)
- [Was forked from](https://github.com/Th0rgal/open-ralph-wiggum)

## License

MIT
