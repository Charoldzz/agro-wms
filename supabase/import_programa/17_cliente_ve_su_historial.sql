-- ============================================================
-- 17 · El CLIENTE puede ver SU PROPIO historial del programa
--
-- Hasta ahora solo operadores y administradores podian leer
-- public.desktop_movements, asi que el portal del cliente mostraba
-- unicamente los movimientos hechos en la app (nada del historico).
--
-- Decision (Harold, 2026-07-19): la mercaderia es del cliente, asi que
-- tiene derecho a ver cuando entro y cuando salio lo suyo. Ademas le da
-- respaldo al stock que ya ve en su portal.
--
-- SEGURIDAD: la politica esta acotada a las filas cuyo warehouse_code
-- coincide con el codigo de almacen de SU empresa (clients.solucion_codigo).
-- Un cliente NO puede ver el historial de otro.
--
-- Nota: el campo "concept" se le oculta desde la app (trae referencias
-- tecnicas del sistema viejo, tipo "SALIDA 6021 (DBF DSALIDCA 001147)").
-- ============================================================
begin;

drop policy if exists "Clientes leen su propio historial del programa" on public.desktop_movements;

create policy "Clientes leen su propio historial del programa"
on public.desktop_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.clients c on c.id = p.client_id
    where p.id = auth.uid()
      and p.role::text = 'cliente'
      and c.solucion_codigo is not null
      and public.desktop_movements.warehouse_code = c.solucion_codigo::text
  )
);

commit;

-- ============================================================
-- VERIFICACION
-- ============================================================
-- 1) Deben figurar 3 politicas: operadores/admins leen, admins gestionan,
--    y la nueva de clientes.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'desktop_movements'
order by policyname;

-- 2) Cuantos movimientos historicos vera cada cliente que tenga usuario.
select
  c.name                                   as empresa,
  c.solucion_codigo                        as cod_almacen,
  count(d.id)                              as movimientos_que_vera
from public.profiles p
join public.clients c on c.id = p.client_id
left join public.desktop_movements d on d.warehouse_code = c.solucion_codigo::text
where p.role::text = 'cliente'
group by c.name, c.solucion_codigo
order by c.name;
