import { useClerk, useUser } from "@clerk/react";

import { demoUser, isDemoMode } from "./demo-mode";

export function useAppUser() {
  if (isDemoMode) {
    return { user: demoUser, isLoaded: true };
  }

  return useUser();
}

export function useAppClerk() {
  if (isDemoMode) {
    return {
      signOut: async () => undefined,
    };
  }

  return useClerk();
}
