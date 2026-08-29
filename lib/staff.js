export const staffEmploymentTypes = [
  { value: "employee", label: "Employee" },
  { value: "contractor", label: "Contractor" },
  { value: "part_time", label: "Part time" },
  { value: "temporary", label: "Temporary" },
  { value: "other", label: "Other" }
];

export const staffStatuses = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "inactive", label: "Inactive" },
  { value: "ended", label: "Ended" }
];

export const staffAssignmentStatuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
];

export function createStaffFormState(staff, defaultOrganizationId = "") {
  return {
    organizationId: staff?.organization_id || defaultOrganizationId || "",
    profileId: staff?.profile_id || "",
    legalName: staff?.legal_name || "",
    displayName: staff?.display_name || "",
    address: staff?.address || "",
    phone: staff?.phone || "",
    email: staff?.email || "",
    employmentType: staff?.employment_type || "employee",
    employmentStartDate: toDateInput(staff?.employment_start_date),
    employmentEndDate: toDateInput(staff?.employment_end_date),
    status: staff?.status || "active",
    notes: staff?.notes || ""
  };
}

export function buildStaffAssignmentRows(schools = [], staff = null, organizationId = "") {
  const assignments = new Map(
    (staff?.staff_school_assignments || []).map((assignment) => [assignment.school_id, assignment])
  );

  return schools
    .filter((school) => {
      const schoolOrganizationId = school.organization_id || school.organizations?.id || "";
      return !organizationId || schoolOrganizationId === organizationId;
    })
    .map((school) => {
      const assignment = assignments.get(school.id);

      return {
        schoolId: school.id,
        organizationId: school.organization_id || school.organizations?.id || "",
        schoolName: school.name || "Unnamed school",
        organizationName: school.organizations?.name || "",
        assigned: Boolean(assignment),
        canTeach: Boolean(assignment?.can_teach),
        status: assignment?.status || "active",
        startDate: toDateInput(assignment?.start_date),
        endDate: toDateInput(assignment?.end_date)
      };
    });
}

export function serializeStaffAssignments(rows = []) {
  return rows
    .filter((row) => row.assigned)
    .map((row) => ({
      school_id: row.schoolId,
      can_teach: Boolean(row.canTeach),
      status: row.status || "active",
      start_date: normalizeText(row.startDate),
      end_date: normalizeText(row.endDate)
    }));
}

export function formatStaffName(staff) {
  return staff?.display_name || staff?.legal_name || staff?.profiles?.full_name || staff?.profiles?.email || "Unnamed staff member";
}

export function formatStaffAssignmentSummary(staff) {
  const assignments = staff?.staff_school_assignments || [];
  if (!assignments.length) return "No schools assigned";

  return assignments
    .map((assignment) => {
      const school = assignment.schools?.name || "Unknown school";
      const teaching = assignment.can_teach ? "Teacher" : "Non-teaching";
      const status = assignment.status && assignment.status !== "active" ? `, ${humanize(assignment.status)}` : "";
      return `${school} (${teaching}${status})`;
    })
    .join(", ");
}

export function hasTeachingAssignment(staff) {
  return (staff?.staff_school_assignments || []).some(
    (assignment) => assignment.can_teach && assignment.status === "active"
  );
}

export function validateStaffForm(form, assignmentRows = []) {
  if (!form.organizationId) return "Organization is required.";
  if (!form.legalName.trim()) return "Legal name is required.";

  const selectedAssignments = assignmentRows.filter((row) => row.assigned);
  for (const assignment of selectedAssignments) {
    if (assignment.startDate && assignment.endDate && assignment.endDate < assignment.startDate) {
      return "Assignment end date cannot be before the start date.";
    }
  }

  if (form.employmentStartDate && form.employmentEndDate && form.employmentEndDate < form.employmentStartDate) {
    return "Employment end date cannot be before the start date.";
  }

  return "";
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

function humanize(value) {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
