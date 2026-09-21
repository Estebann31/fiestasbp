import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Plus, Ticket, Trash2, Users, Wallet } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { euros, fetchEvent, fetchSales, fetchSellers } from "@/lib/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const queryClient = useQueryClient();
  const [me, setMe] = useState<string | null>(null);
  const [buyer, setBuyer] = useState("");
  const [room, setRoom] = useState("");
  const [paid, setPaid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"todos" | "mias">("todos");
  const [newSeller, setNewSeller] = useState("");

  const eventQ = useQuery({ queryKey: ["event", id], queryFn: () => fetchEvent(id) });
  const sellersQ = useQuery({ queryKey: ["sellers", id], queryFn: () => fetchSellers(id) });
  const salesQ = useQuery({ queryKey: ["sales", id], queryFn: () => fetchSales(id) });

  useEffect(() => {
    const stored = localStorage.getItem(`seller:${id}`);
    if (stored) setMe(stored);
  }, [id]);

  useEffect(() => {
    const channel = supabase
      .channel(`party-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sales", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sellers" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sellers", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        queryClient.invalidateQueries({ queryKey: ["event", id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  const ev = eventQ.data;
  const sellers = sellersQ.data ?? [];
  const sales = salesQ.data ?? [];

  const stats = useMemo(() => {
    const price = Number(ev?.price ?? 0);
    const sold = sales.length;
    const collected = sales.filter((s) => s.paid).length * price;
    const remaining = Math.max((ev?.total_tickets ?? 0) - sold, 0);
    return { sold, collected, remaining, pending: sales.filter((s) => !s.paid).length };
  }, [sales, ev]);

  function chooseMe(sellerId: string) {
    localStorage.setItem(`seller:${id}`, sellerId);
    setMe(sellerId);
  }

  async function addSeller() {
    if (!newSeller.trim()) return;
    const { data } = await supabase
      .from("sellers")
      .insert({ event_id: id, name: newSeller.trim() })
      .select()
      .single();
    setNewSeller("");
    queryClient.invalidateQueries({ queryKey: ["sellers", id] });
    if (data) chooseMe(data.id);
  }

  async function addSale() {
    if (!me || !buyer.trim()) return;
    setSaving(true);
    await supabase.from("sales").insert({
      event_id: id,
      seller_id: me,
      buyer_name: buyer.trim(),
      room: room.trim() || null,
      paid,
    });
    setSaving(false);
    setBuyer("");
    setRoom("");
    queryClient.invalidateQueries({ queryKey: ["sales", id] });
  }

  async function togglePaid(saleId: string, value: boolean) {
    await supabase.from("sales").update({ paid: value }).eq("id", saleId);
    queryClient.invalidateQueries({ queryKey: ["sales", id] });
  }

  async function removeSale(saleId: string) {
    await supabase.from("sales").delete().eq("id", saleId);
    queryClient.invalidateQueries({ queryKey: ["sales", id] });
  }

  if (eventQ.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  if (!ev) {
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
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold">{ev.name}</h1>
          <p className="text-xs text-muted-foreground">
            {euros(Number(ev.price))} por entrada · {ev.total_tickets} en total
          </p>
        </div>
      </div>

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

      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">¿Quién eres?</Label>
        <div className="mt-3 flex flex-wrap gap-2">
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
        <div className="mt-3 flex gap-2">
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
      </section>

      <section className="mt-4 space-y-3 rounded-2xl border border-border bg-card p-4">
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
        {!me && <p className="text-center text-xs text-muted-foreground">Elige antes quién eres.</p>}
      </section>

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
