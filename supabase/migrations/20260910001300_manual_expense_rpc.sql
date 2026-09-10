create or replace function public.timefit_user_create_manual_expense(
  p_organization_id uuid, p_transaction_date date, p_total_amount bigint,
  p_supply_amount bigint default null, p_vat_amount bigint default null,
  p_merchant_name text default null, p_category text default null,
  p_reason text default null, p_staff_id uuid default null,
  p_allow_duplicate boolean default false
) returns public.timefit_user_expenses
language plpgsql security definer set search_path = public as $$
declare v_expense public.timefit_user_expenses;
begin
  if not public.timefit_user_has_membership_role(p_organization_id,array['manager']::public.timefit_user_role[]) then raise exception 'forbidden'; end if;
  if p_total_amount <= 0 then raise exception 'invalid_total_amount'; end if;
  if (p_supply_amount is null) <> (p_vat_amount is null) or (p_supply_amount is not null and p_supply_amount + p_vat_amount <> p_total_amount) then raise exception 'invalid_tax_amounts'; end if;
  if p_staff_id is not null and not exists(select 1 from public.timefit_user_staff where id=p_staff_id and organization_id=p_organization_id) then raise exception 'invalid_staff'; end if;
  if not p_allow_duplicate and exists(
    select 1 from public.timefit_user_expenses
    where organization_id=p_organization_id and transaction_date=p_transaction_date
      and total_amount=p_total_amount and status <> 'excluded'
      and lower(coalesce(merchant_name,''))=lower(coalesce(nullif(trim(p_merchant_name),''),''))
  ) then raise exception 'possible_duplicate_expense'; end if;
  insert into public.timefit_user_expenses(organization_id,transaction_date,supply_amount,vat_amount,total_amount,merchant_name,category,reason,staff_id,status,source_confidence,confirmed_by,confirmed_at,created_by)
    values(p_organization_id,p_transaction_date,p_supply_amount,p_vat_amount,p_total_amount,nullif(trim(p_merchant_name),''),nullif(trim(p_category),''),nullif(trim(p_reason),''),p_staff_id,'confirmed',1,auth.uid(),now(),auth.uid()) returning * into v_expense;
  insert into public.timefit_user_expense_sources(organization_id,expense_id,source_type,source_id,is_primary,match_reason)
    values(p_organization_id,v_expense.id,'manual',v_expense.id::text,true,jsonb_build_object('enteredBy',auth.uid()));
  insert into public.timefit_user_expense_audit_logs(organization_id,entity_type,entity_id,action,after_value,actor_id,source)
    values(p_organization_id,'expense',v_expense.id,'manual_created',to_jsonb(v_expense),auth.uid(),'user');
  return v_expense;
end $$;
revoke all on function public.timefit_user_create_manual_expense(uuid,date,bigint,bigint,bigint,text,text,text,uuid,boolean) from public;
grant execute on function public.timefit_user_create_manual_expense(uuid,date,bigint,bigint,bigint,text,text,text,uuid,boolean) to authenticated;
select pg_notify('pgrst','reload schema');
