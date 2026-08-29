grant execute on function public.validate_payroll_entry_scope(public.payroll_periods, public.staff) to authenticated;

notify pgrst, 'reload schema';
