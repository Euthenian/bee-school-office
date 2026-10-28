# Bee School Office UI Design Standard

Bee School Office uses a restrained, modern administration interface. The Questions, Trial Lessons, and Classes lists establish the first phase of the approved visual direction. Existing business workflows, permissions, and navigation remain authoritative.

## Foundation

- `app/globals.css` holds the shared design tokens and styles. Use `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--brand`, semantic status colors, spacing, button height, and radius tokens before introducing local values.
- `components/AdminShell.js` keeps the complete role-aware navigation. The light sidebar uses the same green accent and pale selected state as the main workspace.
- `components/PageHeader.js`, `components/Surface.js`, `components/StatusBadge.js`, and `components/EmptyState.js` remain the shared page, card, table, status, and empty-state primitives.
- `components/ActionIcon.js` is the shared inline SVG icon set. `components/ActionToolbar.js` groups compact row actions. Icon-only controls need an accessible label and a visible browser tooltip (`title`).

## Visual language

Use a soft off-white workspace, white surfaces, subtle gray borders, deep navy text, Bee School green for primary actions, and semantic success, warning, danger, and information colors. Keep cards clean, table rows compact, and type hierarchy clear. Avoid decorative effects and page-specific color inventions.

Use `primary-button`, `secondary-button`, `outline-button`, `danger-button`, or `ghost-button` for actions. Use `button-with-icon` for labeled actions and `action-icon-button` for icon-only actions. Use `ActionToolbar` for compact row actions. Preserve text labels for important page-level actions.

Use `StatusBadge` for status values. Use `DataSurface` and `ResponsiveTable` for list panels. Tables may scroll inside their own surface at narrow widths; the page itself should not overflow. Preserve the meaning of existing business highlights such as overdue questions and occupied classes.

## Responsive and accessibility checks

Review at 390 px, 768 px, and 1440 px. Keep controls at least 40 px tall, toolbars usable by touch, visible focus rings, and modals within the viewport. Preserve keyboard operation and semantic labels. Keep all existing routes, permissions, and actions during visual migrations.

See [the rollout inventory](ui-redesign-rollout.md) for the remaining routes and suggested order.
