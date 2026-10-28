# UI redesign rollout inventory

This inventory covers the remaining application routes after the first pass on Questions, Trial Lessons, Classes, Class Profile, and the shared shell. It was compiled from page and component usage of buttons, action groups, icons, badges, tables, cards, modals, and page headers. Scope estimates refer to visual migration only; business logic stays unchanged.

| Priority / order | Route | Existing UI / inconsistency to address | Reuse | Scope |
| --- | --- | --- | --- | --- |
| 1 | `/students/` | Dense list uses local row actions and bulk controls; align icon sizes, selected rows, and filters. | `ActionToolbar`, `ActionIcon`, `ResponsiveTable`, tokens | Large |
| 2 | `/students/profile/`, `/students/edit/`, `/students/new/`, `/students/finance/edit/` | Detail actions, form sections, and modals have separate spacing patterns. Preserve departure and finance warnings. | `PageHeader`, `DataSurface`, button tokens, `ActionIcon` | Large |
| 3 | `/trial-lessons/imports/`, `/trial-lessons/imports/review/`, `/trial-lessons/new/` | Import review actions and tables have their own icon and card rules. | `ActionToolbar`, `ActionIcon`, `StatusBadge`, `ResponsiveTable` | Medium |
| 4 | `/todo/`, `/dashboard/` | Work queues and dashboard metrics use multiple action and summary presentations. Preserve priority cues. | `MetricCard`, `DataSurface`, semantic badges, `ActionToolbar` | Medium |
| 5 | `/communications/` | Composer, templates, history, and automated communication cards need aligned forms, tables, and modal actions. | `DataSurface`, button tokens, `ActionIcon`, `StatusBadge` | Large |
| 6 | `/schools/`, `/staff/`, `/staff/profile/`, `/staff/edit/`, `/staff/new/`, `/teachers/`, `/teachers/profile/`, `/teachers/edit/`, `/teachers/new/`, `/users/` | Directory tables and detail/form actions use mostly text-only controls and mixed spacing. | `PageHeader`, `ActionToolbar`, `ActionIcon`, `ResponsiveTable` | Medium per group |
| 7 | `/finance/`, `/finance/monthly-payments/` | KPI cards, payment tables, and alerts need semantic color consolidation. Preserve RICO and overdue financial signals. | `MetricCard`, `DataSurface`, semantic tokens, `StatusBadge` | Large |
| 8 | `/billing/`, `/billing/allocations/new/`, `/billing/charges/new/`, `/billing/charges/edit/`, `/billing/payments/new/`, `/billing/refunds/new/` | Billing tables, filters, and financial forms use several local action and alert patterns. | `ResponsiveTable`, `ActionToolbar`, form and alert tokens | Large |
| 9 | `/expenses/`, `/expenses/detail/`, `/expenses/new/`, `/expenses/recurring/`, `/expenses/financial-docs/`, `/expenses/financial-docs/review/` | Expense lists, review queues, and detail cards repeat action layouts. Preserve approval and document states. | `ActionToolbar`, `ActionIcon`, `DataSurface`, `StatusBadge` | Large |
| 10 | `/payroll/`, `/payroll/entries/new/`, `/payroll/entries/edit/`, `/payroll/payments/new/`, `/payroll/periods/new/`, `/payroll/periods/detail/` | Period and entry tables/forms have inconsistent action density and status emphasis. | `ResponsiveTable`, `ActionToolbar`, `DataSurface`, tokens | Large |
| 11 | `/settings/`, `/settings/billing-plans/` | Settings forms and billing-plan tables have local action grouping. | `PageHeader`, `DataSurface`, button and form tokens | Medium |
| 12 | `/classes/new/`, `/classes/edit/` | Editor forms still use existing generic spacing; align with the refreshed list and profile. | `PageHeader`, `DataSurface`, form tokens | Small |
| 13 | `/login/`, `/reset-password/` | Authentication panels still use the older card spacing and form hierarchy. | Color, radius, button, and form tokens | Small |

Shared components to review during each route migration: communication and confirmation modals, `ClassAddStudentDialog`, `ClassDeleteDialog`, `QuestionDeleteDialog`, billing forms, and staff/student editors. Change their visuals only when the related route is migrated. Verify keyboard access, permissions, mobile overflow, and business highlights each time.
