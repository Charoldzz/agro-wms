-- ═══════════════════════════════════════════════════════════════════════
--  EL KARDEX, CALCULADO EN LA BASE
-- ═══════════════════════════════════════════════════════════════════════
-- Hasta ahora la pantalla se traía todos los movimientos y sacaba la cuenta
-- en el navegador. Eso trajo tres problemas, los tres confirmados con datos
-- reales del depósito:
--
--   1. SALDOS NEGATIVOS
--      La base devuelve como mucho 1.000 filas por pedido, sin importar lo
--      que pida la pantalla. A las empresas con más de 1.000 movimientos
--      (UPL BOLIVIA 1.801 y MAXIAGRO 1.007) les faltaban los más viejos
--      —los inventarios iniciales del 1 de enero— y la cuenta arrancaba de
--      cero a mitad de la historia. 85 combinaciones de producto y lote
--      quedaban con saldo negativo, que en un depósito es imposible.
--
--   2. GRAMOS Y MILILITROS 1.000 VECES MÁS CHICOS
--      El programa guarda kg y lt; la app guarda gr y ml para esos productos.
--      La pantalla mezclaba las dos escalas: MATAPOL X 500 GRS mostraba
--      "3,46 kgs" donde en realidad hay 3.458 kgs, y una salida de 4 kgs
--      aparecía como "0 kgs". Son 124 movimientos de 22 lotes.
--
--   3. LAS DOS TECNOMYL MEZCLADAS
--      Los movimientos del programa se filtraban por el prefijo de la
--      empresa, y TECNOMYL S.A y TECNOMYL (REPROCESO) comparten el prefijo
--      TCML: cada una veía los movimientos de la otra. Acá la empresa se
--      resuelve por el lote, que sí pertenece a una sola.
--
-- De ahora en más la base arma el libro ya normalizado y con el saldo hecho,
-- y la pantalla baja solamente la página que muestra.
--
-- Esto NO toca ni un dato: son funciones y vistas de lectura.
-- Se puede correr las veces que haga falta.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. El lote verdadero ───────────────────────────────────────────────
-- Los lotes de la app guardan un código armado
-- (SOL-MAXI-00003-44-20250628-2027-06-28) donde el lote de fábrica va en el
-- medio. El programa, en cambio, ya guarda el lote limpio (20250628).
-- Para que los dos orígenes caigan en la misma cuenta hay que leer el
-- verdadero de los dos lados. Es la misma regla que usa la app en
-- src/lib/display.js, comprobada contra los 759 lotes: da idéntico.
create or replace function public.lote_real(p_codigo text)
returns text
language sql
immutable
as $$
  with c as (
    select btrim(coalesce(p_codigo, '')) as v
  ),
  extraido as (
    select
      c.v,
      coalesce(
        -- SOL-<numero>-<numero>-<LOTE>-<vencimiento>
        substring(c.v from '(?i)^SOL-[0-9]+-[0-9]+-(.+)-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
        -- SOL-<PREFIJO>-<codigo>-<almacen>-<LOTE>-<vencimiento o SINVEN>
        substring(c.v from '(?i)^SOL-[A-Za-z0-9]+-[0-9]+-[0-9]+-(.+?)-(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|SINVEN)$')
      ) as lote
    from c
  )
  select case
    when v = ''                                         then 'SIN LOTE'
    when lote is not null and btrim(lote) ~* '^SIN-?LOTE$' then 'SIN LOTE'
    when lote is not null                               then btrim(lote)
    when v ~* '^SIN-?LOTE'                              then 'SIN LOTE'
    when v ~* '^(EXCEL-[0-9]+-|SOL-|AUTO-|Codigo[[:space:]]+[0-9]+)' then 'SIN LOTE'
    when v like '%-LOTE-%' then
      case when split_part(v, '-LOTE-', 2) ~* '^SIN-?LOTE'
           then 'SIN LOTE'
           else split_part(v, '-LOTE-', 2)
      end
    else v
  end
  from extraido;
$$;

comment on function public.lote_real(text) is
  'Devuelve el lote de fábrica a partir del código de lote, venga del programa o de la app.';


-- ── 2. El libro: los dos orígenes en una sola lista ────────────────────
-- Todas las cantidades quedan en la MISMA unidad en que la app guarda el
-- stock (el "equivalente"): litros, kilos, gramos o mililitros según el
-- producto. Así el saldo se puede comparar contra lots.current_quantity.
--
-- Ojo con los JOIN: son todos LEFT a propósito. Si mañana falta una ficha
-- de catálogo, el movimiento tiene que seguir apareciendo —con la unidad
-- que se pueda deducir— y nunca desaparecer de la lista.
drop view if exists public.kardex_libro;
create view public.kardex_libro as

-- 2.a Movimientos del programa de escritorio
select
  'programa-' || dm.id::text                       as id,
  dm.id::bigint                                    as orden,
  'programa'::text                                 as origen,
  l.client_id                                      as client_id,
  coalesce(l.product, dm.product_name)             as producto,
  public.lote_real(dm.lot)                         as lote,
  dm.product_code                                  as clave_producto,
  -- Se pasa por lote_real igual que del lado de la app: el programa ya guarda
  -- el lote limpio, pero cuando viene vacío los dos lados tienen que quedar
  -- en 'SIN LOTE' para caer en la misma cuenta.
  upper(public.lote_real(dm.lot))                  as clave_lote,
  coalesce(nullif(btrim(pc.package_unit), ''), l.package_unit) as unidad,
  dm.date                                          as fecha,
  dm.note_number                                   as nota,
  case when dm.type = 'INGRESO' then 'entrada' else 'salida' end as tipo,
  -- Acá se corrige la escala: el programa anota kg/lt, la app gr/ml.
  dm.quantity * case
    when lower(coalesce(nullif(btrim(pc.package_unit), ''), l.package_unit, '')) in ('gr', 'ml', 'cc')
      then 1000
    else 1
  end                                              as cantidad,
  case when dm.type = 'INGRESO' then 1 else -1 end as signo,
  dm.concept                                       as detalle
from public.desktop_movements dm
-- La empresa y la presentación salen del lote, no del prefijo: por eso las
-- dos TECNOMYL ya no se mezclan. Ningún código de producto se repite entre
-- empresas (comprobado sobre los 4.214 movimientos).
left join lateral (
  select lo.client_id, lo.product, lo.package_unit
  from public.lots lo
  where lo.solucion_product_code = dm.product_code
  order by (lo.package_unit is null), lo.id   -- primero uno que tenga unidad
  limit 1
) l on true
left join public.product_catalog pc on pc.code = dm.product_code

union all

-- 2.b Movimientos cargados desde la app
select
  'app-' || m.id::text                             as id,
  0::bigint                                        as orden,
  'app'::text                                      as origen,
  lo.client_id                                     as client_id,
  lo.product                                       as producto,
  public.lote_real(lo.lot_code)                    as lote,
  coalesce(lo.solucion_product_code, upper(lo.product)) as clave_producto,
  upper(public.lote_real(lo.lot_code))             as clave_lote,
  lo.package_unit                                  as unidad,
  m.created_at                                     as fecha,
  op.guide_number                                  as nota,
  m.type::text                                     as tipo,
  abs(d.delta)                                     as cantidad,
  case when d.delta < 0 then -1 else 1 end         as signo,
  m.notes                                          as detalle
from public.movements m
join public.lots lo on lo.id = m.lot_id
left join public.warehouse_operations op on op.id = m.operation_id
-- Lo que de verdad le pasó al lote es la diferencia entre lo que había y lo
-- que quedó. NO se puede usar `quantity` a secas: en un ajuste esa columna
-- guarda el TOTAL que queda, no el cambio (un ajuste de 2.000 a 2.100 guarda
-- quantity = 2100, cuando el movimiento es de 100). Con la diferencia sale
-- bien para todos los tipos, y además el traspaso y el fraccionamiento
-- quedan con la dirección correcta sin preguntar por el tipo.
cross join lateral (
  select coalesce(
    m.new_quantity - m.previous_quantity,
    m.quantity * case when m.type::text = 'salida' then -1 else 1 end
  ) as delta
) d;

-- La vista es de uso interno: a la app se le habla por las funciones de
-- abajo, que son las que revisan el rol.
revoke all on public.kardex_libro from anon, authenticated;


-- ── 3. Quién puede ver qué ─────────────────────────────────────────────
create or replace function public.kardex_permitido(p_client_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_rol     text;
  v_cliente uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select p.role::text, p.client_id
    into v_rol, v_cliente
  from public.profiles p
  where p.id = auth.uid();

  if v_rol is null then
    raise exception 'Tu usuario no tiene un perfil cargado.';
  end if;

  -- El administrador y el operador ven cualquier empresa; el cliente,
  -- solamente la suya.
  if v_rol = 'cliente'
     and (v_cliente is null or v_cliente is distinct from p_client_id) then
    raise exception 'No podés ver el kardex de otra empresa.';
  end if;
end;
$$;


-- ── 4. Una página del kardex, con el saldo ya calculado ────────────────
-- El saldo se calcula SIEMPRE sobre toda la historia de la empresa, aunque
-- después se muestre una página o se filtre por producto. Por eso ya no
-- depende de cuántas filas alcance a bajar el navegador.
-- Se devuelve tambien `signo` (+1 o -1): un traspaso o un fraccionamiento no
-- es entrada ni salida del deposito, pero al lote le suma o le resta, y la
-- pantalla tiene que poder mostrar cuanto se movio y para que lado.
drop function if exists public.kardex_pagina(uuid, text, integer, integer);
create function public.kardex_pagina(
  p_client_id uuid,
  p_busqueda  text default null,
  p_limite    integer default 300,
  p_desde     integer default 0
)
returns table (
  id       text,
  origen   text,
  fecha    timestamptz,
  nota     text,
  tipo     text,
  producto text,
  lote     text,
  unidad   text,
  cantidad numeric,
  signo    integer,
  saldo    numeric,
  detalle  text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_q text := nullif(btrim(coalesce(p_busqueda, '')), '');
begin
  perform public.kardex_permitido(p_client_id);

  return query
  with libro as (
    select
      k.*,
      sum(k.cantidad * k.signo) over (
        partition by k.clave_producto, k.clave_lote
        order by k.fecha, k.origen, k.orden, k.id
        rows between unbounded preceding and current row
      ) as saldo_corrido
    from public.kardex_libro k
    where k.client_id = p_client_id
  )
  select
    b.id,
    b.origen,
    b.fecha,
    b.nota,
    b.tipo,
    b.producto,
    b.lote,
    b.unidad,
    b.cantidad,
    b.signo,
    b.saldo_corrido,
    b.detalle
  from libro b
  where v_q is null
     or b.producto ilike '%' || v_q || '%'
     or b.lote     ilike '%' || v_q || '%'
     or b.nota     ilike '%' || v_q || '%'
     or b.detalle  ilike '%' || v_q || '%'
  order by b.fecha desc, b.origen desc, b.orden desc, b.id desc
  limit  greatest(coalesce(p_limite, 300), 1)
  offset greatest(coalesce(p_desde, 0), 0);
end;
$$;


-- ── 5. El resumen, y el control de que la cuenta cierra ────────────────
-- Además de los totales, esta función compara el saldo final de cada
-- producto y lote contra el stock que hay hoy en la app. Si no coinciden,
-- la pantalla lo avisa en vez de mostrar un número equivocado en silencio.
-- Esto es justo lo que faltaba: el saldo estuvo mal y nada lo dijo.
create or replace function public.kardex_resumen(
  p_client_id uuid,
  p_busqueda  text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_q          text := nullif(btrim(coalesce(p_busqueda, '')), '');
  v_movs       integer;
  v_entradas   jsonb;
  v_salidas    jsonb;
  v_descuadres jsonb;
begin
  perform public.kardex_permitido(p_client_id);

  -- Totales de lo que sí cruzó la puerta del depósito. Un traspaso o un
  -- fraccionamiento no cuenta como entrada ni como salida.
  with filtrado as (
    select k.*
    from public.kardex_libro k
    where k.client_id = p_client_id
      and (v_q is null
        or k.producto ilike '%' || v_q || '%'
        or k.lote     ilike '%' || v_q || '%'
        or k.nota     ilike '%' || v_q || '%'
        or k.detalle  ilike '%' || v_q || '%')
  ),
  totales as (
    select f.tipo, coalesce(f.unidad, '') as unidad, sum(f.cantidad) as total
    from filtrado f
    where f.tipo in ('entrada', 'salida')
    group by f.tipo, coalesce(f.unidad, '')
  )
  select
    (select count(*)::integer from filtrado),
    (select coalesce(jsonb_agg(jsonb_build_object('unidad', t.unidad, 'valor', round(t.total, 3))), '[]'::jsonb)
       from totales t where t.tipo = 'entrada'),
    (select coalesce(jsonb_agg(jsonb_build_object('unidad', t.unidad, 'valor', round(t.total, 3))), '[]'::jsonb)
       from totales t where t.tipo = 'salida')
  into v_movs, v_entradas, v_salidas;

  -- El control de cuadre va sobre TODA la empresa, sin el filtro de búsqueda:
  -- lo que importa es si el libro entero cierra contra el stock de hoy.
  with saldo_final as (
    select
      k.clave_producto,
      k.clave_lote,
      max(k.producto)           as producto,
      max(k.lote)               as lote,
      max(k.unidad)             as unidad,
      sum(k.cantidad * k.signo) as segun_movimientos
    from public.kardex_libro k
    where k.client_id = p_client_id
    group by k.clave_producto, k.clave_lote
  ),
  stock_hoy as (
    select
      coalesce(lo.solucion_product_code, upper(lo.product)) as clave_producto,
      upper(public.lote_real(lo.lot_code))                  as clave_lote,
      sum(lo.current_quantity)                              as stock
    from public.lots lo
    where lo.client_id = p_client_id
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto',          s.producto,
           'lote',              s.lote,
           'unidad',            s.unidad,
           'segun_movimientos', round(s.segun_movimientos, 3),
           'stock_actual',      round(coalesce(h.stock, 0), 3),
           'diferencia',        round(s.segun_movimientos - coalesce(h.stock, 0), 3)
         ) order by abs(s.segun_movimientos - coalesce(h.stock, 0)) desc), '[]'::jsonb)
    into v_descuadres
  from saldo_final s
  left join stock_hoy h
    on  h.clave_producto = s.clave_producto
    and h.clave_lote     = s.clave_lote
  where abs(s.segun_movimientos - coalesce(h.stock, 0)) > 0.01;

  return jsonb_build_object(
    'movimientos', coalesce(v_movs, 0),
    'entradas',    coalesce(v_entradas, '[]'::jsonb),
    'salidas',     coalesce(v_salidas, '[]'::jsonb),
    'descuadres',  coalesce(v_descuadres, '[]'::jsonb)
  );
end;
$$;


-- ── 6. Permisos ────────────────────────────────────────────────────────
revoke all on function public.kardex_pagina(uuid, text, integer, integer) from public;
revoke all on function public.kardex_resumen(uuid, text) from public;
revoke all on function public.kardex_permitido(uuid) from public;

grant execute on function public.kardex_pagina(uuid, text, integer, integer) to authenticated;
grant execute on function public.kardex_resumen(uuid, text) to authenticated;
grant execute on function public.lote_real(text) to authenticated;


-- ── 7. Índices, para que no se ponga lenta ─────────────────────────────
create index if not exists desktop_movements_product_code_idx
  on public.desktop_movements (product_code);
create index if not exists desktop_movements_date_idx
  on public.desktop_movements (date);
create index if not exists lots_solucion_product_code_idx
  on public.lots (solucion_product_code);
create index if not exists movements_lot_id_idx
  on public.movements (lot_id);
