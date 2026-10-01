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

async function loadProfile(
  firebaseUser: User,
): Promise<{ profile: ProfileData | null; removed: boolean }> {
  if (!firestore) return { profile: null, removed: false };
  const ref = doc(firestore, "users", firebaseUser.uid);
  const snapshot = await getDoc(ref);
  return { profile: profileFromSnapshot(snapshot), removed: isRemoved(snapshot) };
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

      if (!firebaseUser) {
        setState({
          firebaseUser: null,
          user: null,
          isLoaded: true,
          accessDenied: false,
        });
        return;
      }

      const { profile: role, removed } = await loadProfile(firebaseUser);
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
        (snapshot) => {
          const profile = profileFromSnapshot(snapshot);
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
