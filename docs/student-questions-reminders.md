# Student Questions / Reminders

Student Questions / Reminders is implemented as a small staff reminder feature.

Staff can record a question to ask a specific student on a specific date. The reminder stays visible until it is marked done.

Remote status: `student_questions` was present in the linked Supabase schema during a read-only PostgREST schema check on 2026-08-29.

## Table

`student_questions` stores:

- `id`
- `organization_id`
- `school_id`
- `student_id`
- `question`
- `reminder_date`
- `status`
- `created_by`
- `created_at`
- `completed_at`
- `updated_at`

Statuses:

- `open`
- `done`

The table has composite foreign keys to keep the student, school, and organization aligned. Deleting a question deletes only the question row; it does not delete or modify the student.

## Authorization

RLS is enabled on `student_questions`.

Authenticated access is limited by `can_manage_school(school_id)`. The UI uses `canManageStudentQuestions()`, which follows the existing school-management permission shape for super admin, franchise owner, school manager, and office staff. Teachers do not get the Questions navigation item or management UI.

No anon access is intended.

## Student Profile UI

`/students/profile/` includes a `Questions to ask` section for authorized staff.

The section shows open questions for that student and supports:

- add question
- mark done
- change reminder date
- confirmed delete

The add form requires:

- question text
- reminder date

No answer field exists in this MVP.

## Questions Page

`/questions/` lists open questions across visible schools.

Columns:

- due date
- student
- question
- school
- status
- actions

Actions:

- View student
- Mark done
- Change date
- Delete

Open questions are ordered as:

1. overdue
2. due today
3. future

Overdue rows are visually highlighted.

## Badge Behavior

The global Questions badge counts only:

```text
status = 'open'
and reminder_date <= today
```

Therefore:

- overdue open questions count
- today's open questions count
- future open questions do not count
- done questions do not count
- badge is hidden at zero

Changing the reminder date to the future removes the question from the badge on the next normal navigation refresh or local update event. There is no realtime subscription for this MVP.

## Deferred

The MVP does not include:

- answer capture
- recurring reminders
- notification emails
- SMS/push notifications
- assignment to a staff member
- automatic closing
