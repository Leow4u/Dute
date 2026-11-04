import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { blogApi } from "./api";

let configuredEmulator = false;

export async function loginWithPassword(
  config: FirebaseOptions,
  email: string,
  password: string,
  authEmulatorUrl?: string,
) {
  const app =
    getApps().find((item) => item.name === "dutelog-blog") ||
    initializeApp(config, "dutelog-blog");
  const auth = getAuth(app);
  if (authEmulatorUrl && !configuredEmulator) {
    const currentHost = window.location.hostname;
    const emulator = new URL(authEmulatorUrl);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(currentHost) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(emulator.hostname)
    ) {
      throw new Error("Configuração de acesso indisponível neste endereço.");
    }
    connectAuthEmulator(auth, emulator.origin, { disableWarnings: true });
    configuredEmulator = true;
  }
  await setPersistence(auth, inMemoryPersistence);
  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password,
    );
    return await blogApi.login(await credential.user.getIdToken(true));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code?.startsWith("auth/")) {
      if (code === "auth/too-many-requests")
        throw new Error(
          "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
        );
      if (code === "auth/network-request-failed")
        throw new Error(
          "Não foi possível conectar. Confira sua conexão e tente novamente.",
        );
      throw new Error(
        "Não foi possível entrar. Confira seu e-mail e sua senha.",
      );
    }
    throw error;
  } finally {
    await signOut(auth).catch(() => undefined);
  }
}
