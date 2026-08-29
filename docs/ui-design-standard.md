# Bee School Office UI Design Standard

The existing Bee School Office dashboard at `/dashboard/` is the canonical visual design for the entire application.

Future Codex work must extend this visual language rather than redesign it. Do not introduce a different admin template, component library, visual theme, color system, navigation pattern, or marketing-style UI.

## Canonical Files

The current appearance is defined by:

- `app/globals.css`: color tokens, spacing, layout, tables, buttons, badges, cards, forms, and responsive rules.
- `components/AdminShell.js`: dark green sidebar, compact Bee School Office branding, navigation, top header, user chip, and logout action.
- `components/PageHeader.js`: page eyebrow, title, description, and optional action area.
- `components/Surface.js`: dashboard-native data surfaces, surface headers, metric cards, and responsive table wrapper.
- `components/StatusBadge.js`: small professional status labels.
- `components/EmptyState.js`: restrained empty-state text inside existing surfaces.

## Required Visual Language

New modules must preserve:

- dark green left sidebar
- compact Bee School Office branding
- white/light-gray main workspace
- thin borders
- restrained typography
- compact navigation
- simple rectangular cards with 8px or smaller radii
- minimal shadows
- small professional status labels
- generous but controlled whitespace
- desktop productivity-first layout
- clean internal business application aesthetic

Do not add decorative gradients, oversized rounded cards, excessive animation, colorful SaaS dashboard treatments, or marketing-page composition.

## Layout Rules

Use `AdminShell` for authenticated application pages. Keep the sidebar width, branding proportions, nav spacing, topbar height, and content width as the baseline.

Use `PageHeader` at the top of application pages. Keep title hierarchy restrained and do not introduce hero-scale headings inside admin workflows.

Use `DataSurface` for primary panels, tables, detail groups, and settings sections. Use `SurfaceHeader` for panel titles and compact actions. Use `MetricCard` only for dashboard-style KPI cards.

Use `ResponsiveTable` around tables so list views keep the current desktop table appearance while remaining usable on narrow screens.

Use existing CSS classes before adding new ones. When a new class is necessary, define it in `app/globals.css` using the existing tokens and proportions.

## Components And States

Buttons should continue using `primary-button`, `secondary-button`, and `ghost-button`.

Forms should use the current label/input sizing, borders, focus state, and compact spacing.

Status values should use `StatusBadge`. Add status colors only when the new state genuinely needs distinction, and keep labels small and professional.

Empty, loading, and error states should remain quiet and functional. Do not use illustrations, decorative cards, or animated onboarding panels for internal admin workflows.

## Responsive Behavior

Desktop remains the primary design target. Responsive changes should preserve the same visual identity by stacking existing grids, keeping the dark sidebar/nav structure recognizable, preserving readable tables through horizontal overflow, and avoiding mobile-specific redesigns that feel like a separate product.

## Drift Prevention

Before adding or changing UI, compare the result against the current dashboard. If the change would make another page feel like a different admin app, do not ship it.
