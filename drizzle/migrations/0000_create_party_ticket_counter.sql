CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  total_tickets integer NOT NULL DEFAULT 80,
  price numeric(10,2) NOT NULL DEFAULT 7,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  buyer_name text NOT NULL,
  room text,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sellers_event ON public.sellers(event_id);
CREATE INDEX idx_sales_event ON public.sales(event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sellers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
GRANT ALL ON public.sellers TO service_role;
GRANT ALL ON public.sales TO service_role;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public access events" ON public.events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public access sellers" ON public.sellers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public access sales" ON public.sales FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sellers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;