import { h } from '../utils/dom';

export type Mood =
  | 'neutral' | 'happy' | 'surprised' | 'confused'
  | 'focused' | 'celebrating' | 'disappointed';

export interface Choice { label: string; next: number }

export interface Line {
  speaker?: string;
  mood?: Mood;
  text: string;
  /** Se ejecuta tras mostrar el texto (animaciones, demos, pausas). */
  run?: () => Promise<void>;
  /** Si existe, el jugador elige cómo continuar en vez de pulsar SIGUIENTE. */
  choices?: Choice[];
}

export const END = Number.POSITIVE_INFINITY;

export class DialogueManager {
  private readonly nameEl = h('strong', 'dlg-name');
  private readonly textEl = h('p', 'dlg-text');
  private readonly actions = h('div', 'dlg-actions');
  private timer: number | undefined;
  private dead = false;

  constructor(private readonly box: HTMLElement, private readonly setMood: (m: Mood) => void) {
    box.classList.add('dlg');
    box.append(this.nameEl, this.textEl, this.actions);
  }

  async play(lines: Line[]): Promise<void> {
    let i = 0;
    while (!this.dead && i < lines.length) {
      const line = lines[i];
      if (!line) return;
      this.setMood(line.mood ?? 'neutral');
      this.nameEl.textContent = line.speaker ?? 'CURSOR';
      this.actions.replaceChildren();
      await this.type(line.text);
      if (this.dead) return;
      if (line.run) {
        await line.run();
        if (this.dead) return;
      }
      if (line.choices) {
        i = await this.choose(line.choices);
      } else {
        await this.next();
        i += 1;
      }
    }
  }

  stop(): void {
    this.dead = true;
    window.clearInterval(this.timer);
  }

  /** Efecto máquina de escribir; un clic en el cuadro lo completa. */
  private type(text: string): Promise<void> {
    return new Promise((resolve) => {
      let n = 0;
      const finish = (): void => {
        window.clearInterval(this.timer);
        this.box.removeEventListener('click', finish);
        this.textEl.textContent = text;
        resolve();
      };
      this.box.addEventListener('click', finish);
      this.timer = window.setInterval(() => {
        n += 1;
        this.textEl.textContent = text.slice(0, n);
        if (n >= text.length) finish();
      }, 18);
    });
  }

  private next(): Promise<void> {
    return new Promise((resolve) => {
      const b = h('button', 'btn btn-small', 'SIGUIENTE ▸');
      b.addEventListener('click', () => resolve(), { once: true });
      this.actions.replaceChildren(b);
      b.focus();
    });
  }

  private choose(choices: Choice[]): Promise<number> {
    return new Promise((resolve) => {
      const buttons = choices.map((c) => {
        const b = h('button', 'btn btn-small', c.label);
        b.addEventListener('click', () => resolve(c.next), { once: true });
        return b;
      });
      this.actions.replaceChildren(...buttons);
      buttons[0]?.focus();
    });
  }
}
