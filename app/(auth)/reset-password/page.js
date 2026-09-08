"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured, getSupabaseBrowserClient } from "@/lib/supabase";

function cleanRecoveryUrl() {
  window.history.replaceState({}, document.title, "/reset-password/");
}

async function establishRecoverySession(supabase) {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const hashError = hashParams.get("error") || hashParams.get("error_code");

  if (hashError) {
    cleanRecoveryUrl();
    throw new Error("This password recovery link is invalid or expired. Please request a new reset email.");
  }

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    cleanRecoveryUrl();
    if (error) throw error;
    return data.session;
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    cleanRecoveryUrl();
    if (error) throw error;
    return data.session;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const redirectTimerRef = useRef(null);
  const configured = isSupabaseConfigured();
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!configured) {
      return undefined;
    }

    let mounted = true;

    async function hydrateRecoverySession() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (mounted) {
          setError("Supabase public environment variables are not configured.");
          setLoading(false);
        }
        return;
      }

      try {
        const session = await establishRecoverySession(supabase);
        if (!mounted) return;

        if (!session?.user) {
          setError("Open the latest password recovery email link to choose a new password.");
          setLoading(false);
          return;
        }

        setSessionReady(true);
        setLoading(false);
      } catch (recoveryError) {
        if (!mounted) return;
        setError(recoveryError.message || "Unable to open this password recovery link.");
        setLoading(false);
      }
    }

    hydrateRecoverySession();

    return () => {
      mounted = false;
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, [configured]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase public environment variables are not configured.");
      setSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setSuccess("Password updated. Returning to sign in...");
    setSubmitting(false);

    redirectTimerRef.current = window.setTimeout(async () => {
      await supabase.auth.signOut({ scope: "local" });
      router.replace("/login/");
    }, 1200);
  }

  if (loading) {
    return <LoadingScreen label="Opening password reset" />;
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="reset-password-heading">
        <div className="brand-stack">
          <div className="brand-mark" aria-hidden="true">
            B
          </div>
          <div>
            <p className="eyebrow">Bee School</p>
            <h1 id="reset-password-heading">Reset password</h1>
          </div>
        </div>

        {!configured ? (
          <SetupNotice />
        ) : sessionReady ? (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              New password
              <input
                autoComplete="new-password"
                name="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              Confirm new password
              <input
                autoComplete="new-password"
                name="confirm-new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            {success ? <p className="inline-success">{success}</p> : null}
            <button className="primary-button" disabled={submitting || Boolean(success)} type="submit">
              {submitting ? "Updating..." : "Update password"}
            </button>
          </form>
        ) : (
          <div className="auth-form">
            {error ? <p className="form-error">{error}</p> : null}
            <Link className="secondary-button" href="/login/">
              Back to sign in
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
