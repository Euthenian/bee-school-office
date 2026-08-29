"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SetupNotice } from "@/components/SetupNotice";
import { useAuth } from "@/components/AuthProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const { configured, loading, session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && session) {
      router.replace("/dashboard/");
    }
  }, [loading, router, session]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase public environment variables are not configured.");
      setSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    router.replace("/dashboard/");
  }

  if (loading) {
    return <LoadingScreen label="Checking session" />;
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="login-heading">
        <div className="brand-stack">
          <div className="brand-mark" aria-hidden="true">
            B
          </div>
          <div>
            <p className="eyebrow">Bee School</p>
            <h1 id="login-heading">Office</h1>
          </div>
        </div>

        {!configured ? (
          <SetupNotice />
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
