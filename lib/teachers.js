import { formatStaffName } from "./staff.js";

export function getTeachingAssignments(staff) {
  return (staff?.staff_school_assignments || []).filter((assignment) => assignment.can_teach);
}

export function buildEligibleTeacherKeySet(eligibleTeachersBySchool = {}) {
  const keys = new Set();

  for (const [schoolId, teachers] of Object.entries(eligibleTeachersBySchool || {})) {
    for (const teacher of teachers || []) {
      if (teacher?.profile_id) {
        keys.add(`${schoolId}:${teacher.profile_id}`);
      }
    }
  }

  return keys;
}

export function hasCurrentTeacherEligibility(staff, eligibleTeacherKeys = new Set()) {
  if (!staff?.profile_id) return false;

  return getTeachingAssignments(staff).some((assignment) =>
    eligibleTeacherKeys.has(`${assignment.school_id}:${staff.profile_id}`)
  );
}

export function isTeacherStaff(staff, eligibleTeacherKeys = new Set()) {
  return getTeachingAssignments(staff).length > 0 || hasCurrentTeacherEligibility(staff, eligibleTeacherKeys);
}

export function filterTeacherStaff(staffMembers = [], filters = {}, eligibleTeacherKeys = new Set()) {
  const search = String(filters.search || "").trim().toLowerCase();

  return staffMembers
    .filter((staffMember) => isTeacherStaff(staffMember, eligibleTeacherKeys))
    .filter((staffMember) => {
      if (filters.status && filters.status !== "all" && staffMember.status !== filters.status) {
        return false;
      }

      if (filters.schoolId && filters.schoolId !== "all") {
        const teachesAtSchool = getTeachingAssignments(staffMember).some(
          (assignment) => assignment.school_id === filters.schoolId
        );
        if (!teachesAtSchool) return false;
      }

      if (!search) return true;

      return [
        formatStaffName(staffMember),
        staffMember.legal_name,
        staffMember.email,
        staffMember.phone,
        staffMember.status,
        staffMember.profiles?.email,
        staffMember.profiles?.full_name,
        getTeacherAssignmentStatusLabel(staffMember, eligibleTeacherKeys),
        ...getTeachingAssignments(staffMember).map((assignment) => assignment.schools?.name)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
}

export function formatTeacherSchools(staff) {
  const assignments = getTeachingAssignments(staff);
  if (!assignments.length) return "No teaching schools";

  return assignments
    .map((assignment) => {
      const school = assignment.schools?.name || "Unknown school";
      const status = assignment.status && assignment.status !== "active" ? `, ${humanize(assignment.status)}` : "";
      return `${school} (Can teach${status})`;
    })
    .join(", ");
}

export function getTeacherAssignmentStatusLabel(staff, eligibleTeacherKeys = new Set()) {
  if (!staff?.profile_id) return "Needs linked account";
  if (hasCurrentTeacherEligibility(staff, eligibleTeacherKeys)) return "Currently assignable";
  if (getTeachingAssignments(staff).length) return "Teaching assignment needs active membership";
  return "No teaching assignment";
}

export function getTeacherContactEmail(staff) {
  return staff?.email || staff?.profiles?.email || "";
}

export function getTeacherLinkedAccountLabel(staff) {
  if (!staff?.profile_id) return "Not linked";
  return staff.profiles?.status === "active" ? "Linked active account" : "Linked inactive account";
}

export function getTeacherClassCount(staff, classCountsByProfileId = {}) {
  if (!staff?.profile_id) return 0;
  return classCountsByProfileId[staff.profile_id] || 0;
}

function humanize(value) {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
