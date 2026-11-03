import type { Mood } from '../game/dialogue';

/** CURSOR: bloque de terminal con cara. Diseño original de Merge Conflict. */
const EYE = (x: number, y: number, w: number, hh: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="4" stroke="none"/>`;
const HAPPY_EYES = '<path fill="none" d="M34 58q8-14 16 0M70 58q8-14 16 0"/>';

const FACES: Record<Mood, string> = {
  neutral: `${EYE(36, 42, 12, 20)}${EYE(72, 42, 12, 20)}<path fill="none" d="M46 84h28"/>`,
  happy: `${HAPPY_EYES}<path fill="none" d="M44 76q16 18 32 0"/>`,
  surprised: '<circle cx="42" cy="50" r="9" stroke="none"/><circle cx="78" cy="50" r="9" stroke="none"/><ellipse cx="60" cy="86" rx="9" ry="12" stroke="none"/>',
  confused: `${EYE(36, 42, 12, 20)}${EYE(72, 36, 12, 28)}<path fill="none" d="M42 86q9-9 18 0t18 0"/>`,
  focused: `<path fill="none" d="M32 40l18 8M88 40l-18 8"/>${EYE(36, 54, 14, 6)}${EYE(70, 54, 14, 6)}<path fill="none" d="M50 84h20"/>`,
  celebrating: `${HAPPY_EYES}<path stroke="none" d="M38 74h44q0 24-22 24t-22-24z"/>`,
  disappointed: `${EYE(36, 52, 12, 14)}${EYE(72, 52, 12, 14)}<path fill="none" d="M44 90q16-14 32 0"/><path fill="#4da6ff" stroke="none" d="M84 70q5 8 0 12q-5-4 0-12z"/>`,
};

export interface Avatar {
  el: HTMLElement;
  setMood(m: Mood): void;
}

export function createAvatar(): Avatar {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.innerHTML =
    '<svg viewBox="0 0 120 130" role="img" aria-label="Cursor, tu guía">' +
    '<rect class="av-body" x="16" y="10" width="88" height="100" rx="16"/>' +
    '<g class="av-face" fill="#0b0f1a" stroke="#0b0f1a" stroke-width="5" stroke-linecap="round"></g>' +
    '<rect class="av-caret" x="30" y="118" width="60" height="8" rx="3"/></svg>';
  const face = el.querySelector('.av-face');
  const setMood = (m: Mood): void => {
    if (face) face.innerHTML = FACES[m];
    el.dataset.mood = m;
  };
  setMood('neutral');
  return { el, setMood };
}
