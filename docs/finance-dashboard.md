# Finance Dashboard

The Finance Dashboard is implemented at `/finance/`.

It is a super-admin-only management overview that aggregates existing financial source systems:

```text
Student Billing / Payments
+ Payroll
+ Expenses
```

These source systems remain separate. The Finance Dashboard does not introduce a separate accounting ledger.

## RPC

The dashboard reads:

```text
get_finance_dashboard_mvp
```

The RPC aggregates by organization, optional school, date range, and as-of date.

## Metrics

Returned metrics include:

- student cash received
- student refunds
- net student cash revenue
- student charges created
- student service-period charges
- outstanding receivables
- overdue receivables
- unallocated student payments
- payroll accrued net payable
- payroll paid
- operating expenses
- operating expense tax
- cash operating result
- accrual operating result
- student payment count
- student refund count
- student charge count
- payroll entry count
- payroll payment count
- expense count
- expense category totals

The cash model shown in the UI is:

```text
net student cash revenue - payroll paid - operating expenses = cash operating result
```

The accrual view shown in the UI is:

```text
student service-period charges - payroll accrued net payable - operating expenses = accrual operating result
```

## UI

The page supports:

- organization selection from organizations where the profile has `super_admin`
- optional school filter
- current month
- previous month
- current year
- custom date range
- metric cards with drilldowns to Billing, Payroll, and Expenses
- source breakdown panels
- expense category breakdown

## Security

The UI uses `canManageFinance()`, which is super-admin only.

The database helper `can_manage_finance_org()` requires a `super_admin` organization membership for the selected organization. The RPC has execute granted to authenticated users, but it enforces its own super-admin check.

No `finance_admin` role exists yet.

## Deferred

The Finance Dashboard is not a full accounting system. Deferred items include:

- general ledger
- chart of accounts
- tax filing
- accrual accounting beyond the current summary view
- invoices and receipts
- automated bank reconciliation
- external accounting package export
