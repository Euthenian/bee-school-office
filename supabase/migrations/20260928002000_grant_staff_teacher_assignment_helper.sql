grant execute on function public.has_active_staff_teacher_assignment(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
