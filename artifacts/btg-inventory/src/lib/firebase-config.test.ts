import { describe, expect, it } from "vitest";

import {
  DEMO_PROJECT_ID,
  isDemoModeEnv,
  resolveFirebaseConfig,
} from "./firebase-config";

const productionEnv = {
  VITE_FIREBASE_API_KEY: "prod-key",
  VITE_FIREBASE_AUTH_DOMAIN: "dute-btg.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "dute-btg",
  VITE_FIREBASE_STORAGE_BUCKET: "dute-btg.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_APP_ID: "1:123:web:abc",
};

describe("resolveFirebaseConfig", () => {
  it("usa as variáveis VITE_FIREBASE_* fora do modo demo", () => {
    const config = resolveFirebaseConfig(productionEnv);
    expect(config.projectId).toBe("dute-btg");
    expect(config.apiKey).toBe("prod-key");
    expect(isDemoModeEnv(productionEnv)).toBe(false);
  });

  it("no modo demo ignora a configuração de produção e usa projeto demo-*", () => {
    const config = resolveFirebaseConfig({
      ...productionEnv,
      VITE_DEMO_MODE: "true",
    });
    expect(config.projectId).toBe(DEMO_PROJECT_ID);
    expect(config.projectId.startsWith("demo-")).toBe(true);
    expect(Object.values(config)).not.toContain("prod-key");
    expect(JSON.stringify(config)).not.toContain("dute-btg");
  });

  it("só liga o modo demo com o valor exato 'true'", () => {
    expect(isDemoModeEnv({ VITE_DEMO_MODE: "1" })).toBe(false);
    expect(isDemoModeEnv({ VITE_DEMO_MODE: "false" })).toBe(false);
    expect(isDemoModeEnv({})).toBe(false);
  });

  it("deixa ausentes as variáveis vazias para o aviso de configuração", () => {
    const config = resolveFirebaseConfig({ VITE_FIREBASE_API_KEY: "" });
    expect(config.apiKey).toBeUndefined();
  });
});
