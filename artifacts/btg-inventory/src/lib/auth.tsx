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
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { demoUser, isDemoMode } from "./demo-mode";
import { firebaseAuth, firestore } from "./firebase";

export type Role = "interno" | "cliente";

export type AppUser = {
  uid: string;
  fullName: string;
  imageUrl: string;
  primaryEmailAddress: {
    emailAddress: string;
  };
  publicMetadata: {
    role: Role;
  };
};

type AuthContextValue = {
  firebaseUser: User | null;
  user: AppUser | null;
  isLoaded: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  user: null,
  isLoaded: false,
});

export function inferRoleFromEmail(email: string | null | undefined): Role {
  return email?.toLowerCase().endsWith("@dutelog.com.br")
    ? "interno"
    : "cliente";
}

function toAppUser(firebaseUser: User, role: Role): AppUser {
  return {
    uid: firebaseUser.uid,
    fullName:
      firebaseUser.displayName ||
      firebaseUser.email?.split("@")[0] ||
      "Usuário",
    imageUrl: firebaseUser.photoURL || "",
    primaryEmailAddress: {
      emailAddress: firebaseUser.email || "",
    },
    publicMetadata: { role },
  };
}

async function loadOrCreateProfile(firebaseUser: User): Promise<Role> {
  if (!firestore) return inferRoleFromEmail(firebaseUser.email);

  const ref = doc(firestore, "users", firebaseUser.uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    const role = snapshot.data().role;
    return role === "cliente" ? "cliente" : "interno";
  }

  const role = inferRoleFromEmail(firebaseUser.email);
  await setDoc(ref, {
    nome:
      firebaseUser.displayName ||
      firebaseUser.email?.split("@")[0] ||
      "Usuário",
    email: firebaseUser.email || "",
    role,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });

  return role;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextValue>({
    firebaseUser: null,
    user: null,
    isLoaded: isDemoMode,
  });

  useEffect(() => {
    if (isDemoMode) {
      setState({
        firebaseUser: null,
        user: demoUser,
        isLoaded: true,
      });
      return;
    }

    if (!firebaseAuth) {
      setState({ firebaseUser: null, user: null, isLoaded: true });
      return;
    }

    return onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        setState({ firebaseUser: null, user: null, isLoaded: true });
        return;
      }

      const role = await loadOrCreateProfile(firebaseUser);
      setState({
        firebaseUser,
        user: toAppUser(firebaseUser, role),
        isLoaded: true,
      });
    });
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
