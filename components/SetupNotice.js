export function SetupNotice() {
  return (
    <div className="setup-notice">
      <h2>Supabase configuration required</h2>
      <p>
        Create `.env.local` from `.env.local.example`, then add the public Supabase anon key before signing in.
      </p>
    </div>
  );
}
