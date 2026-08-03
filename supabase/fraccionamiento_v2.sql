-- ============================================================
-- FRACCIONAMIENTO v2 — mismo producto, nuevo tamaño de envase
--
-- La primera versión hacía elegir OTRO producto del catálogo, lo que permitía
-- disparates (fraccionar un líquido "a" un sólido) y no era lo que pasa en la
-- realidad. Al fraccionar NO cambia el producto: cambia el envase.
--
-- Ahora:
--   · Producto, lote y vencimiento quedan FIJOS (no se eligen).
--   · Se carga cuánto se fracciona (equivalente) y el TAMAÑO del envase nuevo.
--   · La MERMA es un campo propio, no una resta entre dos cantidades.
--   · El producto destino se nombra con la convención de la app
--     ("PRUEBA LIQUIDO X 5 LTS.") y se crea en el catálogo si no existe.
--
-- Correr DESPUÉS de fraccionamiento.sql. Idempotente.
-- ============================================================

drop function if exists public.request_lot_split(uuid, text, numeric, numeric, text, text);

create or replace function public.request_lot_split(
  p_lot_id            uuid,
  p_dest_product      text,     -- nombre ya armado por la app
  p_dest_package_size numeric,  -- tamaño del envase nuevo
  p_dest_package_unit text,     -- misma unidad del lote (lt / kg)
  p_quantity_out      numeric,  -- cuánto sale del lote, en equivalente
  p_merma             numeric,  -- cuánto se pierde (0 si no hay)
  p_merma_reason      text,
  p_notes             text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role  text;
  v_name  text;
  v_lot   public.lots%rowtype;
  v_merma numeric(12, 2);
  v_in    numeric(12, 2);
  v_id    uuid;
  v_code  text;
  v_auto  boolean := false;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;

  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('administrador', 'operador') then
    raise exception 'No tenés permiso para registrar un fraccionamiento.';
  end if;

  select * into v_lot from public.lots where id = p_lot_id for update;
  if not found then raise exception 'Lote no encontrado.'; end if;
  if v_lot.status <> 'activo'::lot_status then
    raise exception 'El lote no está activo (está %).', v_lot.status;
  end if;

  if coalesce(p_quantity_out, 0) <= 0 then
    raise exception 'Indicá cuánto se fracciona.';
  end if;
  if p_quantity_out > coalesce(v_lot.current_quantity, 0) then
    raise exception 'El lote tiene %.', trim(to_char(coalesce(v_lot.current_quantity, 0), 'FM999999990.99'));
  end if;

  if coalesce(p_dest_package_size, 0) <= 0 then
    raise exception 'Indicá el tamaño del envase nuevo.';
  end if;
  if coalesce(p_dest_package_size, 0) = coalesce(v_lot.package_size, 0) then
    raise exception 'El envase nuevo tiene que ser distinto al actual.';
  end if;

  v_merma := greatest(coalesce(p_merma, 0), 0);
  if v_merma >= p_quantity_out then
    raise exception 'La merma no puede ser igual ni mayor a lo que se fracciona.';
  end if;
  -- Nada se pierde sin explicación
  if v_merma > 0 and coalesce(btrim(p_merma_reason), '') = '' then
    raise exception 'Declará el motivo de la merma.';
  end if;

  v_in := p_quantity_out - v_merma;

  if coalesce(btrim(p_dest_product), '') = '' then
    raise exception 'No se pudo determinar el producto destino.';
  end if;

  if exists (select 1 from public.lot_splits s where s.source_lot_id = p_lot_id and s.status = 'pendiente') then
    raise exception 'Este lote ya tiene un fraccionamiento esperando aprobación.';
  end if;

  v_code := public.next_warehouse_guide('frc');

  insert into public.lot_splits (
    operation_code, client_id, source_lot_id, lot_code, source_product, dest_product,
    dest_package_size, dest_package_unit, quantity_out, quantity_in, merma, merma_reason,
    notes, created_by, created_by_name
  ) values (
    v_code, v_lot.client_id, v_lot.id, v_lot.lot_code, v_lot.product, btrim(p_dest_product),
    p_dest_package_size, coalesce(nullif(btrim(coalesce(p_dest_package_unit, '')), ''), v_lot.package_unit),
    p_quantity_out, v_in, v_merma,
    nullif(btrim(coalesce(p_merma_reason, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), v_name
  )
  returning id into v_id;

  update public.lots set status = 'retenido'::lot_status, updated_at = now() where id = v_lot.id;

  if v_role = 'administrador' then
    update public.lot_splits
    set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now()
    where id = v_id;
    perform public.apply_lot_split(v_id);
    v_auto := true;
  end if;

  return jsonb_build_object('id', v_id, 'operation_code', v_code, 'merma', v_merma,
                            'quantity_in', v_in, 'aplicado', v_auto);
end;
$$;

grant execute on function public.request_lot_split(uuid, text, numeric, text, numeric, numeric, text, text) to authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select operation_code, source_product, dest_product, dest_package_size, dest_package_unit,
--        quantity_out, quantity_in, merma, merma_reason, status
--   from public.lot_splits order by created_at desc;
