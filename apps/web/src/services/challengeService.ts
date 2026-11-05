import { PUBLIC_CHALLENGES, buildMatchPlan, type PublicChallenge } from '@merge-conflict/shared';

export const challengeService = {
  async list(): Promise<PublicChallenge[]> {
    return [...PUBLIC_CHALLENGES];
  },
  async getById(id: string): Promise<PublicChallenge | null> {
    return PUBLIC_CHALLENGES.find((c) => c.id === id) ?? null;
  },
  /** En una partida real la semilla la genera el servidor (Fase 7). */
  async planMatch(seed: string): Promise<PublicChallenge[]> {
    return buildMatchPlan(PUBLIC_CHALLENGES, seed);
  },
};
