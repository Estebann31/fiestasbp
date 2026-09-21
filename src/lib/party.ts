import { supabase } from "@/integrations/supabase/client";

export type EventRow = {
  id: string;
  name: string;
  total_tickets: number;
  price: number;
  created_at: string;
};

export type SellerRow = {
  id: string;
  event_id: string;
  name: string;
  created_at: string;
};

export type SaleRow = {
  id: string;
  event_id: string;
  seller_id: string;
  buyer_name: string;
  room: string | null;
  paid: boolean;
  created_at: string;
};

export async function fetchEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function fetchEvent(id: string): Promise<EventRow> {
  const { data, error } = await supabase.from("events").select("*").eq("id", id).single();
  if (error) throw error;
  return data as EventRow;
}

export async function fetchSellers(eventId: string): Promise<SellerRow[]> {
  const { data, error } = await supabase
    .from("sellers")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SellerRow[];
}

export async function fetchSales(eventId: string): Promise<SaleRow[]> {
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SaleRow[];
}

export function euros(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}
