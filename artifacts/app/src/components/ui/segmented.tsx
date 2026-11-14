import { Esqueleto } from "@/components/ui/esqueleto";
import { cn } from "@/lib/utils";

type OpcaoDoSegmentado<T extends string> = {
  value: T;
  label: string;
  /**
   * A contagem depois do rótulo ("Em aberto · 6"). Nula antes de ler
   * (carregamento v2, momento 2): o bloco no lugar do número ("Em aberto ·
   * ▪"), fora da árvore; nunca "0". `"falhou"` com a leitura que falhou: "—",
   * também fora da árvore, como a `NumeroLido` (junção das partes 10 e 13).
   * Zero ou sem ela, só o rótulo.
   */
  count?: number | null | "falhou";
};

type SegmentedProps<T extends string> = {
  options: ReadonlyArray<OpcaoDoSegmentado<T>>;
  value: T;
  onChange: (value: T) => void;
  /**
   * No celular, o segmentado ocupa a linha das ações, com as opções em partes
   * iguais (a prancha docs/mockups/WmsCarregandoV2Celular.dc.html): o
   * Atualizar fica ao lado quando cabe, e no celular estreito (320 px) as
   * opções apertam a margem em vez de sair da tela.
   */
  cheioNoCelular?: boolean;
  className?: string;
  "aria-label"?: string;
};

/**
 * A casa da contagem, com a largura do bloco (16 px): o bloco e o número
 * ocupam o mesmo lugar, e o rótulo não anda quando o número chega
 * (momento 2, como o `.conta-seg` da prancha).
 */
const CASA_DA_CONTAGEM = "inline-grid min-w-4 justify-items-start tabular-nums";

function rotuloDa<T extends string>(option: OpcaoDoSegmentado<T>) {
  if (option.count === "falhou") {
    return (
      <>
        {option.label}
        <span aria-hidden="true">
          {" · "}
          <span className={CASA_DA_CONTAGEM}>—</span>
        </span>
      </>
    );
  }
  if (option.count === null) {
    return (
      <>
        {option.label}
        <span aria-hidden="true">
          {" · "}
          <span className={CASA_DA_CONTAGEM}>
            <Esqueleto forma="contagem" />
          </span>
        </span>
      </>
    );
  }
  return option.count ? (
    <>
      {`${option.label} · `}
      <span className={CASA_DA_CONTAGEM}>{option.count}</span>
    </>
  ) : (
    option.label
  );
}

/**
 * Alternador de visão (Em aberto / Entregues, 6 meses / 12 meses). Para
 * filtrar uma lista, use `Chip`; para seções de página, `Tabs`.
 *
 * No celular (abaixo de `md`), 44 px de alvo em cada opção (carregamento v2,
 * seção 7): o grupo tem 44 px e a opção marcada é a pílula 3 px para dentro,
 * desenhada só no miolo dela (a borda transparente é toque), com o contorno
 * do grupo por dentro, sem ocupar lugar.
 */
export function Segmented<T extends string>({ options, value, onChange, cheioNoCelular = false, className, ...rest }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={rest["aria-label"]}
      className={cn(
        "inline-flex h-10 items-center gap-0.5 rounded-md border border-border bg-card p-0.5",
        "max-md:h-11 max-md:gap-0 max-md:border-0 max-md:p-0 max-md:inset-ring max-md:inset-ring-border",
        cheioNoCelular && "max-sm:flex max-sm:min-w-fit max-sm:flex-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-full whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            "max-md:rounded-md max-md:border-3 max-md:border-transparent max-md:bg-clip-padding max-md:px-2",
            cheioNoCelular && "max-sm:flex-1 max-sm:px-1",
            value === option.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotuloDa(option)}
        </button>
      ))}
    </div>
  );
}
