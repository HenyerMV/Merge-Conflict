import { session } from '../game/session';
import { getMyProfile } from '../profile/profileService';
import { NO_CONFIG, supabase } from '../supabase/client';

/** Restaura la sesión al abrir el juego (también al volver de Google). Nunca lanza. */
export async function initAuth(): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const profile = await getMyProfile();
      session.set({ kind: 'user', username: profile?.username ?? 'Jugador' });
    }
    // Sin await dentro del callback (evita bloqueos del cliente de Supabase).
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') session.set({ kind: 'guest' });
    });
  } catch (err) {
    console.error('No se pudo restaurar la sesión', err);
  }
}

export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return NO_CONFIG;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return error ? 'No se pudo iniciar sesión con Google.' : null;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
  session.set({ kind: 'guest' });
}
