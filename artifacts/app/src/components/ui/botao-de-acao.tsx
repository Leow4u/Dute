import * as React from "react";
import { RefreshCw } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toqueRepetido } from "@/lib/campo/toque-unico";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** Os cinco estados do botão de ação (carregamento v2, seção 5.4 e momento 3). */
export type EstadoDaAcao = "repouso" | "andamento" | "sucesso" | "erro" | "sem-resposta";

export interface BotaoDeAcaoProps extends Omit<ButtonProps, "children" | "disabled" | "asChild"> {
  estado: EstadoDaAcao;
  /** O ícone do repouso ("✓" do Aprovar). Aos 300 ms do em andamento, o indicador toma o lugar dele. */
  icone?: React.ReactNode;
  /** "Aprovar". */
  rotulo: string;
  /** O gerúndio, com a reticência de um caractere: "Aprovando…". */
  andamento: string;
  /** "Aprovado"; sem ele, fica o rótulo. */
  sucesso?: string;
  /** "Não aprovado"; sem ele, fica o rótulo. */
  erro?: string;
  /** O rótulo de sem resposta, aos 70 s da escrita: "Conferir" por padrão. */
  conferir?: string;
  /** Travado por outra ação (o Recusar da linha que aprova): aria-disabled a 0,45, sem disabled. */
  bloqueado?: boolean;
}

/**
 * Até quando a troca de camada anima: a marca de quem sai (data-de e
 * data-sai) fica no botão por esse tempo e então sai, e com ela o indicador
 * que ficou escondido. Daí em diante, no fim (sucesso, erro e sem resposta),
 * o próprio botão fica sem fundo e sem borda, porque o fundo do fim já cobre.
 * Maior que a troca mais longa do index.css (o erro: a onda de 300 ms e o
 * tremor de 240 ms; o sucesso: 520 ms).
 */
export const FIM_DA_TROCA_MS = 600;

/** A caixa chanfrada (viewBox 24), a mesma da máscara do indicador. */
const CAIXA = "M6 3.5H18A2.5 2.5 0 0 1 20.5 6V14.5L14.5 20.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5Z";
const CHECK = "M8 12.3l2.6 2.6 5.2-5.5";
const EXCLAMACAO = "M12 7.6v4.9M12 16.2v.2";

const CAMADAS: readonly EstadoDaAcao[] = ["repouso", "andamento", "sucesso", "erro", "sem-resposta"];

/**
 * A caixa chanfrada com o "!": o ícone do erro no botão e no selo da linha
 * ("Não aprovado", carregamento v2, momento 4). Decorativa.
 */
export function CaixaDeAlerta({ className }: { className?: string }) {
  return (
    <svg className={cn("botao-acao-caixa", className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path data-parte="contorno" d={CAIXA} />
      <path data-parte="marca" d={EXCLAMACAO} />
    </svg>
  );
}

type Variante = NonNullable<ButtonProps["variant"]>;

/** O fundo do toque de cada variante do Button: o #AD0015 no primário da v3. */
const FUNDO_DO_TOQUE: Record<Variante, string> = {
  default: "bg-primary-hover",
  secondary: "bg-surface-pressed",
  outline: "bg-surface-pressed",
  ghost: "bg-surface-pressed",
  destructive: "bg-destructive-soft",
  link: "",
};

/**
 * Travado (em andamento, no sucesso e bloqueado), o botão não responde ao
 * ponteiro. Com aria-disabled no lugar do disabled, o hover e o toque da
 * variante continuariam valendo: o "Aprovando…" escurecendo no hover, o
 * segundo toque impaciente pintando o primário com o --primary-pressed (que
 * a v3 não redefine, e fica azul) e o Recusar bloqueado acendendo. Fica o
 * fundo da variante: o vermelho cheio no primário.
 */
const PONTEIRO_TRAVADO: Record<Variante, string> = {
  default: "hover:bg-primary active:bg-primary",
  secondary: "hover:bg-card active:bg-card",
  outline: "hover:bg-card active:bg-card",
  ghost: "hover:bg-transparent active:bg-transparent",
  destructive: "hover:bg-card active:bg-card",
  link: "hover:no-underline",
};

interface Troca {
  /** A camada na tela. */
  atual: EstadoDaAcao;
  /** A que acabou de sair, enquanto a troca anima. */
  de: EstadoDaAcao | null;
}

/**
 * A camada que o botão mostra. Aos 300 ms do em andamento (e até completar o
 * mínimo de 500 ms, mesmo com o resultado já chegado), o indicador e o
 * gerúndio. Antes disso, o botão tocado continua o mesmo, afundado: o
 * Aprovar, ou o Conferir que relê.
 */
function camadaDe(estado: EstadoDaAcao, emAndamento: boolean, exibida: EstadoDaAcao): EstadoDaAcao {
  if (emAndamento) return "andamento";
  if (estado !== "andamento") return estado;
  return exibida === "andamento" || exibida === "sucesso" ? "repouso" : exibida;
}

/** A cor da onda e da borda: a do fim que está na tela ou, saindo dele, a de quem sai. */
function corDoFundo(troca: Troca, cores: Partial<Record<EstadoDaAcao, string>>): { cor?: string; sai: boolean } {
  if (cores[troca.atual]) return { cor: cores[troca.atual], sai: false };
  if (troca.de && cores[troca.de]) return { cor: cores[troca.de], sai: true };
  return { sai: false };
}

const ONDA = { sucesso: "ok", erro: "erro" } as const;
const BORDA = { erro: "erro", "sem-resposta": "conferir" } as const;

/** As variantes do Button que têm borda: o recorte dos fundos cobre a borda delas. */
const COM_BORDA = new Set<ButtonProps["variant"]>(["secondary", "outline", "destructive"]);

/**
 * O fundo do fim já cobre: o botão fica sem o fundo e a borda da variante,
 * que vazariam no raio (o vermelho sob o Conferir) ou dobrariam a borda do
 * erro. Também no hover e no toque, que a variante pinta.
 */
const SEM_FUNDO_PROPRIO = "border-transparent bg-transparent hover:bg-transparent active:bg-transparent";

const FINS: ReadonlySet<EstadoDaAcao> = new Set(["sucesso", "erro", "sem-resposta"]);

/**
 * O botão de ação do carregamento v2 (aprovado em 12/11/2026, seção 5.4 e
 * momento 3), no lugar do botão que só fica a 50%, do que só troca o texto e
 * do `disabled` durante a ação. Usa as variantes do Button.
 *
 * - A largura é a do rótulo mais largo: as cinco camadas (repouso, em
 *   andamento, sucesso, erro e sem resposta) ficam empilhadas na mesma célula
 *   da grade, e só a atual fica visível e na árvore de acessibilidade; as
 *   outras, com aria-hidden e visibility hidden. O nome acessível é o rótulo
 *   atual.
 * - O toque afunda o botão na hora e trava o segundo (o mesmo intervalo do
 *   toque único do campo). Aos 300 ms, o indicador chanfrado (16 px; 20 no
 *   tamanho grande) entra no lugar do ícone e o rótulo vira o gerúndio, com
 *   aria-busy; o em andamento fica pelo menos 500 ms. Nunca `disabled`:
 *   aria-disabled e a trava no código, e o foco fica.
 * - Sucesso: a caixa fecha em check (o miolo com a mola e o check desenhado
 *   uma vez) e a onda verde nasce da caixa e cobre o botão. Erro: crítico
 *   suave, a caixa com o "!" e o tremor. Sem resposta: "Conferir", em tinta.
 *   Quem decide o estado e por quanto tempo ele fica é quem usa o botão.
 *
 * O desenho e o movimento moram em index.css (`.botao-acao`).
 */
const BotaoDeAcao = React.forwardRef<HTMLButtonElement, BotaoDeAcaoProps>(function BotaoDeAcao(
  {
    estado,
    icone,
    rotulo,
    andamento,
    sucesso,
    erro,
    conferir = "Conferir",
    bloqueado = false,
    variant,
    size,
    className,
    type = "button",
    onClick,
    ...props
  },
  ref,
) {
  const espera = useEspera(estado === "andamento", { segurarMinimo: true });
  // O gerúndio fica o da espera que está na tela: o "Conferindo…" que segura o
  // mínimo de 500 ms depois da leitura não vira o "Confirmando…" da ação.
  const gerundio = React.useRef(andamento);
  if (estado === "andamento") gerundio.current = andamento;
  const [troca, setTroca] = React.useState<Troca>(() => ({ atual: camadaDe(estado, false, "repouso"), de: null }));
  const atual = camadaDe(estado, espera.visivel, troca.atual);
  if (atual !== troca.atual) setTroca({ atual, de: troca.atual });

  // A marca de quem saiu sai quando a troca acaba.
  React.useEffect(() => {
    if (troca.de === null) return undefined;
    const fim = setTimeout(() => setTroca((agora) => (agora === troca ? { atual: agora.atual, de: null } : agora)), FIM_DA_TROCA_MS);
    return () => clearTimeout(fim);
  }, [troca]);

  // A onda nasce da caixa: o centro do ícone de quem sai, medido uma vez por
  // troca. Sem ele (o repouso sem ícone, no resultado antes de 300 ms), a
  // caixa de quem entra, que o sucesso e o erro sempre têm.
  const botao = React.useRef<HTMLButtonElement | null>(null);
  React.useLayoutEffect(() => {
    const elemento = botao.current;
    if (!elemento || (troca.atual !== "sucesso" && troca.atual !== "erro")) return;
    const iconeDe = (camada: EstadoDaAcao | null) =>
      camada ? elemento.querySelector(`.botao-acao-camada[data-camada="${camada}"] [data-icone]`) : null;
    const icone = iconeDe(troca.de) ?? iconeDe(troca.atual);
    const fora = elemento.getBoundingClientRect();
    if (!icone || fora.width === 0) return;
    const caixa = icone.getBoundingClientRect();
    elemento.style.setProperty("--botao-acao-onda-x", `${Math.round(caixa.left + caixa.width / 2 - fora.left)}px`);
  }, [troca]);

  const juntarRef = React.useCallback(
    (no: HTMLButtonElement | null) => {
      botao.current = no;
      if (typeof ref === "function") ref(no);
      else if (ref) ref.current = no;
    },
    [ref],
  );

  const ultimoToque = React.useRef<number | undefined>(undefined);
  const travado = bloqueado || estado === "andamento" || atual === "andamento" || atual === "sucesso";
  const aoClicar = (evento: React.MouseEvent<HTMLButtonElement>) => {
    const instante = Date.now();
    if (travado || toqueRepetido(ultimoToque.current, instante)) {
      evento.preventDefault();
      return;
    }
    ultimoToque.current = instante;
    onClick?.(evento);
  };

  const grande = size === "lg";
  const cobre = troca.de === null && FINS.has(troca.atual);
  // Saindo do fim, o fundo da variante volta de uma vez, por baixo da onda que
  // recolhe: esmaecido, ele passaria pelo claro da página.
  const voltaDoFim = troca.de !== null && FINS.has(troca.de) && !FINS.has(troca.atual);
  const lugarDoIcone = cn("botao-acao-icone", grande ? "size-5" : "size-4");
  const onda = corDoFundo(troca, ONDA);
  const borda = corDoFundo(troca, BORDA);
  const gira = troca.atual === "andamento" || troca.de === "andamento";

  const conteudo: Record<EstadoDaAcao, React.ReactNode> = {
    repouso: (
      <>
        {icone ? (
          <span data-icone="" className={lugarDoIcone}>
            {icone}
          </span>
        ) : null}
        {rotulo}
      </>
    ),
    andamento: (
      <>
        <span data-icone="" className={lugarDoIcone}>
          {gira ? <Spinner tamanho={grande ? 20 : 16} calmo={espera.calmo} /> : null}
          <svg className="botao-acao-contorno" viewBox="0 0 24 24" strokeWidth={grande ? 3 : 3.4} aria-hidden="true" focusable="false">
            <path d={CAIXA} />
          </svg>
        </span>
        {gerundio.current}
      </>
    ),
    sucesso: (
      <>
        <span data-icone="" className={lugarDoIcone}>
          <svg className="botao-acao-caixa" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path data-parte="contorno" d={CAIXA} />
            <path data-parte="miolo" d={CAIXA} />
            <path data-parte="check" d={CHECK} pathLength={1} />
          </svg>
        </span>
        {sucesso ?? rotulo}
      </>
    ),
    erro: (
      <>
        <span data-icone="" className={lugarDoIcone}>
          <CaixaDeAlerta />
        </span>
        {erro ?? rotulo}
      </>
    ),
    "sem-resposta": (
      <>
        <span data-icone="" className={lugarDoIcone}>
          <RefreshCw aria-hidden="true" />
        </span>
        {conferir}
      </>
    ),
  };

  return (
    <Button
      {...props}
      ref={juntarRef}
      type={type}
      variant={variant}
      size={size}
      className={cn(
        "botao-acao relative isolate inline-grid place-items-center",
        grande && "[&_svg]:size-5",
        bloqueado && "opacity-45",
        className,
        travado && PONTEIRO_TRAVADO[variant ?? "default"],
        cobre && SEM_FUNDO_PROPRIO,
        voltaDoFim && "transition-none",
      )}
      data-estado={estado}
      data-camada={troca.atual}
      data-de={troca.de ?? undefined}
      data-afundado={estado === "andamento" && troca.atual !== "andamento" ? "" : undefined}
      data-borda={COM_BORDA.has(variant) ? "" : undefined}
      data-cobre={cobre ? "" : undefined}
      aria-busy={troca.atual === "andamento" ? true : undefined}
      aria-disabled={travado ? true : undefined}
      onClick={aoClicar}
    >
      <span aria-hidden="true" data-recorte="">
        <span data-fundo="toque" className={FUNDO_DO_TOQUE[variant ?? "default"]} />
        <span data-fundo="onda" data-cor={onda.cor} data-sai={onda.sai ? "" : undefined} />
        <span data-fundo="borda" data-cor={borda.cor} data-sai={borda.sai ? "" : undefined} />
      </span>
      {CAMADAS.map((camada) => (
        <span
          key={camada}
          className="botao-acao-camada"
          data-camada={camada}
          data-atual={camada === troca.atual ? "" : undefined}
          data-sai={camada === troca.de ? "" : undefined}
          aria-hidden={camada === troca.atual ? undefined : true}
        >
          {conteudo[camada]}
        </span>
      ))}
    </Button>
  );
});

export { BotaoDeAcao };
