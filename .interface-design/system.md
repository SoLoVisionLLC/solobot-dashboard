# SoLoVision Command Center — Design System

## Intent

**Who:** Developer/founder managing multiple products and an AI assistant (SoLoBot)
**Task:** Monitor status, manage tasks, chat with AI, track activity, access docs — all equally important
**Feel:** Calm workspace — professional, focused, no visual noise

---

## Brand Colors

```css
--brand-red: #BC2026;      /* Primary accent, CTAs, user identity */
--brand-red-hover: #a51c21;
--brand-navy: #1B2232;     /* Logo, strong headings (accent only, not surfaces) */
--brand-grey: #A9B2BC;     /* Secondary text, borders */
--brand-white: #FFFFFF;
```

**Usage:** Red for actions and user-owned elements. Navy as accent for brand moments, NOT for surface backgrounds. Grey for supporting UI.

---

## Surface Architecture

### Dark Theme (Default) — Slate/Metal

Cool grays with subtle blue undertone. Professional, modern, no warmth.

```css
--surface-base: #0c0d10;    /* App canvas */
--surface-1: #14161a;       /* Cards, panels */
--surface-2: #1c1e23;       /* Elevated: dropdowns, task cards */
--surface-3: #24262c;       /* Higher elevation */
--surface-overlay: #2c2f36; /* Modals, popovers */
```

### Light Theme

```css
--surface-base: #F8FAFC;    /* App canvas */
--surface-1: #FFFFFF;       /* Cards, panels */
--surface-2: #F1F5F9;       /* Elevated surfaces */
--surface-3: #E2E8F0;       /* Higher elevation */
--surface-overlay: #FFFFFF; /* Modals */
```

**Principle:** Elevation increases lightness in dark mode, uses subtle shadow in light mode. Differences are barely perceptible but felt.

---

## Text Hierarchy

Four levels, used consistently:

```css
/* Dark */
--text-primary: #FFFFFF;
--text-secondary: #A9B2BC;
--text-muted: rgba(169, 178, 188, 0.6);
--text-faint: rgba(169, 178, 188, 0.4);

/* Light */
--text-primary: #1B2232;
--text-secondary: #64748b;
--text-muted: rgba(27, 34, 50, 0.5);
--text-faint: rgba(27, 34, 50, 0.3);
```

---

## Borders

Subtle, not harsh. Define regions without demanding attention.

```css
/* Dark */
--border-default: rgba(169, 178, 188, 0.12);
--border-subtle: rgba(169, 178, 188, 0.08);
--border-strong: rgba(169, 178, 188, 0.2);
--border-focus: rgba(188, 32, 38, 0.5);

/* Light */
--border-default: rgba(27, 34, 50, 0.1);
--border-subtle: rgba(27, 34, 50, 0.06);
--border-strong: rgba(27, 34, 50, 0.15);
--border-focus: rgba(188, 32, 38, 0.4);
```

---

## Spacing Scale

8px base unit:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
```

---

## Border Radius

```css
--radius-sm: 4px;   /* Small elements, badges */
--radius-md: 8px;   /* Buttons, inputs, task cards */
--radius-lg: 12px;  /* Cards, modals */
--radius-full: 9999px; /* Pills, status dots */
```

---

## Semantic Colors

```css
/* Success */
--success: #22c55e;  /* Dark */ | #16a34a; /* Light */
--success-muted: rgba(34, 197, 94, 0.15);

/* Warning */
--warning: #eab308;  /* Dark */ | #ca8a04; /* Light */
--warning-muted: rgba(234, 179, 8, 0.15);

/* Error */
--error: #ef4444;    /* Dark */ | #dc2626; /* Light */
--error-muted: rgba(239, 68, 68, 0.15);
```

---

## Components

### Buttons

```css
.btn           /* Base: inline-flex, centered, 8px 16px padding, radius-md */
.btn-primary   /* Red background, white text */
.btn-ghost     /* Transparent, border, secondary text */
.btn-icon      /* Square, icon only */
.btn-danger    /* Error background */
```

### Cards

```css
.card          /* surface-1, border-default, radius-lg */
.card-elevated /* surface-2 */
```

### Badges

```css
.badge         /* Small pill, 11px font */
.badge-default /* surface-3 background */
.badge-success /* success-muted + success text */
.badge-warning /* warning-muted + warning text */
.badge-error   /* error-muted + error text */
```

### Status Dots

```css
.status-dot          /* 8px circle */
.status-dot.success  /* Green */
.status-dot.warning  /* Yellow */
.status-dot.error    /* Red */
.status-dot.idle     /* Muted gray */
.status-dot.pulse    /* Animated pulse */
```

### Inputs

```css
.input         /* Full width, control-bg, control-border, radius-md */
.input:focus   /* Red border, red glow */
```

### Task Cards

```css
.task-card           /* surface-2, subtle border, grab cursor */
.task-card.selected  /* Red border + glow */
.priority-p0         /* Red left border */
.priority-p1         /* Yellow left border */
.priority-p2         /* Blue left border */
```

---

## Depth Strategy

**Borders over shadows.** This is a utility dashboard — flat, information-dense, calm. Shadows reserved for:
- Floating elements (dropdowns, modals)
- Bulk action bar

---

## Typography

**Font:** Inter (400, 500, 600, 700)
**Terminal:** Fira Code / Monaco / Consolas

| Element | Size | Weight |
|---------|------|--------|
| Logo | 20px | 700 |
| Section title | 15px | 600 |
| Card title | 14px | 600 |
| Body | 14px | 400 |
| Task title | 13px | 500 |
| Meta/timestamp | 11-12px | 400 |
| Badge | 11px | 500 |

---

## Animation

```css
--transition-fast: 150ms ease;   /* Hover, focus */
--transition-normal: 200ms ease; /* State changes */
```

No bounce or spring effects. Professional, instant feedback.

---

## Scroll Behavior

Scrollable containers use real-time cursor detection to route wheel events. No scroll "locking" to the element where scrolling started.

```javascript
document.addEventListener('wheel', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const scrollable = el?.closest('.chat-messages, .activity-list, ...');
    if (scrollable) {
        e.preventDefault();
        scrollable.scrollTop += e.deltaY;
    }
}, { passive: false });
```

---

## Modal Pattern

```css
.modal-overlay         /* Fixed, inset 0, dark backdrop */
.modal-overlay.visible /* display: flex (default: none) */
.modal                 /* surface-1, radius-lg, max-width */
```

Show/hide via `.visible` class, not inline styles.

---

## Chat Messages

- **User:** Right-aligned, red-tinted background, "You" label in brand-red
- **Bot:** Left-aligned, surface-2 background, "SoLoBot" label in success green
- **System:** Warning-tinted background, yellow label

---

## File Structure

```
index.html      — All CSS variables and component styles in <style>
dashboard.js    — Rendering uses design system classes
gateway-client.js — WebSocket connection (no styles)
```

No external CSS framework. Self-contained design system.
