# Payroll Foundation

Bee School Office payroll data is modeled separately from Staff records:

```text
staff -> compensation terms -> payroll periods -> payroll entries -> payroll payments
```

Payroll is a restricted financial module. The current access model is super-admin only. No `payroll_admin` role exists yet.

## Tables

- `staff_compensation_terms`
- `payroll_periods`
- `payroll_entries`
- `payroll_payments`

## Compensation Terms

`staff_compensation_terms` stores versioned, effective-dated compensation terms linked to `staff`.

Supported compensation types:

- `monthly_salary`
- `per_lesson`
- `hourly`
- `manual`
- `custom`

Supported units:

- `month`
- `lesson`
- `hour`
- `manual`
- `custom`

Fields include organization, optional school scope, staff ID, compensation type, amount, unit, currency, effective dates, notes, and timestamps.

Changing or adding a later compensation term must not rewrite historical payroll. Payroll entries store their own financial snapshot values.

## Payroll Periods

`payroll_periods` stores a payroll date range for either:

- `scope = 'organization'` with no `school_id`
- `scope = 'school'` with a `school_id`

Statuses:

- `draft`
- `finalized`
- `paid`

The UI includes period list, create-period, and period detail routes.

## Payroll Entries

`payroll_entries` is the payroll calculation snapshot. Entries are tied to a payroll period and staff member, and may reference the compensation term used at creation/edit time.

Snapshot fields include:

- compensation type
- compensation amount
- compensation unit
- currency
- base amount
- adjustments amount
- gross amount
- deductions amount
- net payable
- status
- notes

Entry statuses:

- `draft`
- `finalized`
- `paid`
- `void`

Only one payroll entry per staff member is allowed in a payroll period.

## Payroll Payments

`payroll_payments` records actual payment separately from payroll calculation. Payment fields include payroll entry, payment date, amount, currency, method, reference, notes, and timestamps.

Supported payment methods:

- `bank_transfer`
- `cash`
- `manual`
- `other`

No bank transfer automation exists.

## RPCs And UI

Implemented RPCs:

- `create_staff_compensation_term_mvp`
- `create_payroll_period_mvp`
- `update_payroll_period_mvp`
- `create_payroll_entry_mvp`
- `update_payroll_entry_mvp`
- `record_payroll_payment_mvp`

Implemented routes:

- `/payroll/`
- `/payroll/periods/new/`
- `/payroll/periods/detail/`
- `/payroll/entries/new/`
- `/payroll/entries/edit/`
- `/payroll/payments/new/`
- `/staff/profile/` includes restricted compensation history and add-term workflow

## Security And Boundary

Payroll tables have RLS and tenant fields. The current helper `can_manage_payroll_org()` returns only `is_super_admin()`, so ordinary teachers, school managers, office staff, and franchise owners do not receive payroll access in this phase.

Japanese tax identity numbers are out of scope. If Bee School later needs My Number handling, it must be implemented as a separate restricted tax identity model with its own authorization boundary, not as fields on profiles, staff, compensation terms, payroll periods, payroll entries, payroll payments, or generic HR queries.
