# Student Billing Foundation

Bee School Office student billing data is modeled separately from Payroll:

students -> student charges -> student payments -> payment allocations -> refunds

Charges represent money owed. Payments represent actual money received. Allocations connect payments to charges, so one payment can cover multiple charges and one charge can be paid in parts.

This foundation does not define Bee School pricing, tuition formulas, deposit refund rules, or automatic bank direct-debit processing. Deposits are represented as ordinary student charges with `charge_type = 'deposit'` until the business rules for deposits and refunds are specified.

Corrections should remain auditable. Use void/cancel statuses where appropriate, adjustment charge records for billing corrections, and refund records for money returned. Historical financial rows should not be destructively deleted to change history.
