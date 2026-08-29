"use client";

import { AdminShell } from "@/components/AdminShell";

export default function ProtectedLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}
