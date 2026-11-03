import { NO_CONFIG, supabase } from '../supabase/client';

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string;
  avatar_url: string | null;
  wins: number;
  current_win_streak: number;
  best_win_streak: number;
  fastest_win_seconds: number | null;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIM = 2048;

async function myId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getMyProfile(): Promise<Profile | null> {
  const uid = await myId();
  if (!supabase || !uid) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  return error ? null : (data as Profile | null);
}

/** Devuelve un mensaje de error, o null si todo salió bien. */
export async function updateMyProfile(patch: { username: string; bio: string }): Promise<string | null> {
  if (!supabase) return NO_CONFIG;
  if (!USERNAME_RE.test(patch.username)) return 'Usuario: 3 a 20 caracteres (letras, números o _).';
  if (patch.bio.length > 160) return 'La descripción admite hasta 160 caracteres.';
  const uid = await myId();
  if (!uid) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  const { error } = await supabase.from('profiles').update(patch).eq('id', uid);
  if (error?.code === '23505') return 'Ese nombre de usuario ya está en uso.';
  return error ? 'No se pudo guardar el perfil.' : null;
}

export async function uploadAvatar(file: File): Promise<string | null> {
  if (!supabase) return NO_CONFIG;
  if (!OK_TYPES.includes(file.type)) return 'Formato no permitido (usa PNG, JPG o WebP).';
  if (file.size > MAX_BYTES) return 'La imagen pesa más de 2 MB.';
  try {
    const bmp = await createImageBitmap(file);
    const tooBig = bmp.width > MAX_DIM || bmp.height > MAX_DIM;
    bmp.close();
    if (tooBig) return `Máximo ${MAX_DIM}×${MAX_DIM} píxeles.`;
  } catch {
    return 'No se pudo leer la imagen.';
  }
  const uid = await myId();
  if (!uid) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${uid}/avatar.${ext}`;
  const up = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) return 'No se pudo subir la foto.';
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const { error } = await supabase
    .from('profiles').update({ avatar_url: `${data.publicUrl}?v=${Date.now()}` }).eq('id', uid);
  return error ? 'La foto subió, pero no se pudo guardar en tu perfil.' : null;
}
