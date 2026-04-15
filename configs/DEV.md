# Dev Toolkit — Usage Guide

`dev.ps1` (Windows) and `dev.sh` (Bash / WSL / Git Bash) are the single entry point for all day-to-day git and deployment workflow. No need to remember raw git commands — just run the script.

---

## Quick start

```powershell
# Windows — interactive menu, no flags needed
.\dev.ps1

# Bash / WSL / Git Bash
bash dev.sh
```

Both scripts show the same menu and behave identically.

---

## Interactive menu

```
  +==========================================+
  |   Summary Editor -- Dev Toolkit         |
  +==========================================+

  Branch  : feat/my-feature  · 2 changed
  Version : v0.4.1

  -- Workflow ------------------------------------------
  [1]  Sync with main            fetch + rebase
  [2]  New feature branch        from fresh main
  [3]  Stash changes             smart stash name
  [4]  Push branch
  [5]  Open Pull Request         via gh cli
  [6]  Push + open PR            both at once
  [c]  Commit + push             stage all, commit, push

  -- Build & Deploy ------------------------------------
  [7]  Deploy to SillyTavern     --clean

  -- Release -------------------------------------------
  [8]  Trigger release workflow   via gh (main only)
  [9]  Create manual tag          patch/minor/major

  -- Info ----------------------------------------------
  [s]  Status
  [l]  Log (last 10)
  [q]  Quit
```

---

## Non-interactive usage (`-Action` flag)

Pass `-Action <action>` to run a single operation and exit immediately — no menu, no prompts for that step.

### PowerShell syntax

```powershell
.\dev.ps1 -Action <action>
.\dev.ps1 -Action <action> -Message "your message"
.\dev.ps1 -Action <action> -NoRebase
```

### Bash syntax

```bash
bash dev.sh --action <action>
bash dev.sh --action <action> --message "your message"
bash dev.sh --action <action> --no-rebase
```

---

## All actions with examples

### `sync` — fetch + rebase onto main

Keeps your feature branch up to date with what's on `main` without switching branches.

```powershell
.\dev.ps1 -Action sync
```
```bash
bash dev.sh --action sync
```

> Uses rebase by default. Pass `-NoRebase` / `--no-rebase` to merge instead.

```powershell
.\dev.ps1 -Action sync -NoRebase
```

---

### `feature` — create a new feature branch

Detects uncommitted changes, offers to stash them, then pulls the latest `main` and creates the new branch from it.

```powershell
# Interactive — will prompt for branch name
.\dev.ps1 -Action feature
```

Recommended naming:

| Type | Example |
|------|---------|
| New feature | `feat/entity-sidebar` |
| Bug fix | `fix/panel-spawn-position` |
| Chore / tooling | `chore/update-ci` |
| Refactor | `refactor/split-module` |
| Docs | `docs/update-readme` |

---

### `stash` — smart stash with auto-generated name

Detects all changed files, prompts for a short description, and creates a stash named:

```
wip/<branch>/<YYYY-MM-DD>-<description>
```

**Example:**
```powershell
.\dev.ps1 -Action stash
# Prompt: Brief description: fix panel spawn
# Result stash name: wip/feat/entity-sidebar/2025-04-15-fix-panel-spawn
```

Pass `-Message` to skip the prompt:
```powershell
.\dev.ps1 -Action stash -Message "half-done entity filter"
```
```bash
bash dev.sh --action stash --message "half-done entity filter"
```

List your stashes anytime:
```bash
git stash list
```

Restore the latest stash:
```bash
git stash pop
```

Restore a specific stash by name:
```bash
git stash apply stash^{/wip/feat/entity-sidebar/2025-04-15-fix-panel-spawn}
```

---

### `push` — push current branch

Sets upstream tracking on first push. Blocked on `main` — use a PR instead.

```powershell
.\dev.ps1 -Action push
```

---

### `pr` — open a Pull Request via GitHub CLI

Requires [GitHub CLI (`gh`)](https://cli.github.com) to be installed and authenticated.
Pushes the branch first if it hasn't been pushed yet.

```powershell
.\dev.ps1 -Action pr
# Prompt: PR title [last commit message]:
```

> Tip: your PR title becomes the merge commit message on main, which drives semantic versioning. Use conventional commit format:
> - `feat: add entity sidebar` → minor bump
> - `fix: panel spawns at screen edge` → patch bump

---

### `push-pr` — push + open PR in one step

```powershell
.\dev.ps1 -Action push-pr
```
```bash
bash dev.sh --action push-pr
```

---

### `commit` — stage all + commit (prompts for message)

```powershell
.\dev.ps1 -Action commit
# Prompt: Commit message: fix: panel spawn position
```

Pass `-Message` to skip the prompt:
```powershell
.\dev.ps1 -Action commit -Message "fix: panel spawn position"
```
```bash
bash dev.sh --action commit --message "fix: panel spawn position"
```

---

### `commit-push` — stage all + commit + push

The most common daily action. Commits everything staged and pushes to your current feature branch.

```powershell
.\dev.ps1 -Action commit-push
# Prompt: Commit message: feat: add named entity filter
```

With message:
```powershell
.\dev.ps1 -Action commit-push -Message "feat: add named entity filter"
```
```bash
bash dev.sh --action commit-push --message "feat: add named entity filter"
```

---

### `commit-push-pr` — stage all + commit + push + open PR

Full flow in one command. Ideal for small self-contained fixes.

```powershell
.\dev.ps1 -Action commit-push-pr -Message "fix: correct stash name encoding"
```

---

### `deploy` — deploy to local SillyTavern

Runs `deploy.ps1 --clean` (deletes the target folder and re-copies everything).

```powershell
.\dev.ps1 -Action deploy
```
```bash
bash dev.sh --action deploy
```

> Make sure `$ST_EXTENSIONS_DIR` is set in `deploy.ps1` / `deploy.sh` before running.

---

### `release-trigger` — trigger the release workflow on main

Manually kicks off the `release.yml` GitHub Actions workflow on `main`. Useful if you want to force a release without waiting for a push event.

Requires `gh` CLI authenticated.

```powershell
.\dev.ps1 -Action release-trigger
```

---

### `tag` — create and push a manual version tag

Interactive patch / minor / major bump with confirmation.

```powershell
.\dev.ps1 -Action tag
```

```
  Current version: v0.4.1
  Bump type:
    [1] patch   v0.4.2
    [2] minor   v0.5.0
    [3] major   v1.0.0
    [4] custom
  Choice [1]: 2
  Create and push tag v0.5.0? [Y/n]: y
  ✔ Tag v0.5.0 pushed.
```

> Note: semantic-release auto-creates tags on every merge to `main` based on commit messages. Use manual tags only for special promotions or hotfixes.

---

### `status` — git status + recent stashes

```powershell
.\dev.ps1 -Action status
```

---

### `log` — last 10 commits, graph view

```powershell
.\dev.ps1 -Action log
```

---

## Typical daily workflow

### Starting a new feature

```powershell
.\dev.ps1 -Action sync          # make sure you're up to date
.\dev.ps1 -Action feature       # create feat/my-feature from main
# ... make changes ...
.\dev.ps1 -Action deploy        # test in SillyTavern
.\dev.ps1 -Action commit-push-pr -Message "feat: my new feature"
# merge PR on GitHub → release.yml auto-tags
```

### Mid-feature checkpoint (push without PR)

```powershell
.\dev.ps1 -Action commit-push -Message "wip: half-done entity filter"
```

### Interrupted — need to switch context

```powershell
.\dev.ps1 -Action stash -Message "mid-refactor table render"
# switch to other branch, do work, come back
git stash pop
```

### Quick bug fix on existing branch

```powershell
.\dev.ps1 -Action sync          # rebase onto latest main
# ... fix the bug ...
.\dev.ps1 -Action deploy        # verify fix
.\dev.ps1 -Action commit-push -Message "fix: panel not closing on escape"
```

---

## Commit message conventions

semantic-release reads your commit messages and auto-increments the version on every merge to `main`:

| Prefix | What it does | Version bump |
|--------|-------------|-------------|
| `feat: description` | New user-facing feature | Minor `0.X.0` |
| `fix: description` | Bug fix | Patch `0.0.X` |
| `feat!: description` | Breaking change | Major `X.0.0` |
| `refactor: description` | Code cleanup, no new behaviour | None |
| `chore: description` | Tooling, deps, config | None |
| `docs: description` | Documentation only | None |
| `style: description` | Formatting, whitespace | None |

**Examples:**
```
feat: add named entity sidebar with entry-count badges
fix: panels now spawn centered instead of at screen edge
feat!: ingest format changed — re-import required
chore: update ESLint globals for iro and mermaid
docs: add dev toolkit usage guide
refactor: consolidate panel spawn into spawnPanel helper
```

> The PR title is what ends up as the merge commit — make it count.

---

## Requirements

| Tool | Required for | Install |
|------|-------------|---------|
| Git | Everything | [git-scm.com](https://git-scm.com) |
| Node.js 18+ | `npm run lint`, CI | [nodejs.org](https://nodejs.org) |
| GitHub CLI (`gh`) | PR creation, release trigger | [cli.github.com](https://cli.github.com) |
| PowerShell 5.1+ | `dev.ps1` | Built into Windows |

Authenticate `gh` once:
```bash
gh auth login
```
