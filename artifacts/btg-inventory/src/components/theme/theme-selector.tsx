import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { THEME_OPTIONS, normalizeThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * Claro / Escuro / Sistema. Só renderiza o valor salvo depois de montar: o
 * next-themes lê o localStorage no cliente e, antes disso, `theme` é o padrão.
 */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? normalizeThemePreference(theme) : null;

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="grid gap-2 sm:grid-cols-3"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option.value];
        const selected = current === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">
                {option.description}
              </span>
            </span>
            {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
