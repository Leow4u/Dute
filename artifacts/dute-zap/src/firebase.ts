import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const faltando = Object.entries(firebaseConfig)
  .filter(([, valor]) => !valor)
  .map(([chave]) => chave);

export const firebaseConfigError = faltando.length > 0 ? `Firebase não configurado: ${faltando.join(", ")}` : null;

export const firebaseApp: FirebaseApp | null = firebaseConfigError ? null : initializeApp(firebaseConfig);

export const firebaseAuth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;

export const firestore: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null;

export const functions: Functions | null = firebaseApp ? getFunctions(firebaseApp, "southamerica-east1") : null;
