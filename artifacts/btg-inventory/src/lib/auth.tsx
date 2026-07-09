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
  accessDenied: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  user: null,
  isLoaded: false,
  accessDenied: false,
});

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

async function loadProfile(firebaseUser: User): Promise<Role | null> {
  if (!firestore) return null;
  const ref = doc(firestore, "users", firebaseUser.uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    const role = snapshot.data().role;
    return role === "cliente" ? "cliente" : "interno";
  }

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextValue>({
    firebaseUser: null,
    user: null,
    isLoaded: isDemoMode,
    accessDenied: false,
  });

  useEffect(() => {
    if (isDemoMode) {
      setState({
        firebaseUser: null,
        user: demoUser,
        isLoaded: true,
        accessDenied: false,
      });
      return;
    }

    const auth = firebaseAuth;

    if (!auth) {
      setState({
        firebaseUser: null,
        user: null,
        isLoaded: true,
        accessDenied: false,
      });
      return;
    }

    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setState({
          firebaseUser: null,
          user: null,
          isLoaded: true,
          accessDenied: false,
        });
        return;
      }

      const role = await loadProfile(firebaseUser);
      if (!role) {
        setState({
          firebaseUser,
          user: null,
          isLoaded: true,
          accessDenied: true,
        });
        return;
      }

      setState({
        firebaseUser,
        user: toAppUser(firebaseUser, role),
        isLoaded: true,
        accessDenied: false,
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
