import type { Navigator, Scene, SceneId } from '../game/scene';
import { initAuth, signInWithGoogle, signOut } from '../auth/authService';
import { tutorialSeen } from '../game/storage';
import { session } from '../game/session';
import { h } from '../utils/dom';

function logo(): HTMLElement {
  const box = h('div', 'logo');
  box.append(h('span', 'logo-a', 'MERGE'), h('span', 'logo-b', 'CONFLICT'));
  return box;
}

/** Fase 3 insertará aquí la decisión: tutorial (primera vez) o menú. */
export const bootScene: Scene = {
  mount(el, nav) {
    const bar = h('div', 'progress');
    const fill = h('i');
    bar.append(fill);
    el.append(logo(), h('p', 'tagline', 'el código es el campo de batalla'), bar);
    requestAnimationFrame(() => (fill.style.width = '100%'));
    let left = false;
    const minDelay = new Promise<void>((r) => window.setTimeout(r, 1400));
    void Promise.all([initAuth(), minDelay]).then(() => {
      if (left) return;
      nav.go(!session.isGuest() || tutorialSeen() ? 'menu' : 'tutorial');
    });
    return () => { left = true; };
  },
};

interface MenuItem { label: string; to: SceneId; primary?: boolean }

function menuItems(): MenuItem[] {
  return session.isGuest()
    ? [
        { label: 'JUGAR', to: 'lobby', primary: true },
        { label: 'PERFIL TEMPORAL', to: 'profile' },
        { label: 'TUTORIAL', to: 'tutorial' },
        { label: 'AJUSTES', to: 'settings' },
        { label: 'INICIAR SESIÓN', to: 'account' },
      ]
    : [
        { label: 'JUGAR', to: 'lobby', primary: true },
        { label: 'PERFIL', to: 'profile' },
        { label: 'HITOS / LOGROS', to: 'achievements' },
        { label: 'TUTORIAL', to: 'tutorial' },
        { label: 'AJUSTES', to: 'settings' },
        { label: 'CERRAR SESIÓN', to: 'account' },
      ];
}

export const menuScene: Scene = {
  mount(el, nav: Navigator) {
    const who = session.identity.kind === 'user' ? session.identity.username : 'Invitado';
    const list = h('nav', 'menu');
    for (const item of menuItems()) {
      const b = h('button', item.primary ? 'btn btn-primary' : 'btn', item.label);
      b.addEventListener('click', () => nav.go(item.to));
      list.append(b);
    }
    el.append(logo(), h('p', 'who', `Jugando como ${who}`), list);
    list.querySelector('button')?.focus();
  },
};

/** Pantalla provisoria para escenas que se construyen en fases posteriores. */
export function placeholder(title: string, phase: string, note: string): Scene {
  return {
    mount(el, nav) {
      const back = h('button', 'btn', '← VOLVER');
      back.addEventListener('click', () => nav.go('menu'));
      el.append(
        h('h2', 'ph-title', title),
        h('p', 'ph-phase', `Disponible en ${phase}`),
        h('p', 'ph-note', note),
        back,
      );
      back.focus();
    },
  };
}

/** Elección de identidad. Fase 4 conectará Google (Supabase Auth). */
export const accountScene: Scene = {
  mount(el, nav) {
    const note = h('p', 'ph-note', 'Como invitado puedes jugar, pero tus hitos no se guardan.');
    const list = h('nav', 'menu');
    const guest = h('button', 'btn btn-primary', 'CONTINUAR COMO INVITADO');
    guest.addEventListener('click', () => { session.set({ kind: 'guest' }); nav.go('menu'); });
    const google = h('button', 'btn', 'INICIAR CON GOOGLE');
    google.addEventListener('click', async () => {
      note.textContent = 'Abriendo Google…';
      const err = await signInWithGoogle();
      if (err) note.textContent = err;
    });
    list.append(guest, google);
    if (!session.isGuest()) {
      const out = h('button', 'btn', 'CERRAR SESIÓN');
      out.addEventListener('click', async () => { await signOut(); nav.go('menu'); });
      list.append(out);
    }
    el.append(h('h2', 'ph-title', '¿CÓMO QUIERES JUGAR?'), list, note);
    guest.focus();
  },
};
