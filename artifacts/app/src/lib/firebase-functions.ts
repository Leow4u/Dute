import type { FirebaseApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

import { EMULADORES, EMULADORES_LIGADOS } from "./emuladores";

export const REGIAO_DAS_FUNCTIONS = "southamerica-east1";

/**
 * O `getFunctions` do app, na região das callables. Todo código que chama
 * callable passa por aqui, para o modo local (emuladores) valer em um lugar
 * só. Sem VITE_FIREBASE_EMULATORS=1 no desenvolvimento, é o getFunctions puro.
 */
export function functionsDoApp(app: FirebaseApp): Functions {
  const functions = getFunctions(app, REGIAO_DAS_FUNCTIONS);
  if (EMULADORES_LIGADOS) connectFunctionsEmulator(functions, EMULADORES.host, EMULADORES.functions);
  return functions;
}
