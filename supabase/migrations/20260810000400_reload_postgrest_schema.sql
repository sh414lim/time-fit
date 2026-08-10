-- Make newly added timefit_user_* relations available to PostgREST and Edge clients.
select pg_notify('pgrst', 'reload schema');
