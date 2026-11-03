// Contratos de dominio compartidos entre cliente y servidor.
// REGLA: el cliente presenta, el servidor decide.

export type LanguageId = 'python'; // futuro: 'javascript' | 'java' | 'cpp' | 'csharp'
export type Difficulty = 'easy' | 'medium' | 'hard';
export type MatchMode = 'duel_1v1' | 'battle_royale_4'; // el 2.º no se implementa en el MVP

export interface TestCase {
  id: string;
  input: string;            // se pasa al ejecutor (stdin o argumentos serializados)
  expected: string;         // salida esperada normalizada
  hidden: boolean;          // los tests ocultos nunca viajan al cliente
}

export interface Challenge {
  id: string;
  language: LanguageId;
  difficulty: Difficulty;
  title: string;
  description: string;
  starterCode: string;
  tests: TestCase[];        // el servidor los usa completos
  constraints: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

// Lo único que ve el cliente de un desafío (sin tests ocultos).
export type PublicChallenge = Omit<Challenge, 'tests'> & { visibleTests: Pick<TestCase, 'id' | 'input' | 'expected'>[] };

export type MatchStatus =
  | 'WAITING' | 'MATCH_FOUND' | 'READY' | 'ROUND_START' | 'CODING' | 'SUBMISSION'
  | 'VALIDATING' | 'ROUND_RESULT' | 'NEXT_ROUND' | 'MATCH_RESULT' | 'RETURN_TO_LOBBY' | 'ABANDONED';

export type SubmissionVerdict =
  | 'correct' | 'wrong_output' | 'syntax_error' | 'runtime_error' | 'time_limit' | 'memory_limit' | 'sandbox_error';

export type RoundEndReason = 'solved' | 'three_errors' | 'opponent_left' | 'timeout';

export interface MatchConfig {
  totalRounds: number;          // 10
  pointsToWin: number;          // 6
  maxAttemptsPerRound: number;  // 3
  tiebreak: 'sudden_death' | 'draw';
  reconnectGraceMs: number;     // 15000
  roundTimeLimitMs: number;     // límite oficial de ronda (servidor)
}

export interface PlayerRef { id: string; isGuest: boolean; displayName: string }

export interface Submission {
  roundId: string;
  playerId: string;
  attempt: number;              // 1..maxAttempts
  code: string;
  serverReceivedAt: number;     // ms epoch, asignado por el servidor
  seq: number;                  // contador monótono del servidor (desempate)
}

export interface ValidationResult {
  verdict: SubmissionVerdict;
  passed: number;
  total: number;
  executionMs: number;
  message?: string;             // mensaje seguro para mostrar (sin filtrar tests ocultos)
}

export interface PlayerStats {
  wins: number;
  currentWinStreak: number;
  bestWinStreak: number;
  fastestWinSeconds: number | null;
}
