create or replace function public.delete_trial_lessons_mvp(p_trial_lesson_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_count integer := 0;
  v_input_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_trial_lesson_id uuid;
begin
  if p_trial_lesson_ids is null or array_length(p_trial_lesson_ids, 1) is null then
    raise exception 'Trial lesson IDs are required.';
  end if;

  v_input_count := array_length(p_trial_lesson_ids, 1);

  for v_trial_lesson_id in (
    select distinct unnest(p_trial_lesson_ids) as trial_lesson_id
  ) loop
    if v_trial_lesson_id is null then
      raise exception 'Trial lesson IDs are required.';
    end if;

    v_result := public.delete_trial_lesson_mvp(v_trial_lesson_id);
    v_results := v_results || jsonb_build_array(v_result);
    v_deleted_count := v_deleted_count + 1;
  end loop;

  return jsonb_build_object(
    'status',
    'deleted',
    'requested',
    v_input_count,
    'deleted',
    v_deleted_count,
    'results',
    v_results
  );
end;
$$;

revoke all on function public.delete_trial_lessons_mvp(uuid[]) from public, anon;
grant execute on function public.delete_trial_lessons_mvp(uuid[]) to authenticated;

notify pgrst, 'reload schema';
