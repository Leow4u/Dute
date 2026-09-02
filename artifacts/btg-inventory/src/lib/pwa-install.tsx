import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type InstallOutcome = "accepted" | "dismissed" | "installed" | "manual" | "unavailable";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

type PwaInstallState = {
  canInstall: boolean;
  isAppleMobile: boolean;
  isInstalled: boolean;
  isOnline: boolean;
  requestInstall: () => Promise<InstallOutcome>;
};

const PwaInstallContext = createContext<PwaInstallState | null>(null);

function installedDisplayMode() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function appleMobileDevice() {
  if (typeof window === "undefined") return false;
  return (
    /iPad|iPhone|iPod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" &&
      window.navigator.maxTouchPoints > 1)
  );
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(installedDisplayMode);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const isAppleMobile = appleMobileDevice();

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };
    const onDisplayModeChange = () => setIsInstalled(installedDisplayMode());
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    displayMode.addEventListener("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const requestInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (isInstalled) return "installed";
    if (!installPrompt) return isAppleMobile ? "manual" : "unavailable";

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") setIsInstalled(true);
    return choice.outcome;
  }, [installPrompt, isAppleMobile, isInstalled]);

  const value = useMemo<PwaInstallState>(
    () => ({
      canInstall: Boolean(installPrompt) && !isInstalled,
      isAppleMobile,
      isInstalled,
      isOnline,
      requestInstall,
    }),
    [installPrompt, isAppleMobile, isInstalled, isOnline, requestInstall],
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall() {
  const value = useContext(PwaInstallContext);
  if (!value) {
    throw new Error("usePwaInstall deve ser usado dentro de PwaInstallProvider.");
  }
  return value;
}
