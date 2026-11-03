/** Solo guarda si ya se vio el tutorial (no es progreso competitivo). */
const KEY = 'mc.tutorialDone';

export function tutorialSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function markTutorialSeen(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* almacenamiento no disponible */ }
}
