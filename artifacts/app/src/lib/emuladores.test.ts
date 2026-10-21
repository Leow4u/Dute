import { afterEach, describe, expect, it, vi } from "vitest";

import { EMULADORES, emuladoresLigados } from "./emuladores";

describe("emuladoresLigados", () => {
  it("só liga no desenvolvimento e com VITE_FIREBASE_EMULATORS=1", () => {
    expect(emuladoresLigados({ DEV: true, VITE_FIREBASE_EMULATORS: "1" })).toBe(true);
  });

  it("sem a variável, ou com outro valor, não liga", () => {
    expect(emuladoresLigados({ DEV: true })).toBe(false);
    expect(emuladoresLigados({ DEV: true, VITE_FIREBASE_EMULATORS: "" })).toBe(false);
    expect(emuladoresLigados({ DEV: true, VITE_FIREBASE_EMULATORS: "0" })).toBe(false);
    expect(emuladoresLigados({ DEV: true, VITE_FIREBASE_EMULATORS: "true" })).toBe(false);
  });

  it("em build de produção (DEV falso) não liga nem com a variável", () => {
    expect(emuladoresLigados({ DEV: false, VITE_FIREBASE_EMULATORS: "1" })).toBe(false);
    expect(emuladoresLigados({ VITE_FIREBASE_EMULATORS: "1" })).toBe(false);
  });

  it("as portas são as de firebase.local.json", () => {
    expect(EMULADORES).toEqual({ host: "127.0.0.1", auth: 9199, firestore: 8188, functions: 5101 });
  });
});

const connectAuthEmulator = vi.fn();
const connectFirestoreEmulator = vi.fn();
const connectFunctionsEmulator = vi.fn();

vi.mock("firebase/app", () => ({
  getApps: () => [],
  initializeApp: () => ({ name: "app-de-teste" }),
}));
vi.mock("firebase/auth", () => ({ getAuth: () => ({ nome: "auth" }), connectAuthEmulator }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({ nome: "firestore" }), connectFirestoreEmulator }));
vi.mock("firebase/storage", () => ({ getStorage: () => ({ nome: "storage" }) }));
vi.mock("firebase/functions", () => ({ getFunctions: () => ({ nome: "functions" }), connectFunctionsEmulator }));

const CONFIG = {
  VITE_FIREBASE_API_KEY: "chave-de-teste",
  VITE_FIREBASE_AUTH_DOMAIN: "teste.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "dute-homolog",
  VITE_FIREBASE_STORAGE_BUCKET: "teste.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1",
  VITE_FIREBASE_APP_ID: "1:1:web:1",
};

async function carregar(env: Record<string, string>, dev: boolean) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [chave, valor] of Object.entries({ ...CONFIG, ...env })) vi.stubEnv(chave, valor);
  vi.stubEnv("DEV", dev as unknown as string);
  const firebase = await import("./firebase");
  const { functionsDoApp } = await import("./firebase-functions");
  functionsDoApp(firebase.firebaseApp as never);
}

describe("conexão com os emuladores", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    connectAuthEmulator.mockClear();
    connectFirestoreEmulator.mockClear();
    connectFunctionsEmulator.mockClear();
  });

  it("sem VITE_FIREBASE_EMULATORS nada é conectado, nem no desenvolvimento", async () => {
    await carregar({}, true);
    expect(connectAuthEmulator).not.toHaveBeenCalled();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it("com a variável, mas fora do desenvolvimento (build de produção), nada é conectado", async () => {
    await carregar({ VITE_FIREBASE_EMULATORS: "1" }, false);
    expect(connectAuthEmulator).not.toHaveBeenCalled();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it("no desenvolvimento e com a variável, auth, firestore e functions vão para o emulador", async () => {
    await carregar({ VITE_FIREBASE_EMULATORS: "1" }, true);
    expect(connectAuthEmulator).toHaveBeenCalledWith(expect.anything(), "http://127.0.0.1:9199", { disableWarnings: true });
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 8188);
    expect(connectFunctionsEmulator).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 5101);
  });
});
