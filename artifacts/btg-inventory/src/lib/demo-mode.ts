export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

export const demoUser = {
  uid: "demo-user",
  fullName: "Dute Demo",
  imageUrl: "",
  primaryEmailAddress: {
    emailAddress: "demo@dute.com.br",
  },
  publicMetadata: {
    role: "interno" as const,
  },
};
