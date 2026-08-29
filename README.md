# Bee School Office

Bee School Office is the internal school and franchise management system for Bee School.

This first version is a static-export-compatible Next.js App Router application backed by Supabase Auth, PostgreSQL, and Row Level Security.

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

Do not deploy from this initial task.

When ready, run `npm run build` and upload the contents of `out/` to:

```text
/home/indigohorse19/www/office.beeschool.jp
```

See [docs/architecture.md](./docs/architecture.md) for the tenant model, RLS model, Sakura deployment notes, and bootstrap procedure.
