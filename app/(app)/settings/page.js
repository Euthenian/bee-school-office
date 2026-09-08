"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { getHighestRole, roleLabels } from "@/lib/roles";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

export default function SettingsPage() {
  const { profile, session } = useAuth();
  const role = getHighestRole(profile);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submittingPassword, setSubmittingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  async function handlePasswordChange(event) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setSubmittingPassword(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session?.user) {
      setPasswordError("An authenticated Supabase session is required to change your password.");
      setSubmittingPassword(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      setPasswordError(error.message);
      setSubmittingPassword(false);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPasswordSuccess("Password changed.");
    setSubmittingPassword(false);
  }

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Operational settings will be introduced as the admin workflows mature."
      />

      <section className="settings-grid">
        <DataSurface as="article">
          <SurfaceHeader>
            <h2>Environment</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <div>
              <dt>Production URL</dt>
              <dd>https://office.beeschool.jp</dd>
            </div>
            <div>
              <dt>Supabase public config</dt>
              <dd>{isSupabaseConfigured() ? "Configured" : "Missing"}</dd>
            </div>
            <div>
              <dt>Auth session</dt>
              <dd>{session ? "Signed in" : "Signed out"}</dd>
            </div>
          </dl>
        </DataSurface>

        <DataSurface as="article">
          <SurfaceHeader>
            <h2>Password</h2>
          </SurfaceHeader>
          <form className="student-form settings-password-form" onSubmit={handlePasswordChange}>
            <div className="form-grid single-column">
              <label>
                Current account email
                <input readOnly type="email" value={session?.user?.email || ""} />
              </label>
              <label>
                New password
                <input
                  autoComplete="new-password"
                  name="settings-new-password"
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
                  name="settings-confirm-new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
              </label>
              {passwordError ? <p className="form-error">{passwordError}</p> : null}
              {passwordSuccess ? <p className="inline-success">{passwordSuccess}</p> : null}
            </div>
            <div className="form-actions settings-password-actions">
              <button className="primary-button" disabled={submittingPassword} type="submit">
                {submittingPassword ? "Changing..." : "Change password"}
              </button>
            </div>
          </form>
        </DataSurface>

        <DataSurface as="article">
          <SurfaceHeader>
            <h2>Current Role</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <div>
              <dt>Highest role</dt>
              <dd>{role ? roleLabels[role] : "No role assigned"}</dd>
            </div>
            <div>
              <dt>Profile status</dt>
              <dd>{profile?.status || "Unavailable"}</dd>
            </div>
          </dl>
        </DataSurface>
      </section>
    </>
  );
}
