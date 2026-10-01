export type FirebaseWebConfig = {
  apiKey: string | undefined;
  authDomain: string | undefined;
  projectId: string | undefined;
  storageBucket: string | undefined;
  messagingSenderId: string | undefined;
  appId: string | undefined;
};

type FirebaseEnv = Partial<Record<string, string | boolean | undefined>>;

/**
 * Projeto do modo demo. O prefixo `demo-` faz o SDK do Firebase tratar o
 * projeto como exclusivamente local: sem emulador, nada é lido nem escrito.
 */
export const DEMO_PROJECT_ID = "demo-dute";

export const DEMO_EMULATORS = {
  host: "127.0.0.1",
  authPort: 9099,
  firestorePort: 8088,
  functionsPort: 5001,
} as const;

export function isDemoModeEnv(env: FirebaseEnv) {
  return env.VITE_DEMO_MODE === "true";
}

/**
 * No modo demo a configuração ignora as variáveis VITE_FIREBASE_* de
 * propósito: um `.env` de produção na máquina não pode fazer a demo apontar
 * para o projeto real.
 */
export function resolveFirebaseConfig(env: FirebaseEnv): FirebaseWebConfig {
  if (isDemoModeEnv(env)) {
    return {
      apiKey: "demo-api-key",
      authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
      projectId: DEMO_PROJECT_ID,
      storageBucket: `${DEMO_PROJECT_ID}.appspot.com`,
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:demo",
    };
  }

  const read = (key: string) => {
    const value = env[key];
    return typeof value === "string" && value ? value : undefined;
  };

  return {
    apiKey: read("VITE_FIREBASE_API_KEY"),
    authDomain: read("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: read("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: read("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: read("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: read("VITE_FIREBASE_APP_ID"),
  };
}
