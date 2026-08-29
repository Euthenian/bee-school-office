# Expense Management Foundation

Bee School Office expense management is modeled separately from Payroll and Student Billing:

expense categories -> expenses

Expenses represent operational costs paid by Bee School, such as rent, utilities, materials, subscriptions, repairs, advertising, fees, and transportation. Categories are database rows scoped to an organization, with optional school-specific categories available later.

Expense summaries intentionally exclude `void` rows by default. Use `status = 'all'` or `status = 'void'` when audit review needs to include voided records.

Corrections should remain auditable. Edit active expense records when appropriate, or void the incorrect record and enter a corrected expense. Expense records should not be destructively deleted to change history.

Receipt upload is deferred because the current application has no secure document upload/storage implementation to reuse. This phase stores receipt metadata only: `receipt_reference`, `receipt_file_path`, and `receipt_original_name`. It does not store receipt blobs or arbitrary base64 data in the database.

This foundation does not define full accounting ledgers, approval workflows, vendor master data, tax filing logic, OCR, automated banking, or the final Finance Dashboard.
