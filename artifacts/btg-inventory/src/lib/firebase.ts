import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";

import {
  DEMO_EMULATORS,
  isDemoModeEnv,
  resolveFirebaseConfig,
} from "./firebase-config";

/** Modo demo: dados fictícios em emuladores locais. Ver docs/modo-demo.md. */
export const isDemoMode = isDemoModeEnv(import.meta.env);

const firebaseConfig = resolveFirebaseConfig(import.meta.env);

const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const firebaseConfigError =
  missingConfig.length > 0
    ? `Firebase não configurado: ${missingConfig.join(", ")}`
    : null;

export const firebaseApp: FirebaseApp | null =
  !firebaseConfigError
    ? getApps()[0] ?? initializeApp(firebaseConfig)
    : null;

export const firebaseAuth: Auth | null = firebaseApp
  ? getAuth(firebaseApp)
  : null;

export const firestore: Firestore | null = firebaseApp
  ? getFirestore(firebaseApp)
  : null;

export const firebaseStorage: FirebaseStorage | null = firebaseApp
  ? getStorage(firebaseApp)
  : null;

if (isDemoMode && firebaseApp && firebaseAuth && firestore) {
  const { host, authPort, firestorePort, functionsPort } = DEMO_EMULATORS;
  connectAuthEmulator(firebaseAuth, `http://${host}:${authPort}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(firestore, host, firestorePort);
  // getFunctions devolve a mesma instância por região; App.tsx e
  // functions-api.ts passam a usar o emulador sem mudança.
  connectFunctionsEmulator(
    getFunctions(firebaseApp, "southamerica-east1"),
    host,
    functionsPort,
  );
}
