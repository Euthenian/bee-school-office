# Staff / Teachers Phase 1

Bee School Office separates login authorization from employment and teaching operations.

- `profiles` stores the Supabase Auth-backed system identity.
- `organization_memberships` and `school_memberships` store Office authorization roles.
- `staff` stores the HR/employment identity for a person.
- `staff_school_assignments` stores the schools where that staff member works and whether the assignment can teach.

## Authorization Versus Teaching

Teacher dropdown eligibility is not based on `school_memberships.role = 'teacher'` as the sole source of truth.

A person can remain:

```text
school_memberships.role = school_manager
```

while also being eligible to teach through:

```text
staff_school_assignments.can_teach = true
```

The `school_memberships` table remains the authorization model. `staff_school_assignments` is the operational teaching/school-assignment model. Its uniqueness is preserved per staff/school pair, and one staff member can be assigned to multiple schools.

## Teacher Eligibility

A teacher option is returned by `school_teacher_options(p_school_id)` when all of the following are true:

- `staff.status = 'active'`
- `staff_school_assignments.status = 'active'`
- `staff_school_assignments.can_teach = true`
- assigned school is active
- linked `profiles.status = 'active'`
- assignment start/end dates include the current date when dates are present
- a linked profile exists
- the linked profile has a `school_memberships` row for the school because existing `classes.assigned_teacher_profile_id` and `trial_lessons.assigned_teacher_profile_id` foreign keys still point at profile IDs with school membership

This supports managers or office staff who can also teach without changing their application authorization role to `teacher`.

## Tables And RPCs

- `staff`
- `staff_school_assignments`
- `create_staff_member_mvp`
- `update_staff_member_mvp`
- `school_teacher_options`
- `has_active_staff_teacher_assignment`
- `ensure_class_teacher_membership`
- `ensure_trial_lesson_teacher_membership`

Current HR fields include legal name, display name, optional linked profile, address, phone, email, employment type, employment start/end dates, staff status, notes, and school assignments. Employment types are `employee`, `contractor`, `part_time`, `temporary`, and `other`. Staff statuses are `active`, `inactive`, `on_leave`, and `ended`. Assignment statuses are `active` and `inactive`.

## Routes

- `/staff/`
- `/staff/new/`
- `/staff/profile/`
- `/staff/edit/`

Teacher dropdown integration is used by student/class assignment workflows and Trial Lesson workflows through the shared `fetchSchoolTeachers()` helper.

## Boundaries

My Number, payroll, expenses, and billing data are intentionally not stored in `staff`. Payroll, billing, and expenses use separate restricted models. Future legally sensitive tax identifiers require a separate restricted My Number architecture rather than generic Staff fields or queries.
