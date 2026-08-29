"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  formatBillingAmount,
  getChargeBalance,
  getPaymentAllocatedTotal,
  getPaymentUnallocatedBalance,
  studentChargeStatuses,
  studentPaymentStatuses
} from "@/lib/billing";
import { fetchBillingManagement, fetchSchools } from "@/lib/data";
import { formatDate, formatPersonName, humanize } from "@/lib/format";
import { canManageBilling } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function BillingPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageBilling(profile);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    schoolId: "",
    search: "",
    status: "all",
    paymentStatus: "all"
  });
  const [schools, setSchools] = useState([]);
  const [state, setState] = useState({ loading: true, error: "", charges: [], payments: [] });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setSchools([]);
        setState({ loading: false, error: "", charges: [], payments: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [billingResult, schoolsResult] = await Promise.all([
        fetchBillingManagement(supabase, filters),
        fetchSchools(supabase)
      ]);
      if (!active) return;

      const loadError = [billingResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setSchools(schoolsResult.data || []);
      setState({
        loading: false,
        error: loadError,
        charges: billingResult.data?.charges || [],
        payments: billingResult.data?.payments || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, mayManage, session]);

  const outstandingStudents = useMemo(() => buildOutstandingStudents(state.charges), [state.charges]);
  const overdueCharges = useMemo(
    () => state.charges.filter((charge) => isOverdue(charge) && getChargeBalance(charge) > 0),
    [state.charges]
  );

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Billing" />
        <DataSurface>
          <EmptyState title="Billing is restricted" description="Your current role cannot access student financial records." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Billing"
        description="Review student charges, overdue balances, and recent payments without mixing owed amounts and actual receipts."
      />

      <DataSurface>
        <SurfaceHeader>
          <h2>Filters</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Search
            <input
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Student, charge, school, reference"
              type="search"
              value={filters.search}
            />
          </label>
          <label>
            School
            <select onChange={(event) => updateFilter("schoolId", event.target.value)} value={filters.schoolId}>
              <option value="">All schools</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Charge status
            <select onChange={(event) => updateFilter("status", event.target.value)} value={filters.status}>
              <option value="all">All statuses</option>
              {studentChargeStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment status
            <select onChange={(event) => updateFilter("paymentStatus", event.target.value)} value={filters.paymentStatus}>
              <option value="all">All statuses</option>
              {studentPaymentStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date from
            <input onChange={(event) => updateFilter("dateFrom", event.target.value)} type="date" value={filters.dateFrom} />
          </label>
          <label>
            Date to
            <input onChange={(event) => updateFilter("dateTo", event.target.value)} type="date" value={filters.dateTo} />
          </label>
        </div>
      </DataSurface>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Outstanding students">
        <SurfaceHeader>
          <h2>Outstanding Students</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading billing records...</div>
        ) : outstandingStudents.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>School</th>
                  <th>Open charges</th>
                  <th>Outstanding</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {outstandingStudents.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <Link href={`/students/profile/?id=${student.id}`}>{student.name}</Link>
                    </td>
                    <td>{student.schoolName}</td>
                    <td>{student.chargeCount}</td>
                    <td>{formatBillingAmount(student.outstandingBalance, student.currency)}</td>
                    <td>
                      <div className="table-actions">
                        <Link className="secondary-button" href={`/billing/charges/new/?studentId=${student.id}`}>
                          Add charge
                        </Link>
                        <Link className="secondary-button" href={`/billing/payments/new/?studentId=${student.id}`}>
                          Record payment
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No outstanding students" description="No visible students currently have an outstanding charge balance." />
        )}
      </DataSurface>

      <DataSurface aria-label="Overdue charges">
        <SurfaceHeader>
          <h2>Overdue Charges</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading overdue charges...</div>
        ) : overdueCharges.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Charge</th>
                  <th>Due</th>
                  <th>Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {overdueCharges.map((charge) => (
                  <tr key={charge.id}>
                    <td>
                      <Link href={`/students/profile/?id=${charge.student_id}`}>{formatPersonName(charge.students)}</Link>
                    </td>
                    <td>
                      <div className="table-cell-stack">
                        <strong>{charge.description}</strong>
                        <span>{humanize(charge.charge_type)}</span>
                      </div>
                    </td>
                    <td>{formatDate(charge.due_date)}</td>
                    <td>{formatBillingAmount(getChargeBalance(charge), charge.currency)}</td>
                    <td>
                      <StatusBadge value={charge.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No overdue charges" description="No visible unpaid charges are overdue for the current filters." />
        )}
      </DataSurface>

      <DataSurface aria-label="Recent payments">
        <SurfaceHeader>
          <h2>Recent Payments</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading recent payments...</div>
        ) : state.payments.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Allocated</th>
                  <th>Unallocated</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <Link href={`/students/profile/?id=${payment.student_id}`}>{formatPersonName(payment.students)}</Link>
                    </td>
                    <td>{formatDate(payment.payment_date)}</td>
                    <td>{humanize(payment.payment_method)}</td>
                    <td>{formatBillingAmount(payment.amount, payment.currency)}</td>
                    <td>{formatBillingAmount(getPaymentAllocatedTotal(payment), payment.currency)}</td>
                    <td>{formatBillingAmount(getPaymentUnallocatedBalance(payment), payment.currency)}</td>
                    <td>
                      <StatusBadge value={payment.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No recent payments" description="No visible payments match the current filters." />
        )}
      </DataSurface>
    </>
  );
}

function buildOutstandingStudents(charges) {
  const byStudent = new Map();

  for (const charge of charges) {
    if (charge.status === "void" || charge.status === "cancelled") continue;
    const balance = getChargeBalance(charge);
    if (balance <= 0) continue;

    const current = byStudent.get(charge.student_id) || {
      chargeCount: 0,
      currency: charge.currency,
      id: charge.student_id,
      name: formatPersonName(charge.students),
      outstandingBalance: 0,
      schoolName: charge.students?.schools?.name || "Unknown school"
    };

    current.chargeCount += 1;
    current.outstandingBalance += balance;
    byStudent.set(charge.student_id, current);
  }

  return [...byStudent.values()].sort((a, b) => b.outstandingBalance - a.outstandingBalance);
}

function isOverdue(charge) {
  if (!charge.due_date) return false;
  return charge.due_date < new Date().toISOString().slice(0, 10);
}
