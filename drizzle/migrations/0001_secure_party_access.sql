-- Cierra el acceso público a los datos de las fiestas.
-- A partir de aquí solo el servidor (service_role) lee y escribe las tablas,
-- después de comprobar el PIN de la fiesta en una server function.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- Quitar las políticas que daban acceso total a cualquiera.
DROP POLICY IF EXISTS "public access events" ON public.events;
DROP POLICY IF EXISTS "public access sellers" ON public.sellers;
DROP POLICY IF EXISTS "public access sales" ON public.sales;

-- RLS sigue activado y sin políticas: anon y authenticated no ven nada.
REVOKE ALL ON public.events FROM anon, authenticated;
REVOKE ALL ON public.sellers FROM anon, authenticated;
REVOKE ALL ON public.sales FROM anon, authenticated;

-- Dejar de emitir las filas por Realtime (postgres_changes).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.events;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.sellers;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.sales;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- En su lugar se envía un aviso sin datos ("algo ha cambiado") al canal de la
-- fiesta, y cada móvil vuelve a pedir los datos al servidor con su PIN.
CREATE OR REPLACE FUNCTION public.notify_party_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev uuid;
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    ev := COALESCE(NEW.id, OLD.id);
  ELSIF TG_OP = 'DELETE' THEN
    ev := OLD.event_id;
  ELSE
    ev := NEW.event_id;
  END IF;
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME),
      'change',
      'party:' || ev::text,
      false
    );
  EXCEPTION WHEN others THEN
    -- Si Realtime no está disponible, no bloquear la escritura.
    NULL;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_party_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS party_change_events ON public.events;
CREATE TRIGGER party_change_events
  AFTER UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.notify_party_change();

DROP TRIGGER IF EXISTS party_change_sellers ON public.sellers;
CREATE TRIGGER party_change_sellers
  AFTER INSERT OR UPDATE OR DELETE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.notify_party_change();

DROP TRIGGER IF EXISTS party_change_sales ON public.sales;
CREATE TRIGGER party_change_sales
  AFTER INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.notify_party_change();
