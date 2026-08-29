# Bee School Office

Bee School Office is the internal school and franchise management system for Bee School.

It is a static-export-compatible Next.js App Router application backed by Supabase Auth, PostgreSQL, Row Level Security, Supabase Edge Functions, and Supabase Cron.

## Current Functionality

Implemented foundations include:

- tenant-safe students, contacts, guardians, notes, class details, and student profiles
- Trial Lessons, prospects, participants, manual Trial Lesson creation, and participant conversion to Student
- Gmail Trial Booking ingestion into pending imports, human review, and explicit conversion to live Trial Lessons
- Google Workspace communications foundation and Edge Function boundaries
- Staff / Teachers Phase 1 with staff-school teaching assignments
- Payroll foundation
- Student Billing & Payments foundation
- Expense Management foundation
- Finance Dashboard
- Student Questions / Reminders

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.local.example` and add the Supabase public anon key.

3. Start the local app:

   ```bash
   npm run dev
   ```

4. Apply database migrations using the Supabase CLI after linking the existing project:

   ```bash
   supabase link --project-ref fvtutcyootnvekegptcb
   supabase db push
   ```

Do not place service-role keys in this repository or in browser-visible environment variables.

## Scripts

- `npm run dev`: start the local Next.js dev server.
- `npm run lint`: run ESLint.
- `npm run test`: run Node's built-in tests.
- `npm run build`: create the static export in `out/`.

## Deployment

Deploy only when explicitly requested for an approved release.

When ready, run `npm run build` and upload the contents of `out/` to:

```text
/home/indigohorse19/www/office.beeschool.jp
```

See [docs/architecture.md](./docs/architecture.md) for the tenant model, RLS model, route map, Sakura deployment notes, current status, and bootstrap procedure.

Key module documents:

- [Gmail Trial Booking Automation](./docs/trial-booking-automation.md)
- [Google Workspace Communications](./docs/google-workspace-communications.md)
- [Staff / Teachers Phase 1](./docs/staff-teachers-phase1.md)
- [Payroll Foundation](./docs/payroll-foundation.md)
- [Student Billing & Payments Foundation](./docs/student-billing-foundation.md)
- [Expense Management Foundation](./docs/expense-management-foundation.md)
- [Finance Dashboard](./docs/finance-dashboard.md)
- [Student Questions / Reminders](./docs/student-questions-reminders.md)
