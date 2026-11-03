/** Sistema de escenas: cada pantalla es una Scene; el SceneManager navega entre ellas. */
export type SceneId =
  | 'boot' | 'menu' | 'tutorial' | 'lobby'
  | 'profile' | 'achievements' | 'settings' | 'account';

export interface Navigator {
  go(id: SceneId): void;
}

/** mount recibe su contenedor y puede devolver una función de limpieza. */
export interface Scene {
  mount(el: HTMLElement, nav: Navigator): void | (() => void);
}

export class SceneManager implements Navigator {
  private cleanup: (() => void) | undefined;
  private current: SceneId | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly scenes: Record<SceneId, Scene>,
  ) {}

  go(id: SceneId): void {
    this.cleanup?.();
    this.cleanup = undefined;
    const el = document.createElement('section');
    el.className = `scene scene-${id}`;
    this.root.replaceChildren(el);
    this.current = id;
    try {
      this.cleanup = this.scenes[id].mount(el, this) ?? undefined;
    } catch (err) {
      console.error(`Error al montar la escena "${id}"`, err);
      el.innerHTML = '<p class="error">Algo falló al cargar esta pantalla.</p>';
    }
  }

  get currentScene(): SceneId | undefined {
    return this.current;
  }
}
