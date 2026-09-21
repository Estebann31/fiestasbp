import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PartyPopper, Plus, ChevronRight, Loader2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fetchEvents, euros } from "@/lib/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Contador de entradas | Fiestas" },
      {
        name: "description",
        content:
          "Lleva la cuenta en tiempo real de las entradas vendidas, el dinero recaudado y quién ha vendido cada entrada.",
      },
      { property: "og:title", content: "Contador de entradas | Fiestas" },
      {
        property: "og:description",
        content: "Entradas vendidas, dinero recaudado y listas por vendedor, sincronizado al instante.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [total, setTotal] = useState("80");
  const [price, setPrice] = useState("7");
  const [sellers, setSellers] = useState<string[]>([""]);

  const { data: events, isLoading } = useQuery({ queryKey: ["events"], queryFn: fetchEvents });

  async function createEvent() {
    if (!name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("events")
      .insert({ name: name.trim(), total_tickets: Number(total) || 0, price: Number(price) || 0 })
      .select()
      .single();
    if (error || !data) {
      setSaving(false);
      return;
    }
    const names = sellers.map((n) => n.trim()).filter(Boolean);
    if (names.length) {
      await supabase.from("sellers").insert(names.map((n) => ({ event_id: data.id, name: n })));
    }
    setSaving(false);
    setOpen(false);
    setName("");
    setSellers([""]);
    queryClient.invalidateQueries({ queryKey: ["events"] });
    navigate({ to: "/fiesta/$id", params: { id: data.id } });
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-28 pt-10">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-party text-primary-foreground">
          <PartyPopper className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Entradas</h1>
          <p className="text-sm text-muted-foreground">Contador compartido en directo</p>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {isLoading && (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {events?.map((ev) => (
          <button
            key={ev.id}
            onClick={() => navigate({ to: "/fiesta/$id", params: { id: ev.id } })}
            className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left transition-colors active:bg-secondary"
          >
            <span>
              <span className="block font-display text-lg font-semibold">{ev.name}</span>
              <span className="block text-sm text-muted-foreground">
                {ev.total_tickets} entradas · {euros(Number(ev.price))} cada una
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        ))}
        {!isLoading && events?.length === 0 && !open && (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Todavía no hay ninguna fiesta. Crea la primera.
          </p>
        )}
      </div>

      {open ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Nueva fiesta</h2>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre de la fiesta</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fiesta de fin de curso" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="total">Entradas</Label>
              <Input id="total" type="number" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Precio (€)</Label>
              <Input id="price" type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Vendedores</Label>
            <div className="space-y-2">
              {sellers.map((seller, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={seller}
                    onChange={(e) =>
                      setSellers((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
                    }
                    placeholder={i === 0 ? "Tu nombre" : `Vendedor ${i + 1}`}
                  />
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-muted-foreground"
                    onClick={() => setSellers((prev) => prev.filter((_, j) => j !== i))}
                    disabled={sellers.length === 1}
                    aria-label="Quitar vendedor"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full border border-dashed border-border"
              onClick={() => setSellers((prev) => [...prev, ""])}
            >
              <Plus className="mr-1 h-4 w-4" /> Añadir vendedor
            </Button>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={createEvent} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md bg-gradient-to-t from-background via-background to-transparent p-5 pt-10">
          <Button className="h-12 w-full text-base font-semibold" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-5 w-5" /> Nueva fiesta
          </Button>
        </div>
      )}
    </main>
  );
}
