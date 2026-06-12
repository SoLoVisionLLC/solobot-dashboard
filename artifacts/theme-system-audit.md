# Theme System Audit — 2026-04-26

## Scope
- Compared `solobot-dashboard/css/themes.css` against `SoLoClaw-Andoid/app/src/main/java/com/solovision/openclawagents/ui/theme/Theme.kt`.
- Updated dashboard theme tokens for Midnight, Obsidian, Nord, Dracula, Tokyo Night, Monokai, Catppuccin Mocha, Snow, Latte, Rose Pine Dawn, Solarized Light, Paper, SoLoVision Red, Cyberpunk, and Ocean to match the Android palette values.
- Audited chat-critical styling in `css/chat.css`, focusing on the theme leak SoLo reported: the fixed grey/navy chat canvas and bubbles.

## Fixes landed
- Snow now uses the Android Snow palette exactly:
  - `bgPrimary #F8FAFC`
  - `bgSecondary #FFFFFF`
  - `bgTertiary #F1F5F9`
  - `bgCard #FFFFFF`
  - `textPrimary #0F172A`
  - `textSecondary #475569`
  - `textMuted #94A3B8`
  - `accent #3B82F6`
  - `accentLight #60A5FA`
  - `accentSoft #1F3B82F6`
  - `border #E2E8F0`
  - `borderLight #CBD5E1`
  - `success #22C55E`, `warning #F59E0B`, `error #EF4444`, `info #3B82F6`
- Added compatibility aliases for older dashboard CSS variables (`--bg-card`, `--brand-primary`, `--surface-elevated`, etc.) so existing screens inherit the active theme instead of falling back to stale colors.
- Added chat-specific semantic tokens:
  - `--chat-canvas-bg`
  - `--chat-rail-bg`
  - `--chat-user-bubble-bg`
  - `--chat-bot-bubble-bg`
  - `--chat-system-bubble-bg`
  - `--chat-action-bg`
- Replaced chat hard-coded grey/navy/red styling with theme variables for:
  - chat canvas background
  - agent rail card background/border/shadow
  - input focus ring
  - user and SoLoBot bubbles
  - system bubble
  - message timestamps
  - action buttons
  - typing indicator
  - chat avatars/status ring
- Theme picker previews now render from the active theme variables instead of stale inline swatches.

## Remaining intentional fixed colors
- Agent identity colors remain fixed as identity tokens in `:root` (`--agent-main`, `--agent-dev`, etc.). Chat avatar selectors now reference those variables instead of literal hex values.
- `css/themes.css` intentionally contains literal hex values because it is the source token registry and mirrors Android `Theme.kt`.
- Other product/status accent colors outside the chat/theme-critical path still exist in older phase CSS files; they are candidates for a follow-up full design-system consolidation but were not required to fix the Snow/chat theme leak.

## Verification
- CSS brace/static sanity check passed.
- Chat CSS hard-coded color grep passed for the reported grey/navy/red leak patterns.

## Visual proof
- Generated a Snow-theme static preview with headless Chrome: `artifacts/snow-theme-preview.png`.
- Visual check confirmed: light Snow canvas, no old dark/grey navy gradient, light bot bubble, blue accent user bubble.
