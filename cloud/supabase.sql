begin;
create table if not exists public.observatorio_state (
  id text primary key check (id = 'main'),
  revision bigint not null default 0,
  manifest jsonb,
  updated_at timestamptz not null default now()
);
alter table public.observatorio_state enable row level security;
revoke all on public.observatorio_state from public, anon, authenticated;
grant select, update on public.observatorio_state to service_role;
insert into public.observatorio_state (id) values ('main') on conflict do nothing;

create or replace function public.observatorio_checkpoint(expected_revision bigint, next_manifest jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare updated_revision bigint;
begin
  if coalesce(next_manifest->>'version', '') <> '1' or coalesce(next_manifest->>'root', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_manifest';
  end if;
  update public.observatorio_state
     set revision = revision + 1, manifest = next_manifest, updated_at = now()
   where id = 'main' and revision = expected_revision
   returning revision into updated_revision;
  if updated_revision is null then raise exception 'revision_conflict'; end if;
  return updated_revision;
end;
$$;
revoke all on function public.observatorio_checkpoint(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.observatorio_checkpoint(bigint, jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('observatorio-private', 'observatorio-private', false, 16777216, array['application/octet-stream'])
on conflict (id) do update set public = false;
commit;
