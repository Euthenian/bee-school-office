"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SetupNotice } from "@/components/SetupNotice";
import { useAuth } from "@/components/AuthProvider";
import { fetchPendingTrialBookingImportCount, fetchStudentQuestionBadgeCount } from "@/lib/data";
import { formatCountBadgeValue } from "@/lib/navigation-badges";
import { canManageStudentQuestions, canManageTrialLessons, getHighestRole, getVisibleNavigation, roleLabels } from "@/lib/roles";
import { studentQuestionsUpdatedEvent } from "@/lib/student-questions";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function AdminShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { configured, loading, profile, profileError, session, signOut } = useAuth();
  const navigation = getVisibleNavigation(profile);
  const highestRole = getHighestRole(profile);
  const mayManageStudentQuestions = canManageStudentQuestions(profile);
  const mayManageTrialLessons = canManageTrialLessons(profile);
  const [pendingTrialBookingCount, setPendingTrialBookingCount] = useState(0);
  const [studentQuestionCount, setStudentQuestionCount] = useState(0);

  useEffect(() => {
    if (!loading && configured && !session) {
      router.replace("/login/");
    }
  }, [configured, loading, router, session]);

  useEffect(() => {
    let active = true;

    async function loadNavigationBadgeCounts() {
      if (!session) {
        setPendingTrialBookingCount(0);
        setStudentQuestionCount(0);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setPendingTrialBookingCount(0);
        setStudentQuestionCount(0);
        return;
      }

      const [pendingTrialBookings, dueQuestions] = await Promise.all([
        mayManageTrialLessons
          ? fetchPendingTrialBookingImportCount(supabase, { reviewStatus: "pending_review" })
          : { count: 0, error: null },
        mayManageStudentQuestions ? fetchStudentQuestionBadgeCount(supabase) : { count: 0, error: null }
      ]);

      if (!active) return;

      if (!pendingTrialBookings.error) {
        setPendingTrialBookingCount(pendingTrialBookings.count || 0);
      }

      if (!dueQuestions.error) {
        setStudentQuestionCount(dueQuestions.count || 0);
      }
    }

    loadNavigationBadgeCounts();
    window.addEventListener(studentQuestionsUpdatedEvent, loadNavigationBadgeCounts);

    return () => {
      active = false;
      window.removeEventListener(studentQuestionsUpdatedEvent, loadNavigationBadgeCounts);
    };
  }, [mayManageStudentQuestions, mayManageTrialLessons, pathname, session]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login/");
  }

  if (loading) {
    return <LoadingScreen label="Checking access" />;
  }

  if (!configured) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <SetupNotice />
        </section>
      </main>
    );
  }

  if (!session) {
    return <LoadingScreen label="Opening sign in" />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand-stack" href="/dashboard/">
          <div className="brand-mark" aria-hidden="true">
            B
          </div>
          <div>
            <p className="eyebrow">Bee School</p>
            <h1>Office</h1>
          </div>
        </Link>

        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map((item) => {
            let badgeValue = "";
            if (item.href === "/trial-lessons/") {
              badgeValue = formatCountBadgeValue(pendingTrialBookingCount);
            }
            if (item.href === "/questions/") {
              badgeValue = formatCountBadgeValue(studentQuestionCount);
            }

            return (
              <Link
                className={`nav-link ${pathname === item.href || pathname.startsWith(item.href) ? "active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <span>{item.label}</span>
                {badgeValue ? <span className="nav-count-badge">{badgeValue}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <strong>{profile?.full_name || session.user.email || "Signed in"}</strong>
          <span>{highestRole ? roleLabels[highestRole] : "No role assigned"}</span>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          {profileError ? <span className="inline-alert">{profileError}</span> : null}
          <div className="user-chip">
            <strong>{profile?.full_name || session.user.email}</strong>
            <span>{highestRole ? roleLabels[highestRole] : "Awaiting role"}</span>
          </div>
          <button className="ghost-button" onClick={handleSignOut} type="button">
            Log out
          </button>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
