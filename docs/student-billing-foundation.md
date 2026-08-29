# Student Billing & Payments Foundation

Bee School Office student billing data is modeled separately from Payroll:

```text
students -> student charges -> student payments -> payment allocations -> refunds
```

Charge means money owed. Payment means money actually received. Allocation rows connect actual payments to charges.

The current access model is super-admin only. No delegated billing role exists yet.

## Tables

- `student_charges`
- `student_payments`
- `student_payment_allocations`
- `student_refunds`

## Charges

`student_charges` stores amounts owed by a student. Fields include organization, school, student, optional billing period, charge type, description, amount, currency, due date, status, optional source metadata, notes, and timestamps.

Supported charge types:

- `tuition`
- `entrance_fee`
- `materials`
- `trial_lesson`
- `private_lesson`
- `deposit`
- `adjustment`
- `other`

Charge statuses:

- `draft`
- `open`
- `partially_paid`
- `paid`
- `void`
- `cancelled`

Only `adjustment` charges may be negative.

## Payments

`student_payments` stores money actually received. Fields include organization, school, student, payment date, amount, currency, payment method, reference, status, notes, and timestamps.

Supported payment methods:

- `bank_transfer`
- `bank_debit`
- `cash`
- `card`
- `other`

Payment statuses:

- `received`
- `partial`
- `allocated`
- `refunded`
- `void`

## Allocations

`student_payment_allocations` connects payments to charges and supports:

- partial payment of one charge
- one payment split across multiple charges
- multiple payments applied to one charge
- unallocated payment balance

Allocation validation prevents over-allocation against either the payment or the charge.

## Corrections And Refunds

Financial history should not be destructively deleted to change history.

Implemented correction mechanisms:

- `void_student_charge_mvp`
- `void_student_payment_mvp`
- adjustment charges
- `student_refunds`
- `record_student_refund_mvp`

Refund methods:

- `bank_transfer`
- `cash`
- `card`
- `other`

Refund statuses:

- `recorded`
- `void`

## Billing Summary

`get_student_billing_summary_mvp` returns billing summary values including:

- total charges
- allocated payments
- outstanding balance
- overdue balance
- unallocated payments
- refunds

The Student Profile has a restricted Billing / Payments section. It shows balances, charges, payments, allocations, and refunds for users who can manage billing.

## RPCs And UI

Implemented RPCs:

- `create_student_charge_mvp`
- `record_student_payment_mvp`
- `allocate_student_payment_mvp`
- `record_student_refund_mvp`
- `void_student_charge_mvp`
- `void_student_payment_mvp`
- `get_student_billing_summary_mvp`

Implemented routes:

- `/billing/`
- `/billing/charges/new/`
- `/billing/payments/new/`
- `/billing/allocations/new/`
- `/billing/refunds/new/`
- `/students/profile/` restricted Billing / Payments section

## Deferred Business Rules

The following are not automated yet:

- Bee School pricing formulas
- automatic monthly tuition generation
- automatic deposit refund rules
- direct bank debit processing
- invoices
- receipts
