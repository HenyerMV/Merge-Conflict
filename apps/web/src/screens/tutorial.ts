import { DialogueManager, END, type Line } from '../game/dialogue';
import type { Scene } from '../game/scene';
import { markTutorialSeen, tutorialSeen } from '../game/storage';
import { h, sleep } from '../utils/dom';
import { createAvatar } from './avatar';

const STARTER = 'def mayor(nums):\n    # tu código aquí';
const WRONG = 'def mayor(nums):\n    return nums[0]';
const RIGHT = 'def mayor(nums):\n    return max(nums)';

/** Mini-partida de demostración: todo es simulado, no valida nada real. */
function createDemo() {
  const root = h('div', 'demo');
  root.hidden = true;
  root.innerHTML =
    '<div class="demo-head"><span>TÚ <b data-s="you">0</b></span><span>RONDA 1 / 10</span>' +
    '<span><b data-s="rival">0</b> RIVAL</span></div>' +
    '<p class="demo-challenge">Escribe una función que reciba una lista de números y devuelva el mayor.</p>' +
    '<div class="demo-panes"><div><small>TÚ</small><pre data-p="you"></pre></div>' +
    '<div><small>RIVAL (práctica)</small><pre data-p="rival"></pre></div></div>' +
    '<div class="demo-status"></div>';
  const q = (s: string): HTMLElement => {
    const e = root.querySelector<HTMLElement>(s);
    if (!e) throw new Error(`Falta ${s}`);
    return e;
  };
  const you = q('[data-p="you"]');
  const rival = q('[data-p="rival"]');
  const status = q('.demo-status');
  let errors = 0;

  const say = (msg: string, cls = ''): void => {
    status.textContent = msg;
    status.className = `demo-status ${cls}`;
  };

  return {
    el: root,
    show(): void {
      root.hidden = false;
      you.textContent = STARTER;
      say('Intentos del rival: 0/3');
    },
    /** El rival escribe `code`, lo envía y el "servidor" lo valida. */
    async attempt(code: string, ok: boolean): Promise<void> {
      rival.textContent = '';
      for (const ch of code) {
        rival.textContent += ch;
        await sleep(30);
      }
      await sleep(400);
      say('VALIDANDO…', 'wait');
      await sleep(1000);
      if (ok) {
        q('[data-s="rival"]').textContent = '1';
        say('✔ Correcto: +1 punto para el rival. Termina la ronda.', 'ok');
      } else {
        errors += 1;
        say(`✗ Salida incorrecta. Intento ${errors}/3`, 'err');
      }
    },
  };
}

export const tutorialScene: Scene = {
  mount(el, nav) {
    const firstTime = !tutorialSeen();
    const avatar = createAvatar();
    const box = h('div');
    const demo = createDemo();
    el.append(avatar.el, box, demo.el);

    const script: Line[] = [
      {
        text: '¡Hola! Soy CURSOR, tu guía en MERGE CONFLICT.', mood: 'happy',
        choices: [
          { label: 'Explícame cómo se juega', next: 1 },
          { label: 'Ya sé jugar, saltar', next: END },
        ],
      },
      { text: 'Dos jugadores reciben el mismo reto de código y compiten por resolverlo primero. Gana la ronda quien envíe una solución correcta antes.', mood: 'neutral' },
      { text: 'Mira una ronda de ejemplo. Aparece un desafío y los dos reciben exactamente la misma tarea.', mood: 'focused', run: async () => { demo.show(); await sleep(600); } },
      { text: 'Mi rival de práctica escribe su solución y la envía…', mood: 'focused', run: () => demo.attempt(WRONG, false) },
      { text: '¡Falló! Cada jugador tiene 3 intentos. Al tercer error pierde la ronda y el rival suma el punto.', mood: 'confused' },
      { text: 'Lo intenta de nuevo…', mood: 'focused', run: () => demo.attempt(RIGHT, true) },
      { text: 'Correcto. El servidor valida el código y decide el ganador; tu navegador nunca decide. ¡Y la ronda termina al instante!', mood: 'celebrating' },
      { text: 'Son 10 rondas y gana quien llegue primero a 6 puntos. Si quedan 5-5, hay una ronda de desempate de muerte súbita.', mood: 'surprised' },
      { text: 'Puedes jugar como invitado o con cuenta para guardar tus hitos: racha, partidas ganadas y victoria más rápida. ¡Vamos!', mood: 'happy' },
    ];

    let left = false;
    const dm = new DialogueManager(box, avatar.setMood);
    void dm.play(script).then(() => {
      if (left) return;
      markTutorialSeen();
      nav.go(firstTime ? 'account' : 'menu');
    });
    return () => {
      left = true;
      dm.stop();
    };
  },
};
