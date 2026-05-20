create extension if not exists "pgcrypto";

alter table public.lots
add column if not exists qr_token text;

drop index if exists public.lots_qr_token_key;

update public.lots
set qr_token = encode(gen_random_bytes(24), 'hex');

alter table public.lots
alter column qr_token set default encode(gen_random_bytes(24), 'hex');

create unique index if not exists lots_qr_token_key on public.lots(qr_token);

select
  count(*) as lotes_con_qr_nuevo
from public.lots
where qr_token is not null
  and trim(qr_token) <> '';
