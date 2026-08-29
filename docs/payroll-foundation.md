# Payroll Foundation

Bee School Office payroll data is modeled separately from Staff records:

staff -> compensation terms -> payroll periods -> payroll entries -> payroll payments

Compensation terms are versioned by effective dates. Payroll entries store calculation snapshots so later term changes do not rewrite historical payroll values. Payroll payments record actual payments separately from calculation entries and do not automate bank transfers.

Japanese tax identity numbers are out of scope for this foundation. If Bee School later needs My Number handling, it should be implemented as a separate restricted tax identity model with its own authorization boundary, not as fields on profiles, staff, compensation terms, payroll periods, payroll entries, payroll payments, or generic HR queries.
