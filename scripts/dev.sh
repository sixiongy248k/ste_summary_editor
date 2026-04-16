#!/usr/bin/env bash
# dev.sh — Summary Editor development toolkit (Bash / WSL / Git Bash)
#
# Interactive:        bash dev.sh
# Non-interactive:    bash dev.sh --action <action> [--message "msg"] [--no-rebase]
#
# Actions: sync | feature | stash | push | pr | push-pr |
#          commit | commit-push | commit-push-pr | deploy |
#          release-trigger | tag | status | log
set -euo pipefail

MAIN_BRANCH='main'
REMOTE='origin'
DEPLOY_SCRIPT="$(dirname "$0")/deploy.sh"
NO_REBASE=false
ACTION=''
MESSAGE=''

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-rebase)      NO_REBASE=true; shift ;;
        --action|-a)      ACTION="${2:-}"; shift 2 ;;
        --message|-m)     MESSAGE="${2:-}"; shift 2 ;;
        *) shift ;;
    esac
done

# ── Colour helpers ────────────────────────────────────────────
GRN='\033[0;32m' YLW='\033[1;33m' RED='\033[0;31m' CYN='\033[0;36m' GRY='\033[0;90m' NC='\033[0m'
ok()   { echo -e "  ${GRN}✔${NC} $1"; }
warn() { echo -e "  ${YLW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✖${NC} $1"; }
info() { echo -e "  ${CYN}.${NC} $1"; }

# ── Git helpers ───────────────────────────────────────────────
get_branch()  { git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown'; }
get_version() { node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)" 2>/dev/null || echo '?'; }

get_status_line() {
    local changed; changed=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
    local s=''; [[ "$changed" -gt 0 ]] && s=" · ${changed} changed" || s=' · clean'
    echo "$s"
}

# ── Menu ──────────────────────────────────────────────────────
show_menu() {
    local branch; branch=$(get_branch)
    local version; version=$(get_version)
    local status; status=$(get_status_line)
    clear
    echo ''
    echo -e "  ${CYN}+==========================================+${NC}"
    echo -e "  ${CYN}|   Summary Editor -- Dev Toolkit         |${NC}"
    echo -e "  ${CYN}+==========================================+${NC}"
    echo ''
    echo -e "  ${GRY}Branch  :${NC} ${YLW}${branch}${NC}${GRY}${status}${NC}"
    echo -e "  ${GRY}Version : v${version}${NC}"
    echo ''
    echo -e "  ${GRY}-- Workflow ------------------------------------------${NC}"
    echo    '  [1]  Sync with main            fetch + rebase'
    echo    '  [2]  New feature branch        from fresh main'
    echo    '  [3]  Stash changes             smart stash name'
    echo    '  [4]  Push branch'
    echo    '  [5]  Open Pull Request         via gh cli'
    echo    '  [6]  Push + open PR            both at once'
    echo    '  [c]  Commit + push             stage all, commit, push'
    echo ''
    echo -e "  ${GRY}-- Build & Deploy ------------------------------------${NC}"
    echo    '  [7]  Deploy to SillyTavern     --clean'
    echo ''
    echo -e "  ${GRY}-- Release -------------------------------------------${NC}"
    echo    '  [8]  Trigger release workflow   via gh (main only)'
    echo    '  [9]  Create manual tag          patch/minor/major'
    echo ''
    echo -e "  ${GRY}-- Info ----------------------------------------------${NC}"
    echo    '  [s]  Status'
    echo    '  [l]  Log (last 10)'
    echo    '  [q]  Quit'
    echo ''
}

# ── Actions ───────────────────────────────────────────────────
smart_stash() {
    local branch; branch=$(get_branch)
    local changed; changed=$(git status --short 2>/dev/null)
    if [[ -z "$changed" ]]; then warn 'Nothing to stash.'; return; fi

    echo -e "  ${GRY}Changed files:${NC}"
    echo "$changed" | while IFS= read -r line; do echo -e "    ${GRY}${line}${NC}"; done
    echo ''

    read -rp '  Brief description (e.g. "fix panel spawn"): ' desc
    [[ -z "$desc" ]] && desc='wip'

    local safe_branch; safe_branch=$(echo "$branch" | tr -cs '[:alnum:]-' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')
    local safe_desc;   safe_desc=$(echo "$desc"     | tr -cs '[:alnum:]-' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')
    local date; date=$(date +%Y-%m-%d)
    local stash_name="wip/${safe_branch}/${date}-${safe_desc}"

    git stash push -m "$stash_name"
    ok "Stashed as: $stash_name"
}

sync_with_main() {
    info "Fetching $REMOTE..."
    git fetch "$REMOTE"
    local branch; branch=$(get_branch)
    if $NO_REBASE; then
        info "Merging $REMOTE/$MAIN_BRANCH into $branch..."
        git merge "$REMOTE/$MAIN_BRANCH"
    else
        info "Rebasing $branch onto $REMOTE/$MAIN_BRANCH..."
        git rebase "$REMOTE/$MAIN_BRANCH"
    fi
    ok 'Synced.'
}

new_feature_branch() {
    local changed; changed=$(git status --short 2>/dev/null)
    if [[ -n "$changed" ]]; then
        warn 'Uncommitted changes detected.'
        read -rp '  Stash them first? [Y/n]: ' c
        [[ "${c,,}" != 'n' ]] && smart_stash
    fi
    info "Fetching latest $MAIN_BRANCH..."
    git fetch "$REMOTE" "$MAIN_BRANCH"

    read -rp '  Branch name (e.g. feat/entity-sidebar): ' name
    [[ -z "$name" ]] && warn 'Cancelled.' && return

    git checkout -b "$name" "$REMOTE/$MAIN_BRANCH"
    ok "Branch '$name' created from $REMOTE/$MAIN_BRANCH."
}

push_branch() {
    local branch; branch=$(get_branch)
    if [[ "$branch" == "$MAIN_BRANCH" ]]; then err "Direct push to '$MAIN_BRANCH' is blocked — use a PR."; return; fi
    git push -u "$REMOTE" "$branch"
    ok "Pushed '$branch'."
}

open_pr() {
    local branch; branch=$(get_branch)
    [[ "$branch" == "$MAIN_BRANCH" ]] && err 'Not on a feature branch.' && return
    if ! command -v gh &>/dev/null; then
        err 'GitHub CLI not found — install from https://cli.github.com'; return
    fi
    if ! git rev-parse --verify "$REMOTE/$branch" &>/dev/null 2>&1; then
        info 'Not pushed yet — pushing first...'; git push -u "$REMOTE" "$branch"
    fi
    local default_title; default_title=$(git log -1 --format='%s' 2>/dev/null)
    read -rp "  PR title [$default_title]: " title
    [[ -z "$title" ]] && title="$default_title"
    gh pr create --title "$title" --fill --base "$MAIN_BRANCH"
    ok 'PR created.'
}

push_and_pr() { push_branch && open_pr; }

do_commit() {
    local changed; changed=$(git status --short 2>/dev/null)
    if [[ -z "$changed" ]]; then warn 'Nothing to commit.'; return; fi
    local msg="$MESSAGE"
    if [[ -z "$msg" ]]; then read -rp '  Commit message: ' msg; fi
    [[ -z "$msg" ]] && warn 'Cancelled — message required.' && return
    git add -A
    git commit -m "$msg"
    ok "Committed: $msg"
}

commit_push()    { do_commit && push_branch; }
commit_push_pr() { do_commit && push_and_pr; }

deploy() {
    if [[ ! -f "$DEPLOY_SCRIPT" ]]; then err 'deploy.sh not found.'; return; fi
    bash "$DEPLOY_SCRIPT" --clean
}

trigger_release() {
    if ! command -v gh &>/dev/null; then err 'GitHub CLI not found.'; return; fi
    gh workflow run release.yml --ref "$MAIN_BRANCH"
    ok "Release workflow triggered on $MAIN_BRANCH."
}

create_tag() {
    local current; current=$(get_version)
    info "Current version: v$current"
    IFS='.' read -r maj min pat <<< "$current"
    echo    '  Bump type:'
    echo    "    [1] patch   v${maj}.${min}.$((pat+1))"
    echo    "    [2] minor   v${maj}.$((min+1)).0"
    echo    "    [3] major   v$((maj+1)).0.0"
    echo    '    [4] custom'
    read -rp '  Choice [1]: ' bump
    case "$bump" in
        2) next="${maj}.$((min+1)).0"  ;;
        3) next="$((maj+1)).0.0"       ;;
        4) read -rp '  Version (x.y.z): ' next ;;
        *) next="${maj}.${min}.$((pat+1))" ;;
    esac
    [[ -z "$next" ]] && warn 'Cancelled.' && return
    read -rp "  Create and push tag v${next}? [Y/n]: " c
    [[ "${c,,}" == 'n' ]] && warn 'Cancelled.' && return
    git tag -a "v$next" -m "Release v$next"
    git push "$REMOTE" "v$next"
    ok "Tag v$next pushed."
}

show_status() {
    git status
    echo ''
    info 'Recent stashes:'
    git stash list --format='%gd: %gs' 2>/dev/null | head -5 | while IFS= read -r line; do
        echo -e "    ${GRY}${line}${NC}"
    done
}

# ── Dispatch ──────────────────────────────────────────────────
run_action() {
    case "$1" in
        sync)            sync_with_main      ;;
        feature)         new_feature_branch  ;;
        stash)           smart_stash         ;;
        push)            push_branch         ;;
        pr)              open_pr             ;;
        push-pr)         push_and_pr         ;;
        commit)          do_commit           ;;
        commit-push)     commit_push         ;;
        commit-push-pr)  commit_push_pr      ;;
        deploy)          deploy              ;;
        release-trigger) trigger_release     ;;
        tag)             create_tag          ;;
        status)          show_status         ;;
        log)             git log --oneline --graph --decorate -10 ;;
        *) warn "Unknown action: $1" ;;
    esac
}

# ── Entry point ───────────────────────────────────────────────
if [[ -n "$ACTION" ]]; then
    run_action "$ACTION"
    exit $?
fi

# Interactive menu loop
while true; do
    show_menu
    read -rp '  Choice: ' choice
    echo ''
    case "$choice" in
        1) run_action sync      ;;
        2) run_action feature   ;;
        3) run_action stash     ;;
        4) run_action push      ;;
        5) run_action pr        ;;
        6) run_action push-pr   ;;
        c) run_action commit-push ;;
        7) run_action deploy    ;;
        8) run_action release-trigger ;;
        9) run_action tag       ;;
        s) run_action status    ;;
        l) run_action log       ;;
        q) echo ''; exit 0     ;;
        *) warn "Unknown option: $choice" ;;
    esac
    echo ''
    read -rp '  Press Enter to continue...' _
done
