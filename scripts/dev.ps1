#Requires -Version 5.1
<#
.SYNOPSIS
    Summary Editor development toolkit.
.DESCRIPTION
    Run with no arguments for the interactive menu.
    Use -Action for non-interactive / scripted use.
.PARAMETER Action
    Non-interactive action: sync | feature | stash | push | pr | push-pr |
                            commit | commit-push | commit-push-pr | deploy |
                            release-trigger | status | log
.PARAMETER Message
    Commit message or stash description (used with commit/stash actions).
.PARAMETER NoRebase
    Use merge instead of rebase when syncing with main.
.EXAMPLE
    .\dev.ps1 -Action commit-push -Message "fix: artifact name slash"
    .\dev.ps1 -Action deploy
    .\dev.ps1          # opens interactive menu
#>
param(
    [string]$Action   = '',
    [string]$Message  = '',
    [switch]$NoRebase
)

$MAIN_BRANCH   = 'main'
$REMOTE        = 'origin'
$DEPLOY_SCRIPT = Join-Path $PSScriptRoot 'deploy.ps1'

# ── Colour helpers ────────────────────────────────────────────
function ok($t)   { Write-Host "  `u{2714} $t" -ForegroundColor Green  }
function warn($t) { Write-Host "  `u{26A0} $t" -ForegroundColor Yellow }
function err($t)  { Write-Host "  `u{2716} $t" -ForegroundColor Red    }
function info($t) { Write-Host "  . $t"        -ForegroundColor Cyan   }

# ── Git helpers ───────────────────────────────────────────────
function Get-Branch  { (git rev-parse --abbrev-ref HEAD 2>$null).Trim() }
function Get-Version { (Get-Content manifest.json | ConvertFrom-Json).version }

function Get-StatusLine {
    $changed = (git status --short 2>$null | Measure-Object -Line).Lines
    $ahead = $behind = 0
    $rev = git rev-list --left-right --count "$REMOTE/$MAIN_BRANCH...HEAD" 2>$null
    if ($rev) { $parts = $rev -split '\s+'; $behind = [int]$parts[0]; $ahead = [int]$parts[1] }
    $s = ''
    if ($changed -gt 0) { $s += " · $changed changed" }
    if ($ahead   -gt 0) { $s += " · up $ahead"        }
    if ($behind  -gt 0) { $s += " · behind $behind"   }
    if (!$s)            { $s  = ' · clean'             }
    return $s
}

# ── Menu ──────────────────────────────────────────────────────
function Show-Menu {
    $branch  = Get-Branch
    $status  = Get-StatusLine
    $version = Get-Version
    Clear-Host
    Write-Host ''
    Write-Host '  +==========================================+' -ForegroundColor DarkCyan
    Write-Host '  |   Summary Editor -- Dev Toolkit         |' -ForegroundColor Cyan
    Write-Host '  +==========================================+' -ForegroundColor DarkCyan
    Write-Host ''
    Write-Host "  Branch  : " -NoNewline -ForegroundColor DarkGray
    Write-Host $branch -NoNewline -ForegroundColor Yellow
    Write-Host $status -ForegroundColor DarkGray
    Write-Host "  Version : v$version" -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  -- Workflow ------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  [1]  Sync with main            fetch + rebase'
    Write-Host '  [2]  New feature branch        from fresh main'
    Write-Host '  [3]  Stash changes             smart stash name'
    Write-Host '  [4]  Push branch'
    Write-Host '  [5]  Open Pull Request         via gh cli'
    Write-Host '  [6]  Push + open PR            both at once'
    Write-Host '  [c]  Commit + push             stage all, commit, push'
    Write-Host ''
    Write-Host '  -- Build & Deploy -----------------------------------' -ForegroundColor DarkGray
    Write-Host '  [7]  Deploy to SillyTavern     --clean'
    Write-Host ''
    Write-Host '  -- Release ------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  [8]  Trigger release workflow   via gh (main only)'
    Write-Host '  [9]  Create manual tag          patch/minor/major'
    Write-Host ''
    Write-Host '  -- Info ---------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  [s]  Status'
    Write-Host '  [l]  Log (last 10)'
    Write-Host '  [q]  Quit'
    Write-Host ''
}

# ── Actions ───────────────────────────────────────────────────
function Invoke-SmartStash {
    $branch  = Get-Branch
    $changed = git status --short 2>$null
    if (!$changed) { warn 'Nothing to stash.'; return }

    Write-Host '  Changed files:' -ForegroundColor DarkGray
    $changed | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ''

    $desc = $script:Message
    if (!$desc) { $desc = (Read-Host '  Brief description (e.g. "fix panel spawn")').Trim() }
    if (!$desc) { $desc = 'wip' }

    $safeBranch = ($branch -replace '[^a-zA-Z0-9]', '-') -replace '-+', '-'
    $safeDesc   = ($desc   -replace '[^a-zA-Z0-9]', '-') -replace '-+', '-' -replace '^-|-$', ''
    $date       = Get-Date -Format 'yyyy-MM-dd'
    $stashName  = "wip/$safeBranch/$date-$safeDesc"

    git stash push -m $stashName
    ok "Stashed as: $stashName"
}

function Invoke-SyncWithMain {
    info "Fetching $REMOTE..."
    git fetch $REMOTE
    $branch = Get-Branch
    if ($script:NoRebase) {
        info "Merging $REMOTE/$MAIN_BRANCH into $branch..."
        git merge "$REMOTE/$MAIN_BRANCH"
    } else {
        info "Rebasing $branch onto $REMOTE/$MAIN_BRANCH..."
        git rebase "$REMOTE/$MAIN_BRANCH"
    }
    if ($LASTEXITCODE -eq 0) { ok 'Synced.' } else { err 'Conflict — resolve then continue rebase.' }
}

function Invoke-NewFeatureBranch {
    $changed = git status --short 2>$null
    if ($changed) {
        warn 'Uncommitted changes detected.'
        $c = (Read-Host '  Stash them first? [Y/n]').Trim().ToLower()
        if ($c -ne 'n') { Invoke-SmartStash }
    }
    info "Fetching latest $MAIN_BRANCH..."
    git fetch $REMOTE $MAIN_BRANCH

    $name = (Read-Host '  Branch name (e.g. feat/entity-sidebar or fix/panel-spawn)').Trim()
    if (!$name) { warn 'Cancelled.'; return }

    git checkout -b $name "$REMOTE/$MAIN_BRANCH"
    if ($LASTEXITCODE -eq 0) { ok "Branch '$name' created from $REMOTE/$MAIN_BRANCH." }
    else { err 'Failed to create branch.' }
}

function Invoke-PushBranch {
    $branch = Get-Branch
    if ($branch -eq $MAIN_BRANCH) { err "Direct push to '$MAIN_BRANCH' is blocked — use a PR."; return }
    git push -u $REMOTE $branch
    if ($LASTEXITCODE -eq 0) { ok "Pushed '$branch'." } else { err 'Push failed.' }
}

function Invoke-OpenPR {
    $branch = Get-Branch
    if ($branch -eq $MAIN_BRANCH) { err 'Not on a feature branch.'; return }

    $remoteExists = git rev-parse --verify "$REMOTE/$branch" 2>$null
    if (!$remoteExists) { info 'Not pushed yet — pushing first...'; git push -u $REMOTE $branch }

    $defaultTitle = (git log -1 --format='%s' 2>$null).Trim()
    $title = (Read-Host "  PR title [$defaultTitle]").Trim()
    if (!$title) { $title = $defaultTitle }

    $patFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'key.pat'
    if (!(Test-Path $patFile)) { err 'key.pat not found — cannot create PR via API.'; return }
    $token = (Get-Content $patFile).Trim()

    $repoUrl   = (git remote get-url origin 2>$null) -replace '\.git$', ''
    $repoPath  = $repoUrl -replace 'https://github.com/', ''

    $payload = @{ title = $title; head = $branch; base = $MAIN_BRANCH; body = '' } | ConvertTo-Json
    try {
        $resp = Invoke-RestMethod `
            -Uri "https://api.github.com/repos/$repoPath/pulls" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' } `
            -Body $payload `
            -ContentType 'application/json'
        ok "PR created: $($resp.html_url)"
    } catch {
        err "PR creation failed: $_"
    }
}

function Invoke-PushAndPR { Invoke-PushBranch; if ($LASTEXITCODE -eq 0) { Invoke-OpenPR } }

function Invoke-Commit {
    $changed = git status --short 2>$null
    if (!$changed) { warn 'Nothing to commit.'; return }

    $msg = $script:Message
    if (!$msg) { $msg = (Read-Host '  Commit message').Trim() }
    if (!$msg) { warn 'Cancelled — message required.'; return }

    git add -A
    git commit -m $msg
    if ($LASTEXITCODE -eq 0) { ok "Committed: $msg" } else { err 'Commit failed.' }
}

function Invoke-CommitAndPush {
    Invoke-Commit
    if ($LASTEXITCODE -eq 0) { Invoke-PushBranch }
}

function Invoke-CommitPushPR {
    Invoke-Commit
    if ($LASTEXITCODE -eq 0) { Invoke-PushAndPR }
}

function Invoke-Deploy {
    if (!(Test-Path $DEPLOY_SCRIPT)) { err 'deploy.ps1 not found.'; return }
    powershell -ExecutionPolicy Bypass -File $DEPLOY_SCRIPT --clean
}

function Invoke-TriggerRelease {
    $patFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'key.pat'
    if (!(Test-Path $patFile)) { err 'key.pat not found — cannot trigger workflow via API.'; return }
    $token    = (Get-Content $patFile).Trim()
    $repoUrl  = (git remote get-url origin 2>$null) -replace '\.git$', ''
    $repoPath = $repoUrl -replace 'https://github.com/', ''

    $payload = @{ ref = $MAIN_BRANCH } | ConvertTo-Json
    try {
        Invoke-RestMethod `
            -Uri "https://api.github.com/repos/$repoPath/actions/workflows/release.yml/dispatches" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' } `
            -Body $payload `
            -ContentType 'application/json' | Out-Null
        ok "Release workflow triggered on $MAIN_BRANCH."
    } catch {
        err "Failed to trigger workflow: $_"
    }
}

function Invoke-CreateTag {
    $current = Get-Version
    info "Current version: v$current"
    $p = $current.Split('.')
    $maj = [int]$p[0]; $min = [int]$p[1]; $pat = [int]$p[2]

    Write-Host "  Bump type:" -ForegroundColor DarkGray
    Write-Host "    [1] patch   v$maj.$min.$($pat+1)"
    Write-Host "    [2] minor   v$maj.$($min+1).0"
    Write-Host "    [3] major   v$($maj+1).0.0"
    Write-Host "    [4] custom"
    $bump = (Read-Host '  Choice [1]').Trim()

    $next = switch ($bump) {
        '2' { "$maj.$($min+1).0" }
        '3' { "$($maj+1).0.0"   }
        '4' { (Read-Host '  Version (x.y.z)').Trim() }
        default { "$maj.$min.$($pat+1)" }
    }
    if (!$next) { warn 'Cancelled.'; return }

    $tag = "v$next"
    $c = (Read-Host "  Create and push tag $tag? [Y/n]").Trim().ToLower()
    if ($c -eq 'n') { warn 'Cancelled.'; return }

    git tag -a $tag -m "Release $tag"
    git push $REMOTE $tag
    if ($LASTEXITCODE -eq 0) { ok "Tag $tag pushed." } else { err 'Tag push failed.' }
}

function Show-Status {
    git status
    Write-Host ''
    info 'Recent stashes:'
    git stash list --format='%gd: %gs' 2>$null | Select-Object -First 5 |
        ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

# ── Dispatch table (shared by -Action and menu) ───────────────
function Invoke-Action($a) {
    switch ($a) {
        'sync'            { Invoke-SyncWithMain     }
        'feature'         { Invoke-NewFeatureBranch }
        'stash'           { Invoke-SmartStash       }
        'push'            { Invoke-PushBranch       }
        'pr'              { Invoke-OpenPR           }
        'push-pr'         { Invoke-PushAndPR        }
        'commit'          { Invoke-Commit           }
        'commit-push'     { Invoke-CommitAndPush    }
        'commit-push-pr'  { Invoke-CommitPushPR     }
        'deploy'          { Invoke-Deploy           }
        'release-trigger' { Invoke-TriggerRelease   }
        'tag'             { Invoke-CreateTag        }
        'status'          { Show-Status             }
        'log'             { git log --oneline --graph --decorate -10 }
        default           { warn "Unknown action: $a" }
    }
}

# ── Entry point ───────────────────────────────────────────────
if ($Action) {
    # Non-interactive: run the action and exit
    Invoke-Action $Action.ToLower()
    exit $LASTEXITCODE
}

# Interactive menu loop
while ($true) {
    Show-Menu
    $choice = (Read-Host '  Choice').Trim().ToLower()
    Write-Host ''
    switch ($choice) {
        '1' { Invoke-Action 'sync'    }
        '2' { Invoke-Action 'feature' }
        '3' { Invoke-Action 'stash'   }
        '4' { Invoke-Action 'push'    }
        '5' { Invoke-Action 'pr'      }
        '6' { Invoke-Action 'push-pr' }
        '7' { Invoke-Action 'deploy'  }
        '8' { Invoke-Action 'release-trigger' }
        '9' { Invoke-Action 'tag'     }
        'c' { Invoke-Action 'commit-push' }
        's' { Invoke-Action 'status'  }
        'l' { Invoke-Action 'log'     }
        'q' { Write-Host ''; exit 0  }
        default { warn "Unknown option: $choice" }
    }
    Write-Host ''
    Read-Host '  Press Enter to continue' | Out-Null
}
