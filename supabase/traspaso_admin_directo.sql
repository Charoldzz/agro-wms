-- ============================================================
-- EL ADMIN NO SE APRUEBA A SÍ MISMO
--
-- Si el traspaso lo registra un ADMINISTRADOR, se aplica al instante. Antes
-- quedaba pendiente y el mismo admin tenía que ir a "Por aprobar" y aprobarse
-- a sí mismo — un paso de más que no controla nada.
--
-- Es la convención que la app YA usa para las reparaciones
-- (roles_and_movement_rules.sql: `if v_role = 'operador' then` → pendiente,
-- si no → se aplica directo). El traspaso no la seguía.
--
-- El operador SIGUE necesitando aprobación del admin, como se acordó.
--
-- Correr DESPUÉS de traspaso_fix_status_enum.sql. Idempotente.
-- ============================================================

create or replace function public.request_transfer_operation(
  p_from_client_id uuid,
  p_to_client_id   uuid,
  p_notes          text,
  p_items          jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role   text;
  v_name   text;
  v_op     uuid;
  v_code   text;
  v_item   jsonb;
  v_lot    public.lots%rowtype;
  v_qty    numeric(12, 2);
  v_count  integer := 0;
  v_prefix text;
  v_auto   boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('administrador', 'operador') then
    raise exception 'No tenés permiso para registrar un traspaso.';
  end if;

  if coalesce(btrim(p_notes), '') = '' then
    raise exception 'Escribí el motivo del traspaso.';
  end if;

  if p_from_client_id is null or p_to_client_id is null then
    raise exception 'Elegí la empresa que vende y la que recibe.';
  end if;

  if p_from_client_id = p_to_client_id then
    raise exception 'La empresa que vende y la que recibe no pueden ser la misma.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un lote al traspaso.';
  end if;

  select product_code_prefix into v_prefix from public.clients where id = p_to_client_id;
  if coalesce(btrim(v_prefix), '') = '' then
    raise exception 'La empresa que recibe no tiene código de empresa asignado. Un administrador debe cargarlo en Empresas antes de traspasar.';
  end if;

  v_code := public.next_warehouse_guide('trp');

  insert into public.transfer_operations (
    operation_code, from_client_id, to_client_id, notes, created_by, created_by_name
  ) values (
    v_code, p_from_client_id, p_to_client_id, btrim(p_notes), auth.uid(), v_name
  )
  returning id into v_op;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;

    select * into v_lot from public.lots
    where id = nullif(v_item->>'lot_id', '')::uuid
    for update;

    if not found then
      raise exception 'Uno de los lotes no existe.';
    end if;

    if v_lot.client_id <> p_from_client_id then
      raise exception 'El lote % no es de la empresa que vende.', v_lot.lot_code;
    end if;

    if v_lot.status <> 'activo'::lot_status then
      raise exception 'El lote % no está activo (está %).', v_lot.lot_code, v_lot.status;
    end if;

    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, v_lot.current_quantity);

    if v_qty <= 0 then
      raise exception 'La cantidad del lote % debe ser mayor a cero.', v_lot.lot_code;
    end if;

    if v_qty > v_lot.current_quantity then
      raise exception 'El lote % no tiene tanto stock (hay %).',
        v_lot.lot_code, trim(to_char(v_lot.current_quantity, 'FM999999990.99'));
    end if;

    if exists (select 1 from public.lot_transfers t
               left join public.transfer_operations o on o.id = t.operation_id
               where t.lot_id = v_lot.id and coalesce(o.status, t.status) = 'pendiente') then
      raise exception 'El lote % ya está en otro traspaso esperando aprobación.', v_lot.lot_code;
    end if;

    insert into public.lot_transfers (
      operation_id, lot_id, from_client_id, to_client_id, lot_code, product,
      quantity, notes, created_by, created_by_name
    ) values (
      v_op, v_lot.id, p_from_client_id, p_to_client_id, v_lot.lot_code, v_lot.product,
      v_qty, btrim(p_notes), auth.uid(), v_name
    );

    -- Se congela igual: si lo registra el operador queda así hasta que el admin
    -- resuelva; si lo registra el admin se descongela enseguida al aplicarse.
    update public.lots set status = 'retenido'::lot_status, updated_at = now() where id = v_lot.id;
  end loop;

  -- El ADMIN es quien aprueba: no tiene sentido que se apruebe a sí mismo.
  if v_role = 'administrador' then
    perform public.approve_transfer_operation(v_op);
    v_auto := true;
  end if;

  return jsonb_build_object(
    'operation_id',   v_op,
    'operation_code', v_code,
    'items',          v_count,
    'aplicado',       v_auto   -- true = ya quedó aplicado; false = espera aprobación
  );
end;
$$;

grant execute on function public.request_transfer_operation(uuid, uuid, text, jsonb) to authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select operation_code, status, created_by_name, reviewed_by_name
--   from public.transfer_operations order by created_at desc;
