-- UTEQ Aulas Digitales — Data API (piloto de un operador autorizado)
-- En Neon: primero habilita Data API y Neon Auth, después ejecuta esto.
-- No elimina ni sobreescribe los registros existentes.

CREATE TABLE IF NOT EXISTS public.uteq_kiosk_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL CHECK (revision > 0),
  estado jsonb NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.uteq_kiosk_state ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE public.uteq_kiosk_state ALTER COLUMN owner_id SET DEFAULT (auth.user_id());
ALTER TABLE public.uteq_kiosk_state ENABLE ROW LEVEL SECURITY;

-- Conceder solo a usuarios autenticados, no a visitantes anónimos.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.uteq_kiosk_state TO authenticated;
REVOKE ALL ON public.uteq_kiosk_state FROM PUBLIC;
REVOKE ALL ON public.uteq_kiosk_state FROM anonymous;

DROP POLICY IF EXISTS ueq_state_read_owner ON public.uteq_kiosk_state;
DROP POLICY IF EXISTS ueq_state_insert_owner ON public.uteq_kiosk_state;
DROP POLICY IF EXISTS ueq_state_update_owner ON public.uteq_kiosk_state;

CREATE POLICY ueq_state_read_owner ON public.uteq_kiosk_state
  FOR SELECT TO authenticated USING (owner_id = (select auth.user_id()));
CREATE POLICY ueq_state_insert_owner ON public.uteq_kiosk_state
  FOR INSERT TO authenticated WITH CHECK (owner_id = (select auth.user_id()));
CREATE POLICY ueq_state_update_owner ON public.uteq_kiosk_state
  FOR UPDATE TO authenticated
  USING (owner_id = (select auth.user_id()))
  WITH CHECK (owner_id = (select auth.user_id()));

-- Verificación de estado, no modifica información:
SELECT id, revision, owner_id, actualizado_en FROM public.uteq_kiosk_state;

-- Si la tabla tiene una fila anterior con owner_id NULL, NO borres la fila.
-- Para conservarla, TI debe asociarla al usuario adecuado y validar la migración.
