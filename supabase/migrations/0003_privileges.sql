-- Supabase defaults give API roles only truncate/references/trigger/maintain on public tables, no DML.
-- Service role: full DML on every table, now and for tables created later. anon/authenticated keep only the explicit select grants from 0001.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated, service_role;
revoke update on all sequences in schema public from anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke update on sequences from anon, authenticated;
