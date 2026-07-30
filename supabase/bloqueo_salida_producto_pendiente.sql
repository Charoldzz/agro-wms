-- ============================================================
-- BLOQUEO DE SALIDA DE PRODUCTOS PENDIENTES DE APROBACIÓN
--
-- Un producto creado por el operador queda pending_review = true en
-- product_catalog hasta que el admin lo aprueba. Este trigger impide que
-- salga stock de ese producto (movimiento 'salida') hasta que esté aprobado.
-- El INGRESO se permite (hay que registrar lo que llega); el control es sobre
-- la SALIDA.
--
-- Robusto: corre en la base, así ninguna pantalla puede saltarlo (era el hueco
-- que encontró Harold: operador creaba producto → ingreso → salida sin que el
-- admin lo aprobara). Vincula el lote con su producto por nombre + empresa.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

create or replace function public.block_salida_producto_pendiente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_name   text;
  v_code   text;
begin
  if NEW.type::text = 'salida' then
    select l.client_id, l.product, l.solucion_product_code
      into v_client, v_name, v_code
    from public.lots l where l.id = NEW.lot_id;

    -- Doble vínculo (robusto): por CÓDIGO (join principal) o por NOMBRE + empresa.
    if exists (
      select 1 from public.product_catalog pc
      where pc.pending_review = true
        and (
          (v_code is not null and pc.code = v_code)
          or (pc.client_id = v_client and pc.name = v_name)
        )
    ) then
      raise exception 'Este producto está pendiente de aprobación del administrador y no puede salir hasta que sea aprobado.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_salida_pendiente on public.movements;
create trigger trg_block_salida_pendiente
  before insert on public.movements
  for each row execute function public.block_salida_producto_pendiente();

-- VERIFICACIÓN opcional: productos pendientes por empresa
-- select client_id, name from public.product_catalog where pending_review = true;
