# Bee School Office Architecture

## Purpose

Bee School Office is the internal management system for Bee School HQ and future Bee School franchise organizations. It is a static-export-compatible Next.js App Router application backed by Supabase Auth, PostgreSQL, Supabase Edge Functions, Supabase Cron, and Row Level Security.

The current implementation covers tenant-safe foundations for students, classes, trial lessons, Gmail Trial Booking ingestion, communications, staff/teachers, payroll, student billing, expenses, finance overview, student questions/reminders, and Bee School Office initiated AI-EIGO student invitations.

## Runtime Model

The frontend is designed for Sakura Internet shared hosting:

- `next.config.mjs` sets `output: "export"` and `trailingSlash: true`.
- `npm run build` writes static HTML, CSS, and JavaScript to `out/`.
- The app does not use Vercel-only features, API routes, middleware, server actions, ISR, runtime redirects, or server-side secrets.
- Supabase provides runtime authentication, database access, and authorization directly from the browser through the public anon key.
- Supabase Edge Functions perform server-side Gmail and Google Workspace work that requires secrets.

Do not place Supabase service-role keys, Gmail OAuth values, Cron secrets, refresh tokens, My Number values, or other credentials in this repository or in browser-visible environment variables.

## Tenant Model

Tenant isolation is centered on organizations and schools:

- `organizations`: Bee School HQ and each future franchise organization.
- `schools`: physical or operating school locations owned by one organization.
- `profiles`: application profile rows linked to Supabase Auth users.
- `organization_memberships`: organization-level authorization roles.
- `school_memberships`: school-level authorization roles.

Tenant-specific business tables use `organization_id`, and school-specific records also use `school_id`. Composite foreign keys are used where needed so related rows cannot silently cross organizations or schools.

The initial bootstrap creates only:

```text
Bee School HQ
`-- Ohashi
```

No fictional franchise data is seeded.

## Roles

Prepared authorization roles:

- `super_admin`: network-wide access.
- `franchise_owner`: access to their organization and schools.
- `school_manager`: access to assigned school administration.
- `office_staff`: administrative access for assigned organization or school.
- `teacher`: educational/student access needed for teaching.

The UI hides navigation that is not appropriate for the current role, but security is enforced in the database with RLS.

Financial modules are deliberately conservative:

- Payroll: super-admin only in the current UI and database helper model.
- Student Billing: super-admin only.
- Expenses: super-admin only.
- Finance Dashboard: super-admin only.

No `payroll_admin`, `finance_admin`, or equivalent delegated financial role exists yet.

## RLS Strategy

Public business tables have RLS enabled. Anonymous users must not receive useful access to Office data. Authenticated users receive grants only where RLS policies also constrain row access.

Core policy helper functions include:

- `is_super_admin()`
- `has_org_role(organization_id, roles)`
- `has_school_role(school_id, roles)`
- `can_access_org(organization_id)`
- `can_access_school(school_id)`
- `can_administer_school(school_id)`
- `can_manage_school(school_id)`
- `can_view_student(student_id)`
- `can_manage_student(student_id)`

Student notes are split by `visibility`:

- `education`: readable by teachers and administrative roles scoped to the student.
- `admin`: readable only by roles that can manage that student.

This prevents teachers from automatically receiving financial or highly sensitive administrative data.

## Identity, Staff, And Teachers

Bee School Office separates three concepts:

- Authentication identity: `profiles`.
- Application authorization: `organization_memberships` and `school_memberships`.
- HR/employment identity: `staff`.
- Operational school assignment: `staff_school_assignments`.

A person can remain a school manager in `school_memberships.role` while also being teaching-capable through `staff_school_assignments.can_teach = true`. Authorization role and teaching role are separate concepts.

Teacher dropdown eligibility now comes from active staff data:

- active `staff`
- active `staff_school_assignments`
- `can_teach = true`
- active linked `profiles` row
- active assigned school
- current assignment dates
- a profile/school membership where existing class and trial lesson foreign keys still require profile IDs

Teacher dropdowns no longer depend on `school_memberships.role = 'teacher'` as the sole source of truth.

## Current Modules

Implemented modules include:

- Student management: list, create, profile, edit, contacts, guardians, notes, class assignment fields, date of birth, age override.
- Trial Lessons: manual creation, participants, prospect/contact records, teacher selection, confirmation/follow-up communication hooks, conversion to student, delete RPC, pending Gmail booking review and conversion.
- Gmail Trial Booking automation: Gmail polling Edge Function, pending import table, review UI, atomic conversion RPC, Cron scheduling, dashboard health alert, and external critical/recovery email alerting.
- Communications: templates, communication logs, idempotent integration actions, no-show follow-up queueing, and dispatch Edge Function boundary.
- Staff / Teachers: HR staff records, school assignments, teacher eligibility, staff routes.
- Payroll: compensation terms, payroll periods, payroll entries, payroll payments, restricted UI.
- Student Billing: charges, payments, allocations, refunds, billing summary, restricted UI.
- Expenses: expense categories, expenses, summary RPC, void workflow, restricted UI.
- Finance Dashboard: super-admin overview aggregating Billing, Payroll, and Expenses without introducing a separate ledger.
- Student Questions / Reminders: student questions table, student-profile section, global Questions page, due/overdue badge.
- AI-EIGO Student Invitations: secure personal invitation state, existing Gmail dispatch reuse, service-role-only AI-EIGO verify/claim RPC contract, and per-student status/actions. See [AI-EIGO Student Invitations](./ai-eigo-student-invitations.md).

## AI-EIGO Invitation Boundary

Bee School Office is the source of truth for Bee student access to AI-EIGO. The normal activation flow is a personal secure invitation email, not a classroom QR code, generic public entitlement URL, or shared Bee code.

Bee School Office stores only hashed invitation tokens. The existing Gmail dispatch Edge Function prepares the raw token in memory immediately before sending. AI-EIGO must claim invitations from its server through service-role-only Bee School Office RPCs and activate only the canonical `bee` entitlement in AI-EIGO.

The Bee School Office side is implemented in this repository. Production use still requires the AI-EIGO application to host the invite route and perform its server-side claim and entitlement activation step.

Remote schema status: a read-only PostgREST schema check against the linked Supabase project on 2026-08-29 confirmed that the recent feature tables, including `student_questions`, are present in the remote schema. Direct migration-history listing was not available from the local CLI because the cached Postgres password was rejected, so this documentation relies on repository audit plus non-mutating schema checks rather than migration-table output.

## Trial Lesson Address Boundary

Prospect and Trial Lesson intake must not collect postal addresses. The trial workflow captures only the operational data needed to book, run, and follow up on the trial lesson: names, email/phone contacts, requested lesson details, attribution, requests, notes, and participant information such as age or date of birth when available.

Postal address belongs later in the enrollment and payment setup flow, when the customer actually joins and completes bank direct-debit or payment paperwork. Converting a Trial Lesson participant to a Student must allow the student administrative profile to exist without a postal address initially.

Do not add address fields to Trial Lesson forms, prospect records, booking ingestion, or import mappings just because an old paper Taiken form included them. Preserve the extension point for a future enrolled customer or student contact-address model, but keep that model separate from Prospect and Trial Lesson intake.

## My Number Boundary

Japanese My Number is not currently stored in Bee School Office.

It must remain separate from:

- `profiles`
- `staff`
- payroll tables
- student billing tables
- expense tables
- generic HR or staff queries

Future My Number handling requires a separate restricted tax identity architecture with stricter access controls, audit rules, and storage decisions.

## Current Route Map

Implemented authenticated routes:

- `/dashboard/`
- `/students/`
- `/students/new/`
- `/students/profile/`
- `/students/edit/`
- `/questions/`
- `/trial-lessons/`
- `/trial-lessons/new/`
- `/trial-lessons/imports/`
- `/trial-lessons/imports/review/`
- `/communications/`
- `/schools/`
- `/staff/`
- `/staff/new/`
- `/staff/profile/`
- `/staff/edit/`
- `/payroll/`
- `/payroll/periods/new/`
- `/payroll/periods/detail/`
- `/payroll/entries/new/`
- `/payroll/entries/edit/`
- `/payroll/payments/new/`
- `/billing/`
- `/billing/charges/new/`
- `/billing/payments/new/`
- `/billing/allocations/new/`
- `/billing/refunds/new/`
- `/expenses/`
- `/expenses/new/`
- `/expenses/detail/`
- `/finance/`
- `/users/`
- `/settings/`

Public/auth routes:

- `/login/`

## Implemented

Verified in the repository and, for recent feature tables, by non-mutating remote schema checks:

- Authenticated Office shell and role-aware navigation.
- Organization/school tenant model with RLS helpers.
- Student create/edit/profile workflows.
- Class details and teacher selection through staff teaching assignments.
- Manual Trial Lesson workflow and participant conversion to Student.
- Gmail Trial Booking ingestion into pending imports.
- Human review and explicit conversion from pending import to live Trial Lesson.
- Gmail Trial Booking Supabase Cron health monitoring, dashboard alert, and external critical/recovery email alerting.
- Communications foundation and dispatch boundary.
- Staff / Teachers Phase 1.
- Payroll foundation.
- Student Billing & Payments foundation.
- Expense Management foundation.
- Finance Dashboard.
- Student Questions / Reminders.
- AI-EIGO Student Invitations.

## Implemented But Operationally Configured Outside The Repo

- Supabase Edge Function secrets for Gmail, service-role access, and Cron shared secrets.
- `TRIAL_BOOKING_CRON_ALERT_EMAIL` for Gmail Trial Booking Cron critical/recovery email recipients.
- Supabase Cron job `bee-school-gmail-trial-booking-poll` with cadence `*/15 * * * *`.
- Gmail OAuth mailbox authorization.
- Sakura static-site deployment.
- AI-EIGO invite route and server-side use of the Bee School Office verify/claim RPCs.

These settings must be checked in Supabase/Sakura operations, not inferred from source code alone.

## Planned / Deferred

Deferred items that must not be documented as implemented:

- Secure My Number storage.
- Dedicated payroll or finance admin roles.
- Receipt file uploads and secure document storage.
- OCR.
- Automatic bank direct-debit processing.
- Automated bank transfers.
- Bee School pricing formulas and automatic tuition generation.
- Automatic deposit refund business rules.
- Invoices and receipts.
- Full accounting ledger.
- Tax filing.
- External Cron failure notifications beyond email, such as SMS, Slack, LINE, or push alerts.
- Advanced approval workflows.

## Bootstrap Procedure

Run this only after the migration is applied and after the first admin user exists in Supabase Auth.

1. Create or invite the first admin user in Supabase Auth.
2. Copy that Auth user's UUID.
3. In the Supabase SQL editor, or via a trusted database connection, run:

   ```sql
   select *
   from public.bootstrap_bee_school_hq(
     'AUTH_USER_UUID_HERE',
     'admin@example.com',
     'Admin Name'
   );
   ```

The bootstrap function is `security definer`, idempotent for the HQ organization and Ohashi school, and is not executable by `anon` or `authenticated`. It does not weaken RLS for browser clients.

## Environment Variables

Use `.env.local` for local frontend development:

```text
NEXT_PUBLIC_SUPABASE_URL=https://fvtutcyootnvekegptcb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-with-supabase-anon-public-key
NEXT_PUBLIC_SITE_URL=https://office.beeschool.jp
```

Only `NEXT_PUBLIC_*` values are used in browser code. Server-only Supabase, Gmail, Google, and Cron secrets belong in Supabase Edge Function secrets.
