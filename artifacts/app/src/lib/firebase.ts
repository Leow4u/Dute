import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

import { EMULADORES, EMULADORES_LIGADOS } from "./emuladores";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

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

// Modo local (docs/plataforma/ambiente-local.md): só no desenvolvimento e com
// VITE_FIREBASE_EMULATORS=1. Em build de produção este ramo não existe.
if (EMULADORES_LIGADOS && firebaseAuth) {
  connectAuthEmulator(firebaseAuth, `http://${EMULADORES.host}:${EMULADORES.auth}`, { disableWarnings: true });
}

export const firestore: Firestore | null = firebaseApp
  ? getFirestore(firebaseApp)
  : null;

if (EMULADORES_LIGADOS && firestore) {
  try {
    connectFirestoreEmulator(firestore, EMULADORES.host, EMULADORES.firestore);
  } catch {
    // Recarga a quente do Vite: o Firestore já está ligado ao emulador.
  }
}

export const firebaseStorage: FirebaseStorage | null = firebaseApp
  ? getStorage(firebaseApp)
  : null;
