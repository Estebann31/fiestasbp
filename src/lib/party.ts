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

export function euros(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

// ---- Acceso guardado en este móvil ----
// El PIN de cada fiesta se guarda solo en este dispositivo para no pedirlo siempre.

export type SavedParty = { id: string; name: string; pin: string };

const KEY = (id: string) => `party:${id}`;

export function getSavedParty(id: string): SavedParty | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as SavedParty) : null;
  } catch {
    return null;
  }
}

export function saveParty(p: SavedParty) {
  try {
    localStorage.setItem(KEY(p.id), JSON.stringify(p));
  } catch {
    /* sin almacenamiento: habrá que meter el PIN otra vez */
  }
}

export function forgetParty(id: string) {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* nada */
  }
}

export function listSavedParties(): SavedParty[] {
  const out: SavedParty[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("party:")) continue;
      const p = JSON.parse(localStorage.getItem(k) ?? "null") as SavedParty | null;
      if (p?.id && p.pin) out.push(p);
    }
  } catch {
    /* nada */
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function errorMessage(code: string): string {
  switch (code) {
    case "WRONG_PIN":
      return "PIN incorrecto.";
    case "LOCKED":
      return "Demasiados intentos fallidos. Espera 10 minutos.";
    case "NOT_FOUND":
      return "No encontramos esta fiesta.";
    case "INVALID":
      return "Datos no válidos.";
    default:
      return "Algo ha fallado. Revisa la conexión e inténtalo otra vez.";
  }
}
