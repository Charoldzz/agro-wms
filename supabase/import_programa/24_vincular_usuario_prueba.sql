-- ============================================================
-- 24 · VINCULAR el usuario de prueba (stock@zzz.com) a la EMPRESA DE PRUEBA
--
-- El usuario ya existe (se creo en Authentication). Falta apuntarlo a la
-- empresa ZZZ EMPRESA DE PRUEBA (codigo 999) para que su portal muestre los
-- 8 lotes de prueba. Asi el flujo de cliente (pedir, que se lo despachen o
-- rechacen, modificar/cancelar) se hace sobre datos de prueba, sin tocar
-- ninguna empresa real.
--
-- Tambien se asegura que su ROL sea 'cliente'.
-- ============================================================
begin;

update public.profiles p
set client_id = c.id,
    role      = 'cliente'
from public.clients c,
     auth.users u
where u.email = 'stock@zzz.com'
  and p.id = u.id
  and c.solucion_codigo = 999;

commit;

-- ============================================================
-- VERIFICACION — tiene que mostrar el usuario apuntando a la empresa de prueba
-- ============================================================
select
  u.email,
  p.full_name              as usuario,
  p.role::text             as rol,
  c.name                   as empresa,
  (select count(*) from public.lots l
     where l.client_id = p.client_id and l.current_quantity > 0) as lotes_que_vera  -- esperado 6
from auth.users u
join public.profiles p on p.id = u.id
left join public.clients c on c.id = p.client_id
where u.email = 'stock@zzz.com';
