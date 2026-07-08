import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

import { isDemoMode } from "./demo-mode";

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
  !isDemoMode && missingConfig.length > 0
    ? `Firebase não configurado: ${missingConfig.join(", ")}`
    : null;

export const firebaseApp: FirebaseApp | null =
  !firebaseConfigError && !isDemoMode
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
