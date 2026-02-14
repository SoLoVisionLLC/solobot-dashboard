#!/bin/bash
# SoLoBot Dashboard — JS Bundle Build Script
# Concatenates all JS modules into a single file for production
# Order matters: state/utils first, then features, then init

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JS_DIR="$REPO_DIR/js"
DIST_DIR="$REPO_DIR/dist"

mkdir -p "$DIST_DIR"

# Define module load order (dependencies first)
MODULES=(
    state.js
    utils.js
    ui.js
    tasks.js
    quick-stats.js
    phase1-visuals.js
    agents.js
    channels.js
    costs.js
    analytics.js
    focus-timer.js
    keyboard.js
    memory.js
    memory-browser.js
    models.js
    notifications.js
    security.js
    sessions.js
    sidebar-agents.js
    skills-mgr.js
    system.js
    ui-handlers.js
    cron.js
    health.js
    chat.js
)

BUNDLE="$DIST_DIR/bundle.js"

echo "// SoLoBot Dashboard — Bundled JS" > "$BUNDLE"
echo "// Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$BUNDLE"
echo "// Modules: ${#MODULES[@]}" >> "$BUNDLE"
echo "" >> "$BUNDLE"

TOTAL_LINES=0
for module in "${MODULES[@]}"; do
    if [ -f "$JS_DIR/$module" ]; then
        echo "" >> "$BUNDLE"
        echo "// === $module ===" >> "$BUNDLE"
        cat "$JS_DIR/$module" >> "$BUNDLE"
        LINES=$(wc -l < "$JS_DIR/$module")
        TOTAL_LINES=$((TOTAL_LINES + LINES))
        echo "  ✓ $module ($LINES lines)"
    else
        echo "  ⚠ $module not found, skipping"
    fi
done

echo ""
echo "Bundled $TOTAL_LINES lines → $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"

# Try minification with esbuild if available
if command -v esbuild &> /dev/null; then
    esbuild "$BUNDLE" --minify --outfile="$DIST_DIR/bundle.min.js" 2>/dev/null && \
        echo "Minified → $DIST_DIR/bundle.min.js ($(du -h "$DIST_DIR/bundle.min.js" | cut -f1))" || \
        echo "⚠ esbuild minification failed (non-critical)"
elif command -v npx &> /dev/null; then
    npx -y esbuild "$BUNDLE" --minify --outfile="$DIST_DIR/bundle.min.js" 2>/dev/null && \
        echo "Minified → $DIST_DIR/bundle.min.js ($(du -h "$DIST_DIR/bundle.min.js" | cut -f1))" || \
        echo "⚠ No minifier available (bundle.js still works)"
else
    echo "ℹ No esbuild/npx available — using unminified bundle"
fi
