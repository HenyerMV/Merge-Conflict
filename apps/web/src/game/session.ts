/**
 * Identidad del jugador en el cliente. Solo presentación:
 * las estadísticas oficiales las escribe el servidor (Fase 4 conectará Supabase Auth).
 */
export type Identity =
  | { kind: 'guest' }
  | { kind: 'user'; username: string };

let identity: Identity = { kind: 'guest' };

export const session = {
  get identity(): Identity {
    return identity;
  },
  isGuest(): boolean {
    return identity.kind === 'guest';
  },
  set(next: Identity): void {
    identity = next;
  },
};

/** Vista previa en desarrollo: abre http://localhost:5173/?user=Henyer para ver el menú de cuenta. */
export function applyDevPreview(): void {
  const name = new URLSearchParams(location.search).get('user');
  if (name) session.set({ kind: 'user', username: name.slice(0, 20) });
}
