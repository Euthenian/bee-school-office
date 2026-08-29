# Bee School Office Architecture

## Purpose

Bee School Office is the web-based operating system for Bee School HQ and future Bee School franchise organizations. The first version focuses on authentication, role-aware navigation, tenant-safe school and user foundations, and student management.

## Runtime Model

The app is designed for Sakura Internet shared hosting by using a Next.js static export:

- `next.config.mjs` sets `output: "export"` and `trailingSlash: true`.
- `npm run build` writes static HTML, CSS, and JavaScript to `out/`.
- A future deployment can upload the contents of `out/` to `/home/indigohorse19/www/office.beeschool.jp`.
- The app does not use Vercel-only features, API routes, middleware, server actions, ISR, runtime redirects, or server-side secrets.

Supabase provides runtime authentication, database access, and authorization directly from the browser through the public anon key. The service-role key must never be exposed to the frontend.

## Tenant Model

Tenant isolation is centered on organizations and schools:

- `organizations`: Bee School HQ and each future franchise organization.
- `schools`: physical or operating school locations owned by one organization.
- `profiles`: application profile rows linked to Supabase Auth users.
- `organization_memberships`: organization-level role assignments.
- `school_memberships`: school-level role assignments.

MVP student records use both `organization_id` and `school_id`. Composite foreign keys enforce that a student and its enrollment data cannot silently cross organizations or schools.

The first bootstrap creates only:

```text
Bee School HQ
`-- Ohashi
```

No fictional franchise data is seeded.

## Roles

Prepared roles:

- `super_admin`: network-wide access.
- `franchise_owner`: access to their organization and schools.
- `school_manager`: access to assigned school administration.
- `office_staff`: administrative access for assigned organization or school.
- `teacher`: educational/student access needed for teaching.

The UI hides navigation that is not appropriate for the current role, but security is enforced in the database with RLS.

## RLS Strategy

All public tables in the initial migration have RLS enabled. Anonymous users receive no table grants. Authenticated users receive grants only where policies also constrain row access.

Policy helper functions keep authorization rules readable:

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

This prevents teachers from automatically receiving financial or highly sensitive administrative data as later modules are added.

## Database Modules Prepared For Later

The schema is intentionally small, but it leaves room for later modules without changing the tenant foundation:

- classes and enrollments
- attendance
- prospects and trial lessons
- payments, accounting, invoices, receipts
- parent communications and automated emails
- weekly student progress reports
- documents
- franchise fees and resources
- analytics
- AI-EIGO integration

Future tenant-isolated business tables should include `organization_id` and, when the data is school-specific, `school_id`.

## Communications And Automation

Customer communication is tenant data and follows the same organization/school isolation model as Students and Trial Lessons.

The communications foundation uses:

- `communication_templates` for reusable message templates.
- `communications` for message snapshots, recipients, sender, source, delivery status, provider IDs, and errors.
- `communication_integration_actions` for idempotent Gmail and Google Calendar actions.
- `communication_automation_settings` for configurable automation values, including the default 48-hour no-show follow-up delay.
- `trial_lessons` follow-up fields: `no_show_at`, `follow_up_due_at`, `automated_follow_up_sent_at`, `phone_follow_up_completed_at`, and `follow_up_state`.

Browser code may queue communications through authenticated RPCs, but live Gmail and Google Calendar execution belongs only in Supabase Edge Functions with server-side secrets. The static Next.js app must not include Supabase service-role keys, Google OAuth credentials, refresh tokens, or Calendar secrets.

See `docs/google-workspace-communications.md` for the Google Workspace, Gmail API, Calendar API, Supabase secrets, and Cron setup required before live sending is enabled.

## Trial Lesson Address Boundary

Prospect and Trial Lesson intake must not collect postal addresses. The trial workflow should capture only the operational data needed to book, run, and follow up on the trial lesson: names, email/phone contacts, requested lesson details, attribution, requests, notes, and participant information such as age or date of birth when available.

Postal address belongs later in the enrollment and payment setup flow, when the customer actually joins and completes bank direct-debit or payment paperwork. Converting a Trial Lesson participant to a Student must allow the student administrative profile to exist without a postal address initially.

Do not add address fields to Trial Lesson forms, prospect records, booking ingestion, or import mappings just because an old paper Taiken form included them. Preserve the general contact/address extension point for a future enrolled customer or student administrative profile model, but keep that model separate from Prospect and Trial Lesson intake.

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

Use `.env.local` for local development:

```text
NEXT_PUBLIC_SUPABASE_URL=https://fvtutcyootnvekegptcb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-with-supabase-anon-public-key
NEXT_PUBLIC_SITE_URL=https://office.beeschool.jp
```

Only `NEXT_PUBLIC_*` values are used in browser code. Do not add service-role credentials to this app.
