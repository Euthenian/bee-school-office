"use client";

import { PageHeader } from "@/components/PageHeader";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { getHighestRole, roleLabels } from "@/lib/roles";
import { isSupabaseConfigured } from "@/lib/supabase";

export default function SettingsPage() {
  const { profile, session } = useAuth();
  const role = getHighestRole(profile);

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
