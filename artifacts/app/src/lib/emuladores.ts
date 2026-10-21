/**
 * Modo local com emuladores (docs/plataforma/ambiente-local.md).
 *
 * Só liga quando as DUAS condições valem: o servidor de desenvolvimento do
 * Vite (`import.meta.env.DEV`) e `VITE_FIREBASE_EMULATORS=1`. Num build de
 * produção `DEV` é falso e o Vite remove o ramo; sem a variável nada muda,
 * nem no desenvolvimento apontado para a nuvem.
 *
 * As portas são as de `firebase.local.json` (na raiz do repositório).
 */

export const EMULADORES = {
  host: "127.0.0.1",
  auth: 9199,
  firestore: 8188,
  functions: 5101,
} as const;

export function emuladoresLigados(env: { DEV?: boolean; VITE_FIREBASE_EMULATORS?: string }): boolean {
  return env.DEV === true && env.VITE_FIREBASE_EMULATORS === "1";
}

/** Valor deste build. Os testes chamam emuladoresLigados com o ambiente explícito. */
export const EMULADORES_LIGADOS = emuladoresLigados(import.meta.env);
