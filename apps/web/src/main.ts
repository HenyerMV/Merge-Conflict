import './styles/main.css';
import './styles/tutorial.css';
import './styles/profile.css';
import { SceneManager, type Scene, type SceneId } from './game/scene';
import { applyDevPreview } from './game/session';
import { accountScene, bootScene, menuScene, placeholder } from './screens/scenes';
import { profileScene } from './screens/profile';
import { tutorialScene } from './screens/tutorial';

const scenes: Record<SceneId, Scene> = {
  boot: bootScene,
  menu: menuScene,
  tutorial: tutorialScene,
  account: accountScene,
  lobby: placeholder('LOBBY', 'Fase 7', 'Matchmaking 1v1 contra otro jugador (el servidor decide).'),
  profile: profileScene,
  achievements: placeholder('HITOS', 'Fase 8', 'Racha, partidas ganadas y victoria más rápida.'),
  settings: placeholder('AJUSTES', 'Fase 9', 'Volumen, sonido y música.'),
};

const root = document.getElementById('app');
if (!root) throw new Error('Falta el contenedor #app');

applyDevPreview();
new SceneManager(root, scenes).go('boot');
