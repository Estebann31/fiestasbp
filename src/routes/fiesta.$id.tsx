import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Loader2,
  Lock,
  PencilLine,
  Plus,
  Share2,
  Ticket,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  errorMessage,
  euros,
  forgetParty,
  getSavedParty,
  saveParty,
  type SavedParty,
} from "@/lib/party";
import {
  addSale as addSaleFn,
  addSeller as addSellerFn,
  deleteSale as deleteSaleFn,
  getEventInfo,
  getParty,
  joinEvent,
  setSalePaid as setSalePaidFn,
} from "@/lib/party.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "who" | "apuntar" | "fiesta";

export const Route = createFileRoute("/fiesta/$id")({
  head: () => ({
    meta: [
      { title: "Fiesta | Contador de entradas" },
      {
        name: "description",
        content: "Entradas vendidas, recaudación y lista de asistentes por vendedor, actualizado en tiempo real.",
      },
      { property: "og:title", content: "Fiesta | Contador de entradas" },
      {
        property: "og:description",
        content: "Sigue las ventas de entradas de la fiesta desde el móvil, los dos a la vez.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PartyPage,
});

function PartyPage() {
  const { id } = Route.useParams();
  // undefined = aún leyendo el móvil, null = sin PIN guardado
  const [access, setAccess] = useState<SavedParty | null | undefined>(undefined);

  useEffect(() => {
    setAccess(getSavedParty(id));
  }, [id]);

  if (access === undefined) return <FullScreenLoader />;
  if (access === null) return <PinGate id={id} onJoined={setAccess} />;
  return (
    <PartyContent
      key={id}
      access={access}
      onLostAccess={() => {
        forgetParty(id);
        setAccess(null);
      }}
    />
  );
}

function FullScreenLoader() {
  return (
    <main className="grid min-h-screen place-items-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </main>
  );
}

function PinGate({ id, onJoined }: { id: string; onJoined: (p: SavedParty) => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const infoQ = useQuery({
    queryKey: ["event-info", id],
    queryFn: () => getEventInfo({ data: { id } }),
    retry: false,
  });
  const info = infoQ.data;

  async function join() {
    if (pin.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinEvent({ data: { id, pin: pin.trim() } });
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      const saved = { id, name: res.name, pin: pin.trim() };
      saveParty(saved);
      onJoined(saved);
    } catch {
      setError(errorMessage("SERVER"));
    } finally {
      setBusy(false);
    }
  }

  if (infoQ.isLoading) return <FullScreenLoader />;
  if (!info || !info.ok) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-muted-foreground">No encontramos esta fiesta.</p>
          <Link to="/" className="mt-4 inline-block font-semibold text-primary">
            Volver
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-16 pt-8">
      <Link
        to="/"
        className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <section className="mt-10 rounded-2xl border border-border bg-card p-5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-secondary">
          <Lock className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold">{info.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {info.hasPin
            ? "Introduce el PIN de la fiesta para ver y apuntar entradas."
            : "Esta fiesta todavía no tiene PIN. Elige uno (mínimo 4 caracteres) y pásaselo solo a quien venda."}
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            autoComplete="off"
            className="h-11"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="h-12 w-full text-base font-semibold"
            disabled={busy || pin.trim().length < 4}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : info.hasPin ? "Entrar" : "Poner PIN y entrar"}
          </Button>
        </form>
      </section>
    </main>
  );
}

function PartyContent({ access, onLostAccess }: { access: SavedParty; onLostAccess: () => void }) {
  const { id, pin } = access;
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("who");
  const [me, setMe] = useState<string | null>(null);
  const [buyer, setBuyer] = useState("");
  const [room, setRoom] = useState("");
  const [paid, setPaid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"todos" | "mias">("todos");
  const [newSeller, setNewSeller] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const partyQ = useQuery({
    queryKey: ["party", id],
    queryFn: () => getParty({ data: { id, pin } }),
    // Red de seguridad por si se pierde algún aviso en tiempo real.
    refetchInterval: 20_000,
  });

  useEffect(() => {
    const stored = localStorage.getItem(`seller:${id}`);
    if (stored) setMe(stored);
  }, [id]);

  // Si el PIN ya no vale (lo han cambiado o la fiesta no existe), volver a pedirlo.
  const denied = partyQ.data && !partyQ.data.ok ? partyQ.data.error : null;
  useEffect(() => {
    if (denied === "WRONG_PIN" || denied === "NO_PIN" || denied === "NOT_FOUND") onLostAccess();
  }, [denied, onLostAccess]);

  // Tiempo real: el servidor avisa "algo ha cambiado" (sin datos) y recargamos con el PIN.
  useEffect(() => {
    const channel = supabase
      .channel(`party:${id}`)
      .on("broadcast", { event: "change" }, () => {
        queryClient.invalidateQueries({ queryKey: ["party", id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  const party = partyQ.data?.ok ? partyQ.data : null;
  const ev = party?.event;
  const sellers = party?.sellers ?? [];
  const sales = party?.sales ?? [];

  const stats = useMemo(() => {
    const price = Number(ev?.price ?? 0);
    const sold = sales.length;
    const collected = sales.filter((s) => s.paid).length * price;
    const remaining = Math.max((ev?.total_tickets ?? 0) - sold, 0);
    return { sold, collected, remaining, pending: sales.filter((s) => !s.paid).length };
  }, [sales, ev]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["party", id] });

  /** Ejecuta una acción en el servidor y muestra el error si falla. Devuelve true si fue bien. */
  async function run(action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setActionError(null);
    try {
      const res = await action();
      if (!res.ok) {
        if (res.error === "WRONG_PIN" || res.error === "NO_PIN") onLostAccess();
        setActionError(errorMessage(res.error ?? "SERVER"));
        return false;
      }
      refresh();
      return true;
    } catch {
      setActionError(errorMessage("SERVER"));
      return false;
    }
  }

  function chooseMe(sellerId: string) {
    localStorage.setItem(`seller:${id}`, sellerId);
    setMe(sellerId);
  }

  async function addSeller() {
    const name = newSeller.trim();
    if (!name) return;
    let createdId: string | null = null;
    const ok = await run(async () => {
      const res = await addSellerFn({ data: { id, pin, name } });
      if (res.ok) createdId = res.seller.id;
      return res;
    });
    if (ok) {
      setNewSeller("");
      if (createdId) chooseMe(createdId);
    }
  }

  async function addSale() {
    if (!me || !buyer.trim()) return;
    setSaving(true);
    const ok = await run(() =>
      addSaleFn({
        data: { id, pin, sellerId: me, buyerName: buyer.trim(), room: room.trim() || null, paid },
      }),
    );
    setSaving(false);
    // Solo se vacía el formulario si se ha guardado de verdad.
    if (ok) {
      setBuyer("");
      setRoom("");
    }
  }

  async function togglePaid(saleId: string, value: boolean) {
    await run(() => setSalePaidFn({ data: { id, pin, saleId, paid: value } }));
  }

  async function removeSale(saleId: string) {
    await run(() => deleteSaleFn({ data: { id, pin, saleId } }));
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: ev?.name ?? "Fiesta", url });
      } else {
        await navigator.clipboard.writeText(url);
        setActionError("Enlace copiado. El PIN pásalo aparte.");
      }
    } catch {
      /* cancelado */
    }
  }

  if (partyQ.isLoading) return <FullScreenLoader />;

  if (!ev) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-muted-foreground">
            {errorMessage(denied ?? (partyQ.isError ? "SERVER" : "NOT_FOUND"))}
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => partyQ.refetch()}>
            Reintentar
          </Button>
          <Link to="/" className="mt-4 block font-semibold text-primary">
            Volver
          </Link>
        </div>
      </main>
    );
  }

  const myName = sellers.find((s) => s.id === me)?.name;
  const visible = tab === "mias" && me ? sales.filter((s) => s.seller_id === me) : sales;
  const sellerName = (sid: string) => sellers.find((s) => s.id === sid)?.name ?? "—";

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-16 pt-8">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold">{ev.name}</h1>
          <p className="text-xs text-muted-foreground">
            {euros(Number(ev.price))} por entrada · {ev.total_tickets} en total
          </p>
        </div>
        <button
          onClick={share}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
          aria-label="Compartir enlace"
        >
          <Share2 className="h-4 w-4" />
        </button>
        {step !== "who" && (
          <button
            onClick={() => setStep(step === "fiesta" ? "apuntar" : "fiesta")}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors ${
              step === "fiesta"
                ? "bg-gradient-party text-primary-foreground"
                : "border border-border text-muted-foreground"
            }`}
          >
            {step === "fiesta" ? (
              <>
                <PencilLine className="h-3.5 w-3.5" /> Apuntar
              </>
            ) : (
              <>
                <BarChart3 className="h-3.5 w-3.5" /> Fiesta
              </>
            )}
          </button>
        )}
      </div>

      {actionError && (
        <p className="mt-4 rounded-xl bg-secondary px-4 py-2 text-center text-sm">{actionError}</p>
      )}

      {step === "who" && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-bold">¿Quién eres?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Elígete para apuntar entradas con tu nombre.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {sellers.map((s) => (
              <button
                key={s.id}
                onClick={() => chooseMe(s.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  me === s.id
                    ? "bg-gradient-party text-primary-foreground"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              value={newSeller}
              onChange={(e) => setNewSeller(e.target.value)}
              placeholder="Añadir vendedor"
              className="h-10"
            />
            <Button variant="secondary" className="h-10" onClick={addSeller} disabled={!newSeller.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Button
            className="mt-6 h-12 w-full text-base font-semibold"
            onClick={() => setStep("apuntar")}
            disabled={!me}
          >
            Siguiente
          </Button>
          {!me && <p className="mt-2 text-center text-xs text-muted-foreground">Elige primero quién eres.</p>}
        </section>
      )}

      {step === "apuntar" && (
        <section className="mt-6 space-y-3 rounded-2xl border border-border bg-card p-4">
          {myName && (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{myName}</span>
              <button
                onClick={() => setStep("who")}
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                no soy yo
              </button>
            </div>
          )}
          <h2 className="font-display text-base font-semibold">Apuntar una entrada</h2>
          <Input
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            placeholder="Nombre de la persona"
            className="h-11"
          />
          <div className="flex gap-2">
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Habitación"
              className="h-11"
            />
            <button
              type="button"
              onClick={() => setPaid((p) => !p)}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium ${
                paid ? "bg-success text-success-foreground" : "border border-border text-muted-foreground"
              }`}
            >
              <Check className="h-4 w-4" /> Pagado
            </button>
          </div>
          <Button
            className="h-12 w-full text-base font-semibold"
            onClick={addSale}
            disabled={!me || !buyer.trim() || saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Añadir entrada"}
          </Button>
        </section>
      )}

      {step === "fiesta" && (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3">
            <StatCard icon={<Ticket className="h-4 w-4" />} label="Vendidas" value={String(stats.sold)} highlight />
            <StatCard icon={<Users className="h-4 w-4" />} label="Van a la fiesta" value={String(stats.sold)} />
            <StatCard icon={<Wallet className="h-4 w-4" />} label="Recaudado" value={euros(stats.collected)} />
            <StatCard icon={<Ticket className="h-4 w-4" />} label="Quedan" value={String(stats.remaining)} />
          </section>
          {stats.pending > 0 && (
            <p className="mt-3 rounded-xl bg-secondary px-4 py-2 text-center text-sm text-muted-foreground">
              {stats.pending} entrada{stats.pending === 1 ? "" : "s"} sin pagar
            </p>
          )}

          <section className="mt-6">
            <div className="flex gap-2">
              {(["todos", "mias"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-full py-2 text-sm font-medium ${
                    tab === t ? "bg-secondary text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t === "todos" ? "Todas" : "Las mías"}
                </button>
              ))}
            </div>

            <ul className="mt-3 space-y-2">
              {visible.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                >
                  <button
                    onClick={() => togglePaid(s.id, !s.paid)}
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                      s.paid ? "bg-success text-success-foreground" : "border border-border text-muted-foreground"
                    }`}
                    aria-label="Marcar pagado"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.buyer_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.room ? `Hab. ${s.room} · ` : ""}
                      {sellerName(s.seller_id)}
                      {s.paid ? "" : " · pendiente"}
                    </p>
                  </div>
                  <button
                    onClick={() => removeSale(s.id)}
                    className="shrink-0 text-muted-foreground"
                    aria-label="Borrar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Aún no hay entradas apuntadas.
                </li>
              )}
            </ul>
          </section>

          {sellers.length > 0 && (
            <section className="mt-6 rounded-2xl border border-border bg-card p-4">
              <h2 className="font-display text-base font-semibold">Resumen por vendedor</h2>
              <ul className="mt-3 space-y-2">
                {sellers.map((s) => {
                  const mine = sales.filter((x) => x.seller_id === s.id);
                  return (
                    <li key={s.id} className="flex items-center justify-between text-sm">
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">
                        {mine.length} · {euros(mine.filter((m) => m.paid).length * Number(ev.price))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={`mt-1 font-display text-2xl font-bold ${highlight ? "text-gradient-party" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}
