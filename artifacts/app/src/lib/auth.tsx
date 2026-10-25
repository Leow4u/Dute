import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  onSnapshot,
  type DocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

import { firebaseAuth, firestore } from "./firebase";
import { profileAccess } from "./access";
import { type ProfileRole } from "./modules";
import { esquecerPerfis, guardarPerfil, perfilGuardado } from "./perfil-guardado";

export type Role = "interno" | "cliente";

export type AppUser = {
  uid: string;
  fullName: string;
  imageUrl: string;
  primaryEmailAddress: {
    emailAddress: string;
  };
  publicMetadata: {
    role: ProfileRole;
    customer_code?: string;
  };
};

type AuthContextValue = {
  firebaseUser: User | null;
  user: AppUser | null;
  isLoaded: boolean;
  accessDenied: boolean;
  /** Acesso removido em Pessoas e acessos (mensagem própria no login). */
  accessRemoved?: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  user: null,
  isLoaded: false,
  accessDenied: false,
});

type ProfileData = {
  role: ProfileRole;
  customer_code?: string;
  nome?: string;
};

function toAppUser(firebaseUser: User, profile: ProfileData): AppUser {
  return {
    uid: firebaseUser.uid,
    fullName:
      profile.nome ||
      firebaseUser.displayName ||
      firebaseUser.email?.split("@")[0] ||
      "Usuário",
    imageUrl: firebaseUser.photoURL || "",
    primaryEmailAddress: {
      emailAddress: firebaseUser.email || "",
    },
    publicMetadata: {
      role: profile.role,
      customer_code: profile.customer_code,
    },
  };
}

function profileFromSnapshot(snapshot: DocumentSnapshot): ProfileData | null {
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as {
    role?: unknown;
    customer_code?: unknown;
    nome?: unknown;
  };
  const access = profileAccess(data);
  if (access.state !== "active") return null;
  const role = access.role;

  return {
    role,
    customer_code:
      typeof data.customer_code === "string" ? data.customer_code : undefined,
    nome: typeof data.nome === "string" ? data.nome : undefined,
  };
}

function isRemoved(snapshot: DocumentSnapshot) {
  return snapshot.exists() && profileAccess(snapshot.data()).state === "removed";
}

/** Sem sinal, o getDoc recusa com "unavailable": o cache do Firestore é só o da memória. */
function semRede(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "unavailable";
}

/** Até a rede voltar, ou 30 segundos: o evento "online" não vem quando o navegador já se acha conectado. */
function esperarRede(): Promise<void> {
  return new Promise((resolve) => {
    const pronto = () => {
      clearTimeout(prazo);
      window.removeEventListener("online", pronto);
      resolve();
    };
    const prazo = setTimeout(pronto, 30_000);
    window.addEventListener("online", pronto);
  });
}

async function loadProfile(
  firebaseUser: User,
): Promise<{ profile: ProfileData | null; removed: boolean }> {
  if (!firestore) return { profile: null, removed: false };
  const ref = doc(firestore, "users", firebaseUser.uid);
  try {
    const snapshot = await getDoc(ref);
    const profile = profileFromSnapshot(snapshot);
    guardarPerfil(firebaseUser.uid, profile);
    return { profile, removed: isRemoved(snapshot) };
  } catch (error) {
    // Sem sinal, vale o último perfil lido neste aparelho; o onSnapshot do
    // perfil confirma ou tira o acesso quando a rede voltar.
    const guardado = semRede(error) ? perfilGuardado(firebaseUser.uid) : null;
    if (guardado) return { profile: guardado, removed: false };
    throw error;
  }
}

/**
 * Sem sinal e sem perfil guardado, tenta de novo quando a rede voltar. Null
 * quando a sessão mudou no meio da espera.
 */
async function loadProfileWithNetwork(firebaseUser: User, current: () => boolean) {
  for (;;) {
    try {
      return await loadProfile(firebaseUser);
    } catch (error) {
      if (!semRede(error)) throw error;
      if (!current()) return null;
      await esperarRede();
      if (!current()) return null;
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextValue>({
    firebaseUser: null,
    user: null,
    isLoaded: false,
    accessDenied: false,
  });

  useEffect(() => {
    const auth = firebaseAuth;
    let unsubscribeProfile: Unsubscribe | undefined;
    // Cada mudança da sessão vira uma geração; a leitura que espera a rede
    // não grava o estado de uma sessão que já mudou.
    let generation = 0;

    if (!auth) {
      setState({
        firebaseUser: null,
        user: null,
        isLoaded: true,
        accessDenied: false,
      });
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      const mine = ++generation;
      const current = () => mine === generation;

      if (!firebaseUser) {
        esquecerPerfis();
        setState({
          firebaseUser: null,
          user: null,
          isLoaded: true,
          accessDenied: false,
        });
        return;
      }

      const loaded = await loadProfileWithNetwork(firebaseUser, current);
      if (!loaded || !current()) return;
      const { profile: role, removed } = loaded;
      if (!role || !firestore) {
        setState({
          firebaseUser,
          user: null,
          isLoaded: true,
          accessDenied: true,
          accessRemoved: removed,
        });
        return;
      }

      setState({
        firebaseUser,
        user: toAppUser(firebaseUser, role),
        isLoaded: true,
        accessDenied: false,
      });

      unsubscribeProfile = onSnapshot(
        doc(firestore, "users", firebaseUser.uid),
        { includeMetadataChanges: true },
        (snapshot) => {
          // Só o servidor muda o acesso: sem sinal, o cache vazio diz que o
          // perfil não existe, e a pessoa sairia no meio do trabalho.
          if (snapshot.metadata.fromCache) return;
          const profile = profileFromSnapshot(snapshot);
          guardarPerfil(firebaseUser.uid, profile);
          if (!profile) {
            // Removido com a sessão aberta: sai na hora.
            setState({
              firebaseUser,
              user: null,
              isLoaded: true,
              accessDenied: true,
              accessRemoved: isRemoved(snapshot),
            });
            return;
          }

          setState({
            firebaseUser,
            user: toAppUser(firebaseUser, profile),
            isLoaded: true,
            accessDenied: false,
          });
        },
      );
    });

    return () => {
      generation += 1;
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  const value = useMemo(() => state, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppUser() {
  return useContext(AuthContext);
}

export function useAppAuth() {
  return {
    signOut: async (_options?: { redirectUrl?: string }) => {
      if (firebaseAuth) await firebaseSignOut(firebaseAuth);
    },
  };
}
