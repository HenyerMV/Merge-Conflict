import type { PublicChallenge } from '../types';

const MEM = 128;
const v = (id: string, n: number, input: string, expected: string) => ({ id: `${id}-v${n}`, input, expected });

export const PUBLIC_CHALLENGES: readonly PublicChallenge[] = [
  {
    id: 'suma-pares', language: 'python', difficulty: 'easy', title: 'Suma de pares',
    description: 'Recibes una línea con enteros separados por espacios. Imprime la suma de los que sean pares.',
    starterCode: 'nums = list(map(int, input().split()))\n# tu código aquí\n',
    constraints: ['Entrada: una línea de enteros separados por espacios'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('suma-pares', 1, '1 2 3 4', '6'), v('suma-pares', 2, '7 9', '0')],
  },
  {
    id: 'invertir-cadena', language: 'python', difficulty: 'easy', title: 'Invertir cadena',
    description: 'Recibes una línea de texto. Imprímela escrita al revés.',
    starterCode: 's = input()\n# tu código aquí\n',
    constraints: ['Entrada: una línea de texto'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('invertir-cadena', 1, 'hola', 'aloh'), v('invertir-cadena', 2, 'a', 'a')],
  },
  {
    id: 'maximo-lista', language: 'python', difficulty: 'easy', title: 'Máximo de la lista',
    description: 'Recibes enteros separados por espacios (al menos uno). Imprime el mayor, sin usar max().',
    starterCode: 'nums = list(map(int, input().split()))\n# tu código aquí\n',
    constraints: ['No se permite usar max()', 'Entrada: una línea de enteros'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('maximo-lista', 1, '3 9 2', '9'), v('maximo-lista', 2, '-5 -1 -8', '-1')],
  },
  {
    id: 'contar-vocales', language: 'python', difficulty: 'easy', title: 'Contar vocales',
    description: 'Recibes una palabra sin tildes. Imprime cuántas vocales (a, e, i, o, u) tiene, sin distinguir mayúsculas.',
    starterCode: 's = input()\n# tu código aquí\n',
    constraints: ['Sin tildes ni ñ'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('contar-vocales', 1, 'Murcielago', '5'), v('contar-vocales', 2, 'xyz', '0')],
  },
  {
    id: 'es-palindromo', language: 'python', difficulty: 'medium', title: 'Palíndromo',
    description: 'Recibes una frase. Imprime True si es palíndromo (ignorando mayúsculas, espacios y signos) o False si no.',
    starterCode: 's = input()\n# tu código aquí\n',
    constraints: ['Salida exacta: True o False', 'Sin tildes'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('es-palindromo', 1, 'Anita lava la tina', 'True'), v('es-palindromo', 2, 'hola', 'False')],
  },
  {
    id: 'fizzbuzz', language: 'python', difficulty: 'medium', title: 'FizzBuzz',
    description: 'Recibes un entero n. Imprime una línea por cada número de 1 a n: "Fizz" si es múltiplo de 3, "Buzz" si lo es de 5, "FizzBuzz" si lo es de ambos, o el número.',
    starterCode: 'n = int(input())\n# tu código aquí\n',
    constraints: ['1 <= n <= 1000'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('fizzbuzz', 1, '5', '1\n2\nFizz\n4\nBuzz'), v('fizzbuzz', 2, '3', '1\n2\nFizz')],
  },
  {
    id: 'dos-sumas', language: 'python', difficulty: 'medium', title: 'Dos sumas',
    description: 'Línea 1: enteros separados por espacios. Línea 2: el objetivo. Imprime los índices "i j" (i < j) cuyos valores suman el objetivo. Siempre hay una única solución.',
    starterCode: 'nums = list(map(int, input().split()))\ntarget = int(input())\n# tu código aquí\n',
    constraints: ['Salida: dos índices separados por un espacio'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('dos-sumas', 1, '2 7 11 15\n9', '0 1'), v('dos-sumas', 2, '3 2 4\n6', '1 2')],
  },
  {
    id: 'anagramas', language: 'python', difficulty: 'medium', title: 'Anagramas',
    description: 'Recibes dos líneas de texto. Imprime True si son anagramas (ignorando mayúsculas y espacios) o False si no.',
    starterCode: 'a = input()\nb = input()\n# tu código aquí\n',
    constraints: ['Salida exacta: True o False'],
    timeLimitMs: 2000, memoryLimitMb: MEM,
    visibleTests: [v('anagramas', 1, 'Roma\namor', 'True'), v('anagramas', 2, 'casa\ncosa', 'False')],
  },
  {
    id: 'parentesis-balanceados', language: 'python', difficulty: 'hard', title: 'Paréntesis balanceados',
    description: 'Recibes una cadena con (), [] y {}. Imprime True si están bien abiertos, cerrados y anidados, o False si no.',
    starterCode: 's = input()\n# tu código aquí\n',
    constraints: ['Salida exacta: True o False'],
    timeLimitMs: 3000, memoryLimitMb: MEM,
    visibleTests: [v('parentesis-balanceados', 1, '([]{})', 'True'), v('parentesis-balanceados', 2, '(]', 'False')],
  },
  {
    id: 'subcadena-sin-repetir', language: 'python', difficulty: 'hard', title: 'Subcadena sin repetir',
    description: 'Recibes una cadena. Imprime la longitud de la subcadena más larga que no repite caracteres.',
    starterCode: 's = input()\n# tu código aquí\n',
    constraints: ['Longitud máxima de la cadena: 10000'],
    timeLimitMs: 3000, memoryLimitMb: MEM,
    visibleTests: [v('subcadena-sin-repetir', 1, 'abcabcbb', '3'), v('subcadena-sin-repetir', 2, 'bbbbb', '1')],
  },
];
