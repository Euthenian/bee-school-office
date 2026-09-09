-- Historical Taiken records predate the current live booking form and can be
-- incomplete. Keep live creation strict in create_trial_lesson_mvp; relax only
-- the storage constraints needed to preserve owner-approved legacy rows.

alter table public.prospects
  alter column japanese_name drop not null;

alter table public.trial_lessons
  alter column trial_date drop not null,
  alter column trial_time drop not null,
  alter column lesson_type drop not null,
  alter column level_id drop not null,
  alter column status drop not null;

comment on column public.prospects.japanese_name is
  'Nullable only for imported historical legacy prospects. Live creation remains validated by public.create_trial_lesson_mvp.';

comment on column public.trial_lessons.trial_date is
  'Nullable only for imported historical legacy trial lessons. Live creation remains validated by public.create_trial_lesson_mvp.';

comment on column public.trial_lessons.trial_time is
  'Nullable only for imported historical legacy trial lessons. Live creation remains validated by public.create_trial_lesson_mvp.';

comment on column public.trial_lessons.lesson_type is
  'Nullable only for imported historical legacy trial lessons. Live creation remains validated by public.create_trial_lesson_mvp.';

comment on column public.trial_lessons.level_id is
  'Nullable only for imported historical legacy trial lessons. Live creation remains validated by public.create_trial_lesson_mvp.';

comment on column public.trial_lessons.status is
  'Nullable only for unresolved imported historical legacy trial lessons. The default and live creation validation are unchanged.';

notify pgrst, 'reload schema';
