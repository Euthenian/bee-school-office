"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchEligibleTeachersBySchools, fetchSchools, fetchStaffMembers, fetchTeacherClassCounts } from "@/lib/data";
import { canManageStaff } from "@/lib/roles";
import { formatStaffName, staffStatuses } from "@/lib/staff";
import {
  buildEligibleTeacherKeySet,
  filterTeacherStaff,
  formatTeacherSchools,
  getTeacherAssignmentStatusLabel,
  getTeacherClassCount,
  getTeacherContactEmail,
  getTeacherLinkedAccountLabel
} from "@/lib/teachers";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function TeachersPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageStaff(profile);
  const [filters, setFilters] = useState({ search: "", schoolId: "all", status: "all" });
  const [state, setState] = useState({
    classCounts: {},
    eligibleTeachersBySchool: {},
    error: "",
    loading: true,
    schools: [],
    staff: []
  });

  useEffect(() => {
    let active = true;

    async function loadTeachers() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [staffResult, schoolsResult] = await Promise.all([fetchStaffMembers(supabase), fetchSchools(supabase)]);
      if (!active) return;

      const schools = schoolsResult.data || [];
      const staff = staffResult.data || [];
      const profileIds = staff.map((staffMember) => staffMember.profile_id).filter(Boolean);
      const [eligibleResult, classCountsResult] = await Promise.all([
        fetchEligibleTeachersBySchools(supabase, schools.map((school) => school.id)),
        fetchTeacherClassCounts(supabase, profileIds)
      ]);
      if (!active) return;

      const loadError = [staffResult.error, schoolsResult.error, eligibleResult.error, classCountsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        classCounts: classCountsResult.data || {},
        eligibleTeachersBySchool: eligibleResult.data || {},
        error: loadError,
        loading: false,
        schools,
        staff
      });
    }

    loadTeachers();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  const eligibleTeacherKeys = useMemo(
    () => buildEligibleTeacherKeySet(state.eligibleTeachersBySchool),
    [state.eligibleTeachersBySchool]
  );
  const teachers = useMemo(
    () => filterTeacherStaff(state.staff, filters, eligibleTeacherKeys),
    [eligibleTeacherKeys, filters, state.staff]
  );

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Teachers" />
        <DataSurface>
          <EmptyState
            title="Teachers are not available"
            description="Your current role can view teaching work but cannot manage staff records."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title="Teachers"
        description="Manage teaching staff through the existing staff records and school assignments."
        actions={
          <Link className="primary-button" href="/teachers/new/">
            Add teacher
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search-field">
          <span>Search teachers</span>
          <input
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Name, email, phone, school, or assignment status"
            type="search"
            value={filters.search}
          />
        </label>
        <label>
          School
          <select
            onChange={(event) => setFilters((current) => ({ ...current, schoolId: event.target.value }))}
            value={filters.schoolId}
          >
            <option value="all">All schools</option>
            {state.schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            value={filters.status}
          >
            <option value="all">All statuses</option>
            {staffStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Teachers list">
        {state.loading ? (
          <div className="table-placeholder">Loading teachers...</div>
        ) : teachers.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Schools</th>
                  <th>Teaching assignment</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Account</th>
                  <th>Current classes</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td>
                      <Link href={`/teachers/profile/?id=${teacher.id}`}>{formatStaffName(teacher)}</Link>
                    </td>
                    <td>
                      <StatusBadge value={teacher.status} />
                    </td>
                    <td>{formatTeacherSchools(teacher)}</td>
                    <td>{getTeacherAssignmentStatusLabel(teacher, eligibleTeacherKeys)}</td>
                    <td>{getTeacherContactEmail(teacher) || "No email"}</td>
                    <td>{teacher.phone || "No phone"}</td>
                    <td>{getTeacherLinkedAccountLabel(teacher)}</td>
                    <td>{getTeacherClassCount(teacher, state.classCounts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No teachers found" description="No teaching staff matched the current filters." />
        )}
      </DataSurface>
    </>
  );
}
