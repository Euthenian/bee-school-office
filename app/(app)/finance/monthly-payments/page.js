"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatBillingAmount } from "@/lib/billing";
import { fetchMonthlyStudentPayments } from "@/lib/data";
import { formatPersonName } from "@/lib/format";
import { createMonthlyBillingFilters, getMonthOptions, getYearOptions, syncBillingMonthFromParts } from "@/lib/monthly-billing";
import { canManageFinance } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const monthOptions = getMonthOptions();
const yearOptions = getYearOptions();

export default function MonthlyPaymentsReportPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageFinance(profile);
  const initialFilters = useMemo(() => createMonthlyBillingFilters(), []);
  const [filters, setFilters] = useState({
    billingMonth: initialFilters.billingMonth,
    month: initialFilters.month,
    year: initialFilters.year
  });
  const [state, setState] = useState({ loading: true, error: "", payments: [] });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ loading: false, error: "", payments: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchMonthlyStudentPayments(supabase, {
        billingMonth: filters.billingMonth
      });
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        payments: data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters.billingMonth, mayManage, session]);

  const rows = useMemo(() => buildStudentPaymentRows(state.payments), [state.payments]);
  const total = useMemo(() => rows.reduce((sum, row) => sum + row.amount, 0), [rows]);
  const currency = rows[0]?.currency || "JPY";

  function updateFilter(field, value) {
    setFilters((current) => {
      const next = { ...current, [field]: value };

      return {
        ...next,
        billingMonth: syncBillingMonthFromParts(next)
      };
    });
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Monthly Payments Report" />
        <DataSurface>
          <EmptyState title="Finance is restricted" description="Your current role cannot access student payment reports." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        actions={
          <Link className="secondary-button" href="/finance/">
            Finance
          </Link>
        }
        eyebrow="Restricted admin"
        title="Monthly Payments Report"
        description="Actual student payments received during the selected month."
      />

      <DataSurface>
        <SurfaceHeader>
          <h2>Report Month</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Month
            <select onChange={(event) => updateFilter("month", event.target.value)} value={filters.month}>
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select onChange={(event) => updateFilter("year", event.target.value)} value={filters.year}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      </DataSurface>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Monthly student payments">
        <SurfaceHeader>
          <h2>Student Payments</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading monthly payments...</div>
        ) : rows.length ? (
          <>
            <ResponsiveTable>
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th className="amount-column">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.studentId}>
                      <td>
                        <Link href={`/students/profile/?id=${row.studentId}`}>{row.studentName}</Link>
                      </td>
                      <td className="amount-column">{formatBillingAmount(row.amount, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
            <p className="finance-total-line">
              <strong>Total: {formatBillingAmount(total, currency)}</strong>
            </p>
          </>
        ) : (
          <EmptyState title="No payments found" description="No visible student payments were received during the selected month." />
        )}
      </DataSurface>
    </>
  );
}

function buildStudentPaymentRows(payments = []) {
  const byStudent = new Map();

  for (const payment of payments) {
    if (!payment.student_id) continue;

    const current = byStudent.get(payment.student_id) || {
      amount: 0,
      currency: payment.currency || "JPY",
      studentId: payment.student_id,
      studentName: formatPersonName(payment.students)
    };

    current.amount += Number(payment.amount || 0);
    byStudent.set(payment.student_id, current);
  }

  return [...byStudent.values()].sort((a, b) => a.studentName.localeCompare(b.studentName));
}
