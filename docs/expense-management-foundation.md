# Expense Management Foundation

Bee School Office expense management is modeled separately from Payroll and Student Billing:

```text
expense categories -> expenses
```

The current access model is super-admin only. No delegated expense or finance role exists yet.

## Tables

- `expense_categories`
- `expenses`

## Expense Categories

`expense_categories` are organization-scoped and optionally school-scoped. Categories are extensible database rows.

Seeded organization-wide category codes:

- `rent`
- `utilities`
- `internet_communications`
- `teaching_materials`
- `office_supplies`
- `furniture_equipment`
- `cleaning`
- `repairs_maintenance`
- `advertising_marketing`
- `software_subscriptions`
- `professional_fees`
- `bank_payment_fees`
- `transportation`
- `taxes_fees`
- `other`

Category statuses are `active` and `inactive`.

## Expenses

`expenses` represent operational costs paid by Bee School. Fields include:

- expense date
- organization
- school
- category
- vendor
- description
- amount
- currency
- tax amount
- payment method
- reference
- notes
- receipt metadata
- status
- created-by audit fields
- void audit fields

Supported payment methods:

- `cash`
- `bank_transfer`
- `bank_debit`
- `card`
- `other`

Expense statuses:

- `active`
- `void`

Expense records should not be destructively deleted to change history.

## Void And Summary Behavior

`void_expense_mvp` marks an expense `void`, records who voided it, records `voided_at`, and stores a reason when supplied.

`get_expense_summary_mvp` supports totals by period, category, school, vendor, payment method, and status. Normal summaries use `status = 'active'`, so void expenses are excluded from normal totals. Use `status = 'void'` or `status = 'all'` for audit review.

## Routes

- `/expenses/`
- `/expenses/new/`
- `/expenses/detail/`

The list supports filtering by school, category, date range, payment method, status, vendor, and search. The detail page supports active expense editing and voiding.

## Receipts

Receipt upload/storage is not implemented yet.

Only receipt metadata/reference fields exist:

- `receipt_reference`
- `receipt_file_path`
- `receipt_original_name`

No receipt blobs, secure file storage workflow, or OCR exists in this phase.

## Deferred

The following are not implemented in Expense Management:

- approval workflow
- vendor master data
- receipt upload
- OCR
- automated banking
- tax filing
- full accounting ledger
