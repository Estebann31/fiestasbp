// Solo servidor. Se carga con import() dinámico desde party.functions.ts,
// así el service_role nunca llega al navegador.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ITERATIONS = 50_000;
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 10;

export type AuthResult =
  { ok: true } | { ok: false; error: "NOT_FOUND" | "NO_PIN" | "WRONG_PIN" | "LOCKED" };

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const expected = fromB64(hashB64);
  const actual = await derive(pin, fromB64(saltB64), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Comprueba el PIN de una fiesta, con bloqueo temporal tras varios fallos. */
export async function checkPin(eventId: string, pin: string): Promise<AuthResult> {
  const { data: ev, error } = await supabaseAdmin
    .from("events")
    .select("id, pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !ev) return { ok: false, error: "NOT_FOUND" };
  if (!ev.pin_hash) return { ok: false, error: "NO_PIN" };
  if (ev.pin_locked_until && new Date(ev.pin_locked_until) > new Date()) {
    return { ok: false, error: "LOCKED" };
  }

  if (await pinMatches(pin, ev.pin_hash)) {
    if (ev.pin_failed_attempts > 0) {
      await supabaseAdmin
        .from("events")
        .update({ pin_failed_attempts: 0, pin_locked_until: null })
        .eq("id", eventId);
    }
    return { ok: true };
  }

  const failed = ev.pin_failed_attempts + 1;
  const lock = failed >= MAX_FAILED_ATTEMPTS;
  await supabaseAdmin
    .from("events")
    .update({
      pin_failed_attempts: lock ? 0 : failed,
      pin_locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
    })
    .eq("id", eventId);
  return { ok: false, error: lock ? "LOCKED" : "WRONG_PIN" };
}

/** Fiestas creadas antes de los PIN: el primero que entra le pone uno. */
export async function claimPin(eventId: string, pin: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("events")
    .update({ pin_hash: await hashPin(pin) })
    .eq("id", eventId)
    .is("pin_hash", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

export { supabaseAdmin };
