export const roles = [
  "super_admin",
  "franchise_owner",
  "school_manager",
  "office_staff",
  "teacher"
];

export const roleLabels = {
  super_admin: "Super Admin",
  franchise_owner: "Franchise Owner",
  school_manager: "School Manager",
  office_staff: "Office Staff",
  teacher: "Teacher"
};

export const navigationItems = [
  {
    href: "/dashboard/",
    label: "Dashboard",
    roles
  },
  {
    href: "/students/",
    label: "Students",
    roles
  },
  {
    href: "/questions/",
    label: "Questions",
    roles: ["super_admin", "franchise_owner", "school_manager", "office_staff"]
  },
  {
    href: "/trial-lessons/",
    label: "Trial Lessons",
    roles
  },
  {
    href: "/schools/",
    label: "Schools",
    roles: ["super_admin", "franchise_owner", "school_manager", "office_staff"]
  },
  {
    href: "/staff/",
    label: "Staff",
    roles: ["super_admin", "franchise_owner", "school_manager", "office_staff"]
  },
  {
    href: "/finance/",
    label: "Finance",
    roles: ["super_admin"]
  },
  {
    href: "/payroll/",
    label: "Payroll",
    roles: ["super_admin"]
  },
  {
    href: "/billing/",
    label: "Billing",
    roles: ["super_admin"]
  },
  {
    href: "/expenses/",
    label: "Expenses",
    roles: ["super_admin"]
  },
  {
    href: "/users/",
    label: "Users",
    roles: ["super_admin", "franchise_owner", "school_manager"]
  },
  {
    href: "/settings/",
    label: "Settings",
    roles: ["super_admin", "franchise_owner", "school_manager"]
  }
];

export function getRoleSet(profile) {
  const roleSet = new Set();

  for (const membership of profile?.organization_memberships || []) {
    if (membership?.role) roleSet.add(membership.role);
  }

  for (const membership of profile?.school_memberships || []) {
    if (membership?.role) roleSet.add(membership.role);
  }

  return roleSet;
}

export function getHighestRole(profile) {
  const roleSet = getRoleSet(profile);
  return roles.find((role) => roleSet.has(role)) || "";
}

export function getVisibleNavigation(profile) {
  const roleSet = getRoleSet(profile);

  if (!roleSet.size) {
    return navigationItems.filter((item) => item.href === "/dashboard/");
  }

  return navigationItems.filter((item) => item.roles.some((role) => roleSet.has(role)));
}

export function canCreateStudents(profile) {
  const roleSet = getRoleSet(profile);
  return ["super_admin", "franchise_owner", "school_manager", "office_staff"].some((role) => roleSet.has(role));
}

export function canManageTrialLessons(profile) {
  return canCreateStudents(profile);
}

export function canManageStudentQuestions(profile) {
  return canCreateStudents(profile);
}

export function canManageAiEigoInvitations(profile) {
  return canCreateStudents(profile);
}

export function canManageCommunications(profile) {
  return canCreateStudents(profile);
}

export function canManageStaff(profile) {
  return canCreateStudents(profile);
}

export function canManagePayroll(profile) {
  return getRoleSet(profile).has("super_admin");
}

export function canManageBilling(profile) {
  return getRoleSet(profile).has("super_admin");
}

export function canManageExpenses(profile) {
  return getRoleSet(profile).has("super_admin");
}

export function canManageFinance(profile) {
  return getRoleSet(profile).has("super_admin");
}
