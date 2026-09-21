// Server functions: se ejecutan en el servidor, el navegador solo las llama.
// Cada operación sobre una fiesta comprueba su PIN antes de tocar la base de datos.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { EventRow, SaleRow, SellerRow } from "./party";

export type Fail = {
  ok: false;
  error: "NOT_FOUND" | "NO_PIN" | "WRONG_PIN" | "LOCKED" | "INVALID" | "SERVER";
};
export type Result<T> = ({ ok: true } & T) | Fail;

const server = () => import("./party.server");

const pinSchema = z.string().trim().min(4).max(32);
const auth = { id: z.string().uuid(), pin: pinSchema };

const EVENT_COLUMNS = "id, name, total_tickets, price, created_at";

async function authorize(id: string, pin: string): Promise<Fail | null> {
  const { checkPin } = await server();
  const res = await checkPin(id, pin);
  return res.ok ? null : res;
}

const SERVER_ERROR: Fail = { ok: false, error: "SERVER" };

export const createEvent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().trim().min(1).max(120),
      total: z.number().int().min(0).max(100_000),
      price: z.number().min(0).max(100_000),
      pin: pinSchema,
      sellers: z.array(z.string().trim().min(1).max(60)).max(50),
    }),
  )
  .handler(async ({ data }): Promise<Result<{ id: string; name: string }>> => {
    const { supabaseAdmin, hashPin } = await server();
    const { data: ev, error } = await supabaseAdmin
      .from("events")
      .insert({
        name: data.name,
        total_tickets: data.total,
        price: data.price,
        pin_hash: await hashPin(data.pin),
      })
      .select("id, name")
      .single();
    if (error || !ev) return SERVER_ERROR;
    if (data.sellers.length) {
      await supabaseAdmin
        .from("sellers")
        .insert(data.sellers.map((name) => ({ event_id: ev.id, name })));
    }
    return { ok: true, id: ev.id, name: ev.name };
  });

/** Datos mínimos para la pantalla del PIN (no incluye ventas ni compradores). */
export const getEventInfo = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<Result<{ name: string; hasPin: boolean }>> => {
    const { supabaseAdmin } = await server();
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("name, pin_hash")
      .eq("id", data.id)
      .maybeSingle();
    if (!ev) return { ok: false, error: "NOT_FOUND" };
    return { ok: true, name: ev.name, hasPin: !!ev.pin_hash };
  });

/** Entrar en una fiesta con su PIN (o ponerle PIN si aún no tiene). */
export const joinEvent = createServerFn({ method: "POST" })
  .validator(z.object(auth))
  .handler(async ({ data }): Promise<Result<{ name: string }>> => {
    const { checkPin, claimPin, supabaseAdmin } = await server();
    let res = await checkPin(data.id, data.pin);
    if (!res.ok && res.error === "NO_PIN") {
      await claimPin(data.id, data.pin);
      res = await checkPin(data.id, data.pin);
    }
    if (!res.ok) return res;
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("name")
      .eq("id", data.id)
      .single();
    return { ok: true, name: ev?.name ?? "" };
  });

export const getParty = createServerFn({ method: "POST" })
  .validator(z.object(auth))
  .handler(
    async ({
      data,
    }): Promise<Result<{ event: EventRow; sellers: SellerRow[]; sales: SaleRow[] }>> => {
      const denied = await authorize(data.id, data.pin);
      if (denied) return denied;
      const { supabaseAdmin } = await server();
      const [ev, sellers, sales] = await Promise.all([
        supabaseAdmin.from("events").select(EVENT_COLUMNS).eq("id", data.id).single(),
        supabaseAdmin
          .from("sellers")
          .select("*")
          .eq("event_id", data.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("sales")
          .select("*")
          .eq("event_id", data.id)
          .order("created_at", { ascending: false }),
      ]);
      if (ev.error || sellers.error || sales.error) return SERVER_ERROR;
      return {
        ok: true,
        event: ev.data as EventRow,
        sellers: sellers.data as SellerRow[],
        sales: sales.data as SaleRow[],
      };
    },
  );

export const addSeller = createServerFn({ method: "POST" })
  .validator(z.object({ ...auth, name: z.string().trim().min(1).max(60) }))
  .handler(async ({ data }): Promise<Result<{ seller: SellerRow }>> => {
    const denied = await authorize(data.id, data.pin);
    if (denied) return denied;
    const { supabaseAdmin } = await server();
    const { data: seller, error } = await supabaseAdmin
      .from("sellers")
      .insert({ event_id: data.id, name: data.name })
      .select()
      .single();
    if (error || !seller) return SERVER_ERROR;
    return { ok: true, seller: seller as SellerRow };
  });

export const addSale = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...auth,
      sellerId: z.string().uuid(),
      buyerName: z.string().trim().min(1).max(120),
      room: z.string().trim().max(40).nullable(),
      paid: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<Result<{ sale: SaleRow }>> => {
    const denied = await authorize(data.id, data.pin);
    if (denied) return denied;
    const { supabaseAdmin } = await server();
    // El vendedor tiene que ser de esta misma fiesta.
    const { data: seller } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("id", data.sellerId)
      .eq("event_id", data.id)
      .maybeSingle();
    if (!seller) return { ok: false, error: "INVALID" };
    const { data: sale, error } = await supabaseAdmin
      .from("sales")
      .insert({
        event_id: data.id,
        seller_id: data.sellerId,
        buyer_name: data.buyerName,
        room: data.room || null,
        paid: data.paid,
      })
      .select()
      .single();
    if (error || !sale) return SERVER_ERROR;
    return { ok: true, sale: sale as SaleRow };
  });

export const setSalePaid = createServerFn({ method: "POST" })
  .validator(z.object({ ...auth, saleId: z.string().uuid(), paid: z.boolean() }))
  .handler(async ({ data }): Promise<Result<object>> => {
    const denied = await authorize(data.id, data.pin);
    if (denied) return denied;
    const { supabaseAdmin } = await server();
    const { error } = await supabaseAdmin
      .from("sales")
      .update({ paid: data.paid })
      .eq("id", data.saleId)
      .eq("event_id", data.id);
    return error ? SERVER_ERROR : { ok: true };
  });

export const deleteSale = createServerFn({ method: "POST" })
  .validator(z.object({ ...auth, saleId: z.string().uuid() }))
  .handler(async ({ data }): Promise<Result<object>> => {
    const denied = await authorize(data.id, data.pin);
    if (denied) return denied;
    const { supabaseAdmin } = await server();
    const { error } = await supabaseAdmin
      .from("sales")
      .delete()
      .eq("id", data.saleId)
      .eq("event_id", data.id);
    return error ? SERVER_ERROR : { ok: true };
  });
