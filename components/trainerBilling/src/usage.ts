interface Relation { clientId?: unknown; clientEmail?: string | null; status?: string | null }
const email = (value: string | null | undefined): string => String(value || "").trim().toLowerCase();

// Merge the two scopes and pending email-only invitations into one billable client.
export function billableClientKeys(relations: Relation[]): Set<string> {
  const idByEmail = new Map<string, string>();
  for (const relation of relations) {
    if (relation.clientId && email(relation.clientEmail)) idByEmail.set(email(relation.clientEmail), String(relation.clientId));
  }
  return new Set(relations.map((relation) => {
    const resolvedId = relation.clientId ? String(relation.clientId) : idByEmail.get(email(relation.clientEmail));
    return resolvedId ? `id:${resolvedId}` : `email:${email(relation.clientEmail)}`;
  }));
}

// Plazas ocupadas (clientes que ya aceptaron) y reservadas (invitaciones sin aceptar de
// personas que todavía no ocupan plaza). Una persona cuenta una vez aunque tenga dos scopes.
export function seatUsage(relations: Relation[]): { occupied: number; reserved: number } {
  const keys = billableClientKeys(relations);
  const occupiedKeys = billableClientKeys(relations.filter((relation) => relation.status !== "pending"));
  return { occupied: occupiedKeys.size, reserved: keys.size - occupiedKeys.size };
}
