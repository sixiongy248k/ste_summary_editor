#!/usr/bin/env bash
# ============================================================
# Summary Editor — Deploy Script (Bash)
#
# Copies extension files into SillyTavern's third-party
# extensions folder, or removes them.
#
# Usage:
#   bash deploy.sh                          # Copy (default)
#   bash deploy.sh --clean                  # Delete old + copy fresh
#   bash deploy.sh --delete                 # Remove only
#   bash deploy.sh --set-path "/path/to/st/extensions/third-party"
#
# Use --set-path to save your ST install location,
# or edit ST_EXTENSIONS_DIR below manually.
# ============================================================

set -euo pipefail

# ── CONFIGURATION ─────────────────────────────
# Set this to your SillyTavern third-party extensions directory.
# Or use: bash deploy.sh --set-path "/your/path/here"
ST_EXTENSIONS_DIR="/PUT_YOUR_SILLYTAVERN_PATH_HERE/public/scripts/extensions/third-party"

# Extension folder name (matches the extension ID)
EXT_FOLDER="summary-editor"
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/deploy.sh"

# Files and folders to copy (excludes deploy scripts, CLAUDE.md, .git, etc.)
INCLUDE_ITEMS=(
    "manifest.json"
    "index.js"
    "style.css"
    "settings.html"
    "README.md"
    "src"
    "lib"
    "templates"
    "configs"
)

# ── Color helpers ─────────────────────────────
red()    { echo -e "\033[31m$1\033[0m"; }
green()  { echo -e "\033[32m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }
cyan()   { echo -e "\033[36m$1\033[0m"; }
gray()   { echo -e "\033[90m$1\033[0m"; }

# ── Handle --set-path ────────────────────────

handle_set_path() {
    local new_path="$1"
    # Strip trailing slashes
    new_path="${new_path%/}"

    if [[ ! -d "$new_path" ]]; then
        yellow "WARNING: Directory does not exist yet: $new_path"
        read -r -p "Save this path anyway? (y/N) " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            gray "Aborted."
            exit 0
        fi
    fi

    # Escape forward slashes for sed
    local escaped_path
    escaped_path=$(printf '%s\n' "$new_path" | sed 's/[&/\]/\\&/g')

    # Replace the ST_EXTENSIONS_DIR line in this script
    sed -i "s|^ST_EXTENSIONS_DIR=.*|ST_EXTENSIONS_DIR=\"${new_path}\"|" "$SCRIPT_PATH"

    echo ""
    cyan "Path saved to deploy.sh:"
    green "  $new_path"
    echo ""
    gray "You can now run: bash deploy.sh"
    exit 0
}

# ── Verify configuration ─────────────────────

verify_config() {
    if [[ "$ST_EXTENSIONS_DIR" == *"PUT_YOUR_SILLYTAVERN_PATH_HERE"* ]]; then
        red "ERROR: SillyTavern path not configured."
        echo ""
        yellow "Set it with:"
        gray '  bash deploy.sh --set-path "/path/to/SillyTavern/public/scripts/extensions/third-party"'
        echo ""
        gray "Or edit the ST_EXTENSIONS_DIR variable in deploy.sh directly."
        exit 1
    fi

    if [[ ! -d "$ST_EXTENSIONS_DIR" ]]; then
        red "ERROR: ST extensions directory not found: $ST_EXTENSIONS_DIR"
        yellow "Check that your SillyTavern path is correct, or update it with:"
        gray "  bash deploy.sh --set-path \"/correct/path/here\""
        exit 1
    fi
}

# ── Functions ─────────────────────────────────

remove_extension() {
    local target="${ST_EXTENSIONS_DIR}/${EXT_FOLDER}"
    if [[ -d "$target" ]]; then
        rm -rf "$target"
        yellow "DELETED: $target"
    else
        gray "Nothing to delete (folder does not exist): $target"
    fi
}

copy_extension() {
    local target="${ST_EXTENSIONS_DIR}/${EXT_FOLDER}"
    mkdir -p "$target"

    for item in "${INCLUDE_ITEMS[@]}"; do
        local src="${SCRIPT_DIR}/${item}"
        local dest="${target}/${item}"

        if [[ -e "$src" ]]; then
            if [[ -d "$src" ]]; then
                cp -r "$src" "$dest"
                green "  COPIED: ${item}/ -> ${dest}"
            else
                cp "$src" "$dest"
                green "  COPIED: ${item} -> ${dest}"
            fi
        else
            gray "  SKIPPED (not found): ${item}"
        fi
    done

    echo ""
    cyan "Deployed to: $target"
}

# ── Main ──────────────────────────────────────

ACTION="${1:-}"

# Handle --set-path before anything else (doesn't need config verification)
if [[ "$ACTION" == "--set-path" ]]; then
    if [[ -z "${2:-}" ]]; then
        red "ERROR: --set-path requires a path argument."
        echo "Usage: bash deploy.sh --set-path \"/path/to/extensions/third-party\""
        exit 1
    fi
    handle_set_path "$2"
fi

verify_config

TARGET_DIR="${ST_EXTENSIONS_DIR}/${EXT_FOLDER}"

echo ""
cyan "Summary Editor — Deploy Script"
echo "Source:  $SCRIPT_DIR"
echo "Target:  $TARGET_DIR"
echo ""

case "$ACTION" in
    --delete)
        remove_extension
        ;;
    --clean)
        remove_extension
        echo ""
        copy_extension
        ;;
    --copy|"")
        copy_extension
        ;;
    *)
        red "Unknown flag: $ACTION"
        echo "Usage: bash deploy.sh [--copy|--clean|--delete|--set-path <path>]"
        exit 1
        ;;
esac

echo ""
green "Done."
