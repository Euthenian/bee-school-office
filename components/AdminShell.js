"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SetupNotice } from "@/components/SetupNotice";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchFinancialDocumentBadgeCount,
  fetchOfficeTodoBadgeCount,
  fetchPendingTrialBookingImportCount,
  fetchStudentQuestionBadgeCount
} from "@/lib/data";
import { financialDocumentsUpdatedEvent } from "@/lib/financial-documents";
import { formatCountBadgeValue } from "@/lib/navigation-badges";
import {
  canManageFinancialDocuments,
  canManageOfficeTodos,
  canManageStudentQuestions,
  canManageTrialLessons,
  getHighestRole,
  getVisibleNavigation,
  roleLabels
} from "@/lib/roles";
import { officeTodosUpdatedEvent } from "@/lib/office-todos";
import { studentQuestionsUpdatedEvent } from "@/lib/student-questions";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function AdminShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { configured, loading, profile, profileError, session, signOut } = useAuth();
  const navigation = getVisibleNavigation(profile);
  const highestRole = getHighestRole(profile);
  const mayManageFinancialDocuments = canManageFinancialDocuments(profile);
  const mayManageOfficeTodos = canManageOfficeTodos(profile);
  const mayManageStudentQuestions = canManageStudentQuestions(profile);
  const mayManageTrialLessons = canManageTrialLessons(profile);
  const isTrialLessonsListPage = pathname === "/trial-lessons" || pathname === "/trial-lessons/";
  const [pendingTrialBookingCount, setPendingTrialBookingCount] = useState(0);
  const [financialDocumentCount, setFinancialDocumentCount] = useState(0);
  const [officeTodoCount, setOfficeTodoCount] = useState(0);
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
        setFinancialDocumentCount(0);
        setOfficeTodoCount(0);
        setStudentQuestionCount(0);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setPendingTrialBookingCount(0);
        setFinancialDocumentCount(0);
        setOfficeTodoCount(0);
        setStudentQuestionCount(0);
        return;
      }

      const [pendingTrialBookings, dueQuestions, pendingFinancialDocuments, openTodos] = await Promise.all([
        mayManageTrialLessons
          ? fetchPendingTrialBookingImportCount(supabase, { reviewStatus: "needs_action" })
          : { count: 0, error: null },
        mayManageStudentQuestions ? fetchStudentQuestionBadgeCount(supabase) : { count: 0, error: null },
        mayManageFinancialDocuments ? fetchFinancialDocumentBadgeCount(supabase) : { count: 0, error: null },
        mayManageOfficeTodos ? fetchOfficeTodoBadgeCount(supabase) : { count: 0, error: null }
      ]);

      if (!active) return;

      if (!pendingTrialBookings.error) {
        setPendingTrialBookingCount(pendingTrialBookings.count || 0);
      }

      if (!dueQuestions.error) {
        setStudentQuestionCount(dueQuestions.count || 0);
      }

      if (!pendingFinancialDocuments.error) {
        setFinancialDocumentCount(pendingFinancialDocuments.count || 0);
      }

      if (!openTodos.error) {
        setOfficeTodoCount(openTodos.count || 0);
      }
    }

    loadNavigationBadgeCounts();
    window.addEventListener(studentQuestionsUpdatedEvent, loadNavigationBadgeCounts);
    window.addEventListener(financialDocumentsUpdatedEvent, loadNavigationBadgeCounts);
    window.addEventListener(officeTodosUpdatedEvent, loadNavigationBadgeCounts);

    return () => {
      active = false;
      window.removeEventListener(studentQuestionsUpdatedEvent, loadNavigationBadgeCounts);
      window.removeEventListener(financialDocumentsUpdatedEvent, loadNavigationBadgeCounts);
      window.removeEventListener(officeTodosUpdatedEvent, loadNavigationBadgeCounts);
    };
  }, [mayManageFinancialDocuments, mayManageOfficeTodos, mayManageStudentQuestions, mayManageTrialLessons, pathname, session]);

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
            if (item.href === "/expenses/financial-docs/") {
              badgeValue = formatCountBadgeValue(financialDocumentCount);
            }
            if (item.href === "/todo/") {
              badgeValue = formatCountBadgeValue(officeTodoCount);
            }

            return (
              <Link
                className={`nav-link ${isNavigationItemActive(pathname, item.href) ? "active" : ""}`}
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
        <div className={isTrialLessonsListPage ? "content content-wide" : "content"}>{children}</div>
      </main>
    </div>
  );
}

function isNavigationItemActive(pathname, href) {
  const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (href === "/expenses/") {
    return (
      normalizedPath === "/expenses/" ||
      normalizedPath.startsWith("/expenses/new/") ||
      normalizedPath.startsWith("/expenses/detail/") ||
      normalizedPath.startsWith("/expenses/recurring/")
    );
  }

  return normalizedPath === href || normalizedPath.startsWith(href);
}
