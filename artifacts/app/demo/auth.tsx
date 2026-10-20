/* Substitui src/lib/auth.tsx na demo: o usuário vem do perfil escolhido no login. */
import type { ReactNode } from "react";
import type { ProfileRole } from "../src/lib/modules";
import { CUSTOMER } from "./data";
import { readSession, writeSession } from "./session";

export type Role = "interno" | "cliente";

export type AppUser = {
  uid: string;
  fullName: string;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string };
  publicMetadata: { role: ProfileRole; customer_code?: string };
};

const profile = readSession();
const user: AppUser | null = profile
  ? {
      uid: `demo-${profile.key}`,
      fullName: profile.fullName,
      imageUrl: "",
      primaryEmailAddress: { emailAddress: profile.email },
      publicMetadata: { role: profile.role, customer_code: CUSTOMER },
    }
  : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAppUser() {
  return { firebaseUser: null, user, isLoaded: true, accessDenied: false, accessRemoved: false };
}

export function useAppAuth() {
  return {
    signOut: async (_options?: { redirectUrl?: string }) => {
      writeSession(null);
      window.history.replaceState(null, "", window.location.pathname);
      window.location.reload();
    },
  };
}
