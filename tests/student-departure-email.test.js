import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261015001000_student_departure_confirmation_email.sql", import.meta.url), "utf8");
const manager = readFileSync(new URL("../components/CommunicationTemplateManager.js", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/StudentTemplateComposer.js", import.meta.url), "utf8");

test("departure template preserves the approved Japanese wording and separate month variables", () => {
  assert.match(migration, /'student_departure_confirmation', 'Student Departure Confirmation & Thank You'/);
  assert.match(migration, /Bee School — 退会手続きのご確認とお礼/);
  assert.match(migration, /最終レッスン月は\{\{departure_month\}\}となり、月謝のお引き落としも\{\{last_billing_month\}\}をもって終了いたします。/);
  assert.match(migration, /array\['student_greeting_name', 'departure_month', 'last_billing_month'\]/);
  assert.match(migration, /extract\(year from new\.final_lesson_date\)/);
  assert.match(migration, /extract\(year from new\.final_billing_month\)/);
  assert.match(migration, /regexp_replace\(coalesce\(v_name, ''\)/);
});

test("an inserted departure event queues at most one existing Resend action", () => {
  assert.match(migration, /after insert on public\.student_departure_confirmations/);
  assert.match(migration, /'student_departure_confirmation:' \|\| new\.id::text/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing returning id into v_communication_id/);
  assert.match(migration, /v_key \|\| ':resend_send'/);
  assert.match(migration, /'resend', 'send_email'/);
  assert.match(migration, /'automated', 'queued', 'resend'/);
  assert.doesNotMatch(migration, /cron\.schedule|create.*cron|http_post/i);
});

test("missing recipient or rendering failure creates an attention record without an action", () => {
  assert.match(migration, /No valid email recipient/);
  assert.match(migration, /exception when others then\s+v_error := sqlerrm/);
  assert.match(migration, /if v_error is not null then[\s\S]*delivery_status[\s\S]*return new;/);
  assert.match(migration, /'skipped'::public\.communication_delivery_status/);
  assert.match(migration, /'failed'::public\.communication_delivery_status/);
});

test("correction skips an unclaimed email and requires review of sent mail", () => {
  assert.match(migration, /after update on public\.student_departure_confirmations/);
  assert.match(migration, /v_action\.status = 'pending' and v_action\.claim_token is not null/);
  assert.match(migration, /set status = 'skipped', error_message = 'Departure confirmation was voided before delivery.'/);
  assert.match(migration, /'correction_requires_review', delivery_status = 'sent'/);
});

test("template stays editable but is excluded from manual Send", () => {
  assert.match(manager, /const departureVariables = \["student_greeting_name", "departure_month", "last_billing_month"\]/);
  assert.match(composer, /template\.template_key !== "student_departure_confirmation"/);
  assert.match(migration, /if p_template_key = 'student_departure_confirmation' then\s+raise exception 'Departure confirmation email is sent only by Confirm Departure\.'/);
});
