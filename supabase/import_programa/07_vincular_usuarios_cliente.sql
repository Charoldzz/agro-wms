-- ============================================================
-- 07 · RE-VINCULAR USUARIOS CLIENTE con sus empresas importadas
-- Necesario porque la limpieza desvinculo los perfiles.
-- Sin esto, el cliente entra al portal y no ve nada.
-- ============================================================
begin;

-- adilsonsp  ->  ADILSON SABEC PERES (almacen 41 del programa)
update public.profiles p
set client_id = c.id
from public.clients c
where c.solucion_codigo = 41
  and p.role::text = 'cliente'
  and p.full_name = 'adilsonsp';

-- Maxiagro SRL  ->  MAXIAGRO SRL (almacen 44 del programa)
update public.profiles p
set client_id = c.id
from public.clients c
where c.solucion_codigo = 44
  and p.role::text = 'cliente'
  and p.full_name = 'Maxiagro SRL';

commit;

-- Verificacion: los dos clientes reales deben quedar con su empresa.
-- SCRANTON queda sin empresa a proposito (es el usuario de prueba).
select
  p.role::text as rol,
  p.full_name  as nombre,
  coalesce(c.name, '(SIN EMPRESA ASIGNADA)') as empresa,
  (select count(*) from public.lots l where l.client_id = p.client_id) as lotes_que_vera
from public.profiles p
left join public.clients c on c.id = p.client_id
order by p.role::text, p.full_name;
