update public.timefit_user_staff
set phone_last8 = right(regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g'), 8),
    phone_last4 = right(regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g'), 4),
    updated_at = now()
where (phone_last8 is null or phone_last8 !~ '^[0-9]{8}$')
  and length(regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g')) >= 8;
