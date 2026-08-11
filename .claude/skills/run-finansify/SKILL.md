---
name: run-finansify
description: Build, run, and drive the Finansify web app (apps/web, a Next.js 16/Turbopack app). Use when asked to start Finansify, run its dev server, take a screenshot of its UI, check that a UI change actually renders, or drive the app headlessly.
---

Finansify is a single Next.js app (`apps/web`) in a pnpm/Turborepo monorepo.
There is no `chromium-cli` in this environment, so the driver here is a small
Playwright REPL (`driver.mjs`) that launches its own headless Chromium and
talks to the dev server. All paths below are relative to the repo root.

## Prerequisites

Node **24+** (the repo's stated `engines.node`). This container ships nvm
with only 20 and 22 preinstalled — pull 24 explicitly:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm install 24 && nvm use 24
corepack enable
corepack prepare pnpm@10.18.2 --activate
```

## Setup

```bash
pnpm install                                    # workspace deps, from repo root
cd .claude/skills/run-finansify && npm install   # driver's own deps (Playwright)
```

The driver is a standalone `npm` project deliberately kept out of the pnpm
workspace (`pnpm-workspace.yaml` only globs `apps/*` and `packages/*`, so it's
invisible to `pnpm install`, `turbo`, and CI). Its `node_modules` is covered
by the repo's blanket `node_modules/` gitignore rule.

The Playwright **browser binary** was already cached in this container
(`~/.cache/ms-playwright`), so `npm install` alone was enough to get a working
`chromium.launch()`. On a genuinely clean machine, run once:

```bash
npx playwright install chromium
```

## Build

No separate build for local driving — `next dev` compiles routes on demand.
(`pnpm build` works too, for a production check, but the driver targets the
dev server.)

## Run (agent path)

```bash
# 1. start the dev server, from repo root
nohup pnpm dev > /tmp/finansify-dev.log 2>&1 &
disown
timeout 30 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'

# 2. drive it — pipe a script to the driver, from repo root
cd .claude/skills/run-finansify
node driver.mjs <<'EOF'
launch
nav /
wait h1
ss 01-landing
resize 375,812
ss 02-landing-mobile
console-errors
quit
EOF
```

The driver reads commands from stdin one at a time (`for await` over
readline, not a bare event listener — see the comment in `driver.mjs` for why
that distinction matters: a naive listener races ahead of `launch` when fed a
whole piped script at once). That means the exact heredoc above is also how
you script it non-interactively; no tmux required for a scripted run.

**For iterative/interactive driving**, wrap it in tmux instead and send one
command at a time:

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'cd .claude/skills/run-finansify && node driver.mjs' Enter
timeout 15 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t app 'launch' Enter
timeout 15 bash -c 'until tmux capture-pane -t app -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t app 'nav /' Enter
tmux send-keys -t app 'ss check' Enter
tmux capture-pane -t app -p
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`). Target URL
defaults to `http://localhost:3000` (override: `BASE_URL`).

### Commands

| command                       | what it does                                                          |
| ----------------------------- | --------------------------------------------------------------------- |
| `launch`                      | launch headless Chromium, open a page, start capturing console errors |
| `nav <path\|url>`             | navigate — a bare path is resolved against `BASE_URL`                 |
| `ss [name]`                   | screenshot → `/tmp/shots/<name>.png`                                  |
| `resize <w,h>`                | set viewport, e.g. `resize 375,812` for iPhone 13 mini                |
| `click <css-sel>`             | click via DOM `.click()`, not coordinates                             |
| `click-text <text>`           | click the first `button`/`a`/`[role=button]` matching that text       |
| `type <text>` / `press <key>` | keyboard input                                                        |
| `wait <css-sel>`              | wait up to 10s for a selector                                         |
| `eval <js>`                   | evaluate an expression in the page, print JSON                        |
| `text [css-sel]`              | print `innerText` of a selector (or `body`)                           |
| `console-errors`              | print console errors / page errors seen since `launch`                |
| `quit`                        | close the browser, exit                                               |

### Stop the dev server

```bash
fuser -k 3000/tcp
```

**Not** `lsof -ti:3000 -sTCP:LISTEN | xargs kill` — see Gotchas.

## Run (human path)

```bash
pnpm dev   # → http://localhost:3000, Ctrl-C to stop
```

## Test

```bash
pnpm check   # build, lint, typecheck, test, format — see /ship
```

There is no UI to click through beyond the default `create-next-app` landing
page yet (Phase 0 of `docs/roadmap.md` — the app is proving the workspace/build
wiring, not shipping features). As real routes land, extend this driver with
the flow-specific commands the app actually needs (e.g. a `login` helper once
Clerk auth exists) rather than regenerating it from scratch.

## Gotchas

- **`lsof -ti:3000 -sTCP:LISTEN | xargs kill` did not stop the server** in
  this environment. Next 16 + Turbopack runs as a small process tree (`pnpm`
  wrapper → `next dev` → `next-server` → a turbopack worker), and `lsof`'s
  port/LISTEN filter didn't reliably map back to the right PID here.
  `fuser -k 3000/tcp` kills whatever actually holds the socket and worked
  every time.
- **`rl.on('line', async ...)` is not safe for scripted (piped) input.** A
  heredoc delivers the whole script as one stdin chunk; Node's readline emits
  every `'line'` event for that chunk synchronously, before the first
  command's promise (e.g. `launch`'s `chromium.launch()`) has resolved —
  `rl.pause()`/`resume()` does not stop this, because the multi-line emission
  loop for one chunk doesn't check pause state between lines. The fix is
  `for await (const line of rl)`, which genuinely awaits each command before
  reading the next line, whether the input is a human typing in tmux or a
  heredoc arriving all at once.
- **`rl.prompt()` after the input stream hits EOF throws
  `ERR_USE_AFTER_CLOSE`.** A piped heredoc closes stdin as soon as it's fully
  delivered, which can happen while the loop is still awaiting the last
  command. The prompt call after each command is wrapped in try/catch for
  exactly this case.
- **Node 24 isn't preinstalled** even though the repo requires it — this
  container's nvm only had 20 and 22 until `nvm install 24` pulled it
  (network access worked fine; the README-level assumption that it's already
  there did not hold).
- **No `chromium-cli` binary in this environment**, despite Playwright's npm
  package and its Chromium browser binary both being pre-cached
  (`~/.npm/_npx/*/node_modules/playwright`, `~/.cache/ms-playwright`). The
  driver here is a from-scratch `chromium.launch()` REPL rather than
  `chromium-cli`, per the fallback in the skill-authoring guide.

## Troubleshooting

- **`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL ... Command "prettier"/"playwright"
not found`** running `pnpm exec <tool>`: the shell's `corepack`/`pnpm`
  activation from a previous command doesn't persist — each new shell needs
  `corepack enable && corepack prepare pnpm@10.18.2 --activate` run again
  before `pnpm exec` will resolve anything.
- **`curl` never succeeds against `localhost:3000`:** check
  `/tmp/finansify-dev.log` — a cold Turbopack start is well under 1s once
  deps are installed, so a long hang there usually means `pnpm install`
  didn't actually finish, not that the server is slow.
