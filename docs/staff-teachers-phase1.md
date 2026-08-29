# Staff / Teachers Phase 1

Bee School Office separates login authorization from employment and teaching operations.

- `profiles` stores the Supabase Auth-backed system identity.
- `organization_memberships` and `school_memberships` store Office authorization roles.
- `staff` stores the HR/employment identity for a person.
- `staff_school_assignments` stores the schools where that staff member works and whether the assignment can teach.

Teacher dropdown eligibility is not based on `school_memberships.role = 'teacher'`. A teacher option is an active `staff` record with an active assignment to the selected active school, `can_teach = true`, and a linked active `profiles.id`. The profile must still have a `school_memberships` row for that school because the existing `classes.assigned_teacher_profile_id` and `trial_lessons.assigned_teacher_profile_id` foreign keys still point at profile IDs with school membership.

The `school_memberships` table remains the authorization model. Its uniqueness is preserved and a manager can also be teaching-capable through `staff_school_assignments.can_teach`.

My Number, payroll, expenses, and billing data are intentionally not stored in `staff`. Future payroll work must use a separate restricted data model with separate access controls before collecting legally sensitive tax identifiers.
