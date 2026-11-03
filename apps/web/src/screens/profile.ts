import type { Scene } from '../game/scene';
import { session } from '../game/session';
import { getMyProfile, updateMyProfile, uploadAvatar, type Profile } from '../profile/profileService';
import { h } from '../utils/dom';

function fmtTime(s: number | null): string {
  if (s === null) return '—';
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

function stat(label: string, value: string): HTMLElement {
  const box = h('div', 'pf-stat');
  box.append(h('b', undefined, value), h('small', undefined, label));
  return box;
}

function renderProfile(el: HTMLElement, p: Profile, back: HTMLElement): void {
  const avatar: HTMLElement = p.avatar_url
    ? Object.assign(h('img', 'pf-avatar'), { src: p.avatar_url, alt: 'Foto de perfil' })
    : h('div', 'pf-avatar', p.username.slice(0, 1).toUpperCase());

  const fileInput = h('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp';
  const status = h('p', 'pf-status');

  const name = h('input', 'pf-input');
  name.value = p.username;
  name.maxLength = 20;
  name.setAttribute('aria-label', 'Nombre de usuario');
  const bio = h('textarea', 'pf-input');
  bio.value = p.bio;
  bio.maxLength = 160;
  bio.rows = 3;
  bio.placeholder = 'Descripción (máx. 160 caracteres)';
  bio.setAttribute('aria-label', 'Descripción');

  const save = h('button', 'btn btn-primary', 'GUARDAR');
  save.addEventListener('click', async () => {
    status.textContent = 'Guardando…';
    const err = await updateMyProfile({ username: name.value.trim(), bio: bio.value.trim() });
    status.textContent = err ?? '✔ Perfil actualizado';
    if (!err) session.set({ kind: 'user', username: name.value.trim() });
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = 'Subiendo foto…';
    const err = await uploadAvatar(file);
    if (err) { status.textContent = err; return; }
    const fresh = await getMyProfile();
    if (fresh) renderProfile(el, fresh, back);
  });

  const stats = h('div', 'pf-stats');
  stats.append(
    stat('Partidas ganadas', String(p.wins)),
    stat('Racha actual', String(p.current_win_streak)),
    stat('Mejor racha', String(p.best_win_streak)),
    stat('Victoria más rápida', fmtTime(p.fastest_win_seconds)),
  );

  const form = h('div', 'pf-form');
  form.append(fileInput, name, bio, save, status);
  el.replaceChildren(h('h2', 'ph-title', 'PERFIL'), avatar, form, stats, back);
}

export const profileScene: Scene = {
  mount(el, nav) {
    const back = h('button', 'btn', '← VOLVER');
    back.addEventListener('click', () => nav.go('menu'));

    if (session.isGuest()) {
      const login = h('button', 'btn btn-primary', 'INICIAR SESIÓN');
      login.addEventListener('click', () => nav.go('account'));
      el.append(
        h('h2', 'ph-title', 'PERFIL TEMPORAL'),
        h('p', 'ph-note', 'Como invitado no se guardan estadísticas ni hitos. Inicia sesión para conservar tu progreso.'),
        login, back,
      );
      return;
    }

    el.append(h('h2', 'ph-title', 'PERFIL'), h('p', 'ph-note', 'Cargando…'));
    let left = false;
    void getMyProfile().then((p) => {
      if (left) return;
      if (p) renderProfile(el, p, back);
      else el.replaceChildren(h('p', 'error', 'No se pudo cargar tu perfil.'), back);
    });
    return () => { left = true; };
  },
};
