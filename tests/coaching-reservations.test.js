import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL(
  '../supabase/migrations/20261005002000_internal_coaching_reservations.sql', import.meta.url
), 'utf8');

test('database constraint arbitrates overlapping confirmed reservations', () => {
  assert.match(sql, /create extension if not exists btree_gist/i);
  assert.match(sql, /exclude using gist\s*\(\s*staff_id with =,\s*tstzrange\(starts_at, ends_at, '\[\)'\) with &&\s*\) where \(status = 'confirmed'\)/i);
  assert.match(sql, /ends_at = starts_at \+ interval '30 minutes'/i);
  assert.match(sql, /unique \(source, request_key\)/i);
});

test('reservation RPC rechecks live facts and maps an exclusion conflict', () => {
  assert.match(sql, /create function public\.reserve_internal_coaching_slot\(/);
  assert.match(sql, /perform public\.lock_coaching_staff_schedule\(p_staff_id\)/);
  assert.match(sql, /v_state = public\.internal_coaching_slot_state\(/);
  assert.match(sql, /exception when exclusion_violation then\s*return jsonb_build_object\('status', 'slot_unavailable'\)/);
  assert.match(sql, /on conflict \(source, request_key\) do nothing/);
  assert.match(sql, /return 'unresolved_occupancy'/);
  assert.match(sql, /trial_lessons tl/);
  assert.match(sql, /trial_package_lessons tpl/);
  assert.match(sql, /student_billing_profiles sbp/);
  assert.match(sql, /staff_availability_blocks b/);
});

test('Bee scheduling and duration writes share the conflict guard', () => {
  for (const table of ['trial_lessons', 'trial_package_lessons', 'trial_packages',
    'classes', 'student_enrollments', 'student_billing_profiles', 'billing_plans']) {
    assert.match(sql, new RegExp(`create (?:constraint )?trigger coaching_guard_[\\s\\S]*?on public\\.${table}`));
  }
  assert.match(sql, /deferrable initially deferred/);
  assert.match(sql, /raise exception 'Bee lesson overlaps a confirmed Coaching reservation\.'/);
  assert.match(sql, /raise exception 'Coach has a confirmed Coaching reservation on this date\.'/);
});

test('confirmed occupancy is read-only and direct browser writes are denied', () => {
  assert.match(sql, /get_internal_coaching_availability_with_reservations/);
  assert.match(sql, /where cr.status = 'confirmed'/);
  assert.match(sql, /revoke execute on function public\.get_internal_coaching_availability_facts\([\s\S]*?\) from authenticated/);
  assert.match(sql, /revoke all on public\.coaching_reservations from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.reserve_internal_coaching_slot[\s\S]*to authenticated, service_role/);
  assert.doesNotMatch(sql, /insert into public\.(student_payments|payroll_entries|communications|communication_integration_actions)/i);
});
