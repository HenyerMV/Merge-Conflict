import type { Challenge, PublicChallenge } from '../types';

/** Convierte un desafío completo a lo que puede ver el cliente (sin tests ocultos). */
export function toPublicChallenge(challenge: Challenge): PublicChallenge {
  const { tests, ...rest } = challenge;
  return {
    ...rest,
    visibleTests: tests
      .filter((t) => !t.hidden)
      .map(({ id, input, expected }) => ({ id, input, expected })),
  };
}
