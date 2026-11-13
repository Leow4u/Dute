import { Esqueleto } from "@/components/ui/esqueleto";
import { cn } from "@/lib/utils";

type OpcaoDoSegmentado<T extends string> = {
  value: T;
  label: string;
  /**
   * A contagem depois do rótulo ("Em aberto · 6"). Nula antes de ler
   * (carregamento v2, momento 2): o bloco no lugar do número ("Em aberto ·
   * ▪"), fora da árvore; nunca "0". Zero ou sem ela, só o rótulo.
   */
  count?: number | null;
};

type SegmentedProps<T extends string> = {
  options: ReadonlyArray<OpcaoDoSegmentado<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
};

function rotuloDa<T extends string>(option: OpcaoDoSegmentado<T>) {
  if (option.count === null) {
    return (
      <>
        {option.label}
        <span aria-hidden="true">
          {" · "}
          <Esqueleto forma="contagem" />
        </span>
      </>
    );
  }
  return option.count ? `${option.label} · ${option.count}` : option.label;
}

/**
 * Alternador de visão (Em aberto / Entregues, 6 meses / 12 meses). Para
 * filtrar uma lista, use `Chip`; para seções de página, `Tabs`.
 */
export function Segmented<T extends string>({ options, value, onChange, className, ...rest }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={rest["aria-label"]}
      className={cn("inline-flex h-10 items-center gap-0.5 rounded-md border border-border bg-card p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-full whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            value === option.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotuloDa(option)}
        </button>
      ))}
    </div>
  );
}
