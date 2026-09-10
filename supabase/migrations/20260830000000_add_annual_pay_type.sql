-- Must be committed separately before functions and constraints can reference it.
alter type public.timefit_user_pay_type add value if not exists 'annual';
