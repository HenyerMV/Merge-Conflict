// SOLO SERVIDOR. Contiene los tests ocultos. Nunca exportar desde index.ts ni importar desde apps/web.
import type { Challenge, TestCase } from '../types';
import { PUBLIC_CHALLENGES } from './catalog.public';

const hid = (id: string, cases: [string, string][]): TestCase[] =>
  cases.map(([input, expected], i) => ({ id: `${id}-h${i + 1}`, input, expected, hidden: true }));

const HIDDEN_TESTS: Record<string, TestCase[]> = {
  'suma-pares': hid('suma-pares', [['10 20 30', '60'], ['-2 -3 4', '2'], ['0', '0']]),
  'invertir-cadena': hid('invertir-cadena', [['Merge Conflict', 'tcilfnoC egreM'], ['12345', '54321']]),
  'maximo-lista': hid('maximo-lista', [['42', '42'], ['1 1 1', '1'], ['-10 0 10 5', '10']]),
  'contar-vocales': hid('contar-vocales', [['AEIOU', '5'], ['programacion', '5'], ['Python', '1']]),
  'es-palindromo': hid('es-palindromo', [
    ['Dabale arroz a la zorra el abad', 'True'], ['No lemon no melon', 'True'], ['ab', 'False'],
  ]),
  'fizzbuzz': hid('fizzbuzz', [
    ['15', '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz'], ['1', '1'],
  ]),
  'dos-sumas': hid('dos-sumas', [['3 3\n6', '0 1'], ['1 5 3 7\n12', '1 3'], ['-1 -2 -3 -4 -5\n-8', '2 4']]),
  'anagramas': hid('anagramas', [['Listen\nSilent', 'True'], ['dormitory\ndirty room', 'True'], ['abc\nabcd', 'False']]),
  'parentesis-balanceados': hid('parentesis-balanceados', [
    ['((()))', 'True'], ['((', 'False'], ['{[(])}', 'False'], [')(', 'False'],
  ]),
  'subcadena-sin-repetir': hid('subcadena-sin-repetir', [['pwwkew', '3'], ['dvdf', '3'], ['a', '1'], ['abcdef', '6']]),
};

export const FULL_CATALOG: readonly Challenge[] = PUBLIC_CHALLENGES.map(({ visibleTests, ...rest }) => {
  const hidden = HIDDEN_TESTS[rest.id];
  if (!hidden) throw new Error(`Faltan tests ocultos para "${rest.id}"`);
  return {
    ...rest,
    tests: [...visibleTests.map((t) => ({ ...t, hidden: false })), ...hidden],
  };
});
