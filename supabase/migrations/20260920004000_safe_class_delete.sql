create or replace function public.delete_class_mvp(p_class_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes%rowtype;
begin
  select * into v_class
  from public.classes c
  where c.id = p_class_id
  for update;

  if not found then
    raise exception 'Class % was not found.', p_class_id;
  end if;

  if not public.can_manage_school(v_class.school_id) then
    raise exception 'You do not have permission to delete this class.';
  end if;

  if exists (
    select 1
    from public.student_enrollments se
    where se.class_id = p_class_id
  ) then
    raise exception 'This class cannot be deleted because it has student enrollment history. Move/remove the students or deactivate the class instead.';
  end if;

  delete from public.classes c
  where c.id = p_class_id;

  return p_class_id;
exception
  when foreign_key_violation then
    raise exception 'This class cannot be deleted because linked history exists. Deactivate the class instead.';
end;
$$;

comment on function public.delete_class_mvp(uuid) is
'Safely deletes only unused classes. Blocks any class with student enrollment history and relies on restrictive FKs as a final safety net.';

revoke all on function public.delete_class_mvp(uuid) from public, anon;
grant execute on function public.delete_class_mvp(uuid) to authenticated;

notify pgrst, 'reload schema';
