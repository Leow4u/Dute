import { AlertCircle, RefreshCw, WifiOff, type LucideIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CarregandoTela } from "@/components/ui/carregando-tela";
import { inicioDoCarregamento } from "@/lib/telas-no-aparelho";
import { cn } from "@/lib/utils";

/**
 * Por que a tela não abriu (docs/plataforma/diagnostico-carregamento.md, 9.3,
 * PR 2 do celular): o arquivo dela não veio porque o aparelho está sem sinal;
 * não existe mais, porque saiu uma versão nova (todo deploy troca o nome dos
 * arquivos); ou a própria tela quebrou.
 */
export type FalhaDaTela = "sem-conexao" | "versao-nova" | "erro-de-tela";

/** O import dinâmico que falhou, nos navegadores que o app atende, e o CSS que o Vite não conseguiu pré-carregar. */
const ARQUIVO_QUE_NAO_VEIO =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk [\w-]+ failed|ChunkLoadError/i;

function textoDoErro(erro: unknown): string {
  if (erro instanceof Error) return `${erro.name}: ${erro.message}`;
  return typeof erro === "string" ? erro : "";
}

/** O erro é de um arquivo da tela que não chegou, e não da tela em si. */
export function falhaDeArquivo(erro: unknown): boolean {
  return ARQUIVO_QUE_NAO_VEIO.test(textoDoErro(erro));
}

/** O endereço do arquivo que não veio, quando o navegador o diz na mensagem. */
export function enderecoDoArquivo(erro: unknown): string | null {
  return /(?:https?:\/\/|\/)[^\s'"()]+\.(?:m?js|css)\b/.exec(textoDoErro(erro))?.[0] ?? null;
}

export interface AmbienteDaFalha {
  /** `navigator.onLine`: falso só quando o aparelho sabe que está sem rede. */
  online: boolean;
  /** Pergunta ao servidor se o arquivo existe (HEAD, sem cache). */
  sondar: (endereco: string) => Promise<{ status: number }>;
  /** Quanto esperar a resposta: no sinal fraco ela pode não vir. */
  prazoMs?: number;
  /** O endereço do app, perguntado quando o navegador não diz qual arquivo faltou (o Safari). */
  raiz?: string;
}

const PRAZO_DA_SONDA_MS = 8_000;

/** O que dá para dizer sem perguntar ao servidor; `null` quando precisa da sonda. */
export function falhaImediata(erro: unknown, online: boolean): FalhaDaTela | null {
  if (!falhaDeArquivo(erro)) return "erro-de-tela";
  if (!online) return "sem-conexao";
  return null;
}

/** A pergunta ao servidor, com o prazo: no sinal fraco ela pode não voltar (nulo). */
async function perguntar(ambiente: AmbienteDaFalha, endereco: string): Promise<number | null> {
  let prazo: ReturnType<typeof setTimeout> | undefined;
  try {
    const resposta = await Promise.race([
      ambiente.sondar(endereco),
      new Promise<never>((_, recusar) => {
        prazo = setTimeout(() => recusar(new Error("sem resposta")), ambiente.prazoMs ?? PRAZO_DA_SONDA_MS);
      }),
    ]);
    return resposta.status;
  } catch {
    return null;
  } finally {
    clearTimeout(prazo);
  }
}

/**
 * Separa os três casos. Com o aparelho conectado, o servidor desempata: o
 * arquivo que sumiu (404) é de uma versão antiga; o que existe, ou a pergunta
 * que não volta, é sinal fraco. Quando o navegador não diz qual arquivo faltou
 * (o Safari), pergunta pelo próprio app: se o servidor responde, o mais
 * provável é a versão nova; se não, falta rede.
 */
export async function classificarFalha(erro: unknown, ambiente: AmbienteDaFalha): Promise<FalhaDaTela> {
  const imediata = falhaImediata(erro, ambiente.online);
  if (imediata) return imediata;
  const endereco = enderecoDoArquivo(erro);
  if (!endereco) {
    const status = await perguntar(ambiente, ambiente.raiz ?? "/");
    return status !== null && status < 500 ? "versao-nova" : "sem-conexao";
  }
  const status = await perguntar(ambiente, endereco);
  return status === 404 || status === 410 ? "versao-nova" : "sem-conexao";
}

function ambienteDoNavegador(): AmbienteDaFalha {
  return {
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    sondar: (endereco) => fetch(endereco, { method: "HEAD", cache: "no-store" }),
    raiz: import.meta.env.BASE_URL,
  };
}

const AVISO: Record<FalhaDaTela, { Icone: LucideIcon; tom: string; mensagem: string; acao: string }> = {
  "sem-conexao": {
    Icone: WifiOff,
    tom: "bg-warning-soft text-warning-soft-foreground",
    mensagem: "Sem conexão.",
    acao: "Tentar de novo",
  },
  "versao-nova": {
    Icone: RefreshCw,
    tom: "bg-info-soft text-info-soft-foreground",
    mensagem: "Há uma versão nova da Dutelog.",
    acao: "Atualizar",
  },
  "erro-de-tela": {
    Icone: AlertCircle,
    tom: "bg-destructive-soft text-destructive",
    mensagem: "Não foi possível abrir esta tela.",
    acao: "Tentar de novo",
  },
};

/** O aviso no lugar da tela, no desenho do `ErroNaLeitura`. Toda saída recarrega o app. */
export function AvisoDaFalha({ falha, onRecarregar }: { falha: FalhaDaTela; onRecarregar?: () => void }) {
  const { Icone, tom, mensagem, acao } = AVISO[falha];
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-4">
      <div
        role="alert"
        data-falha={falha}
        className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
      >
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", tom)}>
          <Icone className="size-5" aria-hidden="true" />
        </span>
        <p className="flex-1 text-base font-semibold text-foreground">{mensagem}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={onRecarregar ?? (() => window.location.reload())}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {acao}
        </Button>
      </div>
    </div>
  );
}

type Estado = { falha: FalhaDaTela | "conferindo" | null; desde?: number };

/**
 * A tela que não abre não fica branca. Um deploy troca o nome de todos os
 * arquivos, e a aba aberta desde antes pede um que não existe mais; sem sinal,
 * a tela que ainda não está no aparelho não chega; e a tela pode quebrar. Cada
 * caso tem o seu aviso. Enquanto o servidor desempata, a mesma `CarregandoTela`
 * da espera, com o nome da tela e o relógio de quando ela começou a abrir:
 * o rótulo não some nem troca, e a entrada não é anunciada de novo.
 */
export class ChunkErrorBoundary extends Component<
  { children: ReactNode; titulo?: string | null; ambiente?: () => AmbienteDaFalha },
  Estado
> {
  state: Estado = { falha: null };

  private montado = false;

  static getDerivedStateFromError(erro: unknown): Estado {
    return { falha: falhaDeArquivo(erro) ? "conferindo" : "erro-de-tela", desde: inicioDoCarregamento(erro) };
  }

  componentDidMount() {
    this.montado = true;
  }

  componentWillUnmount() {
    this.montado = false;
  }

  componentDidCatch(erro: unknown, _info: ErrorInfo) {
    if (this.state.falha !== "conferindo") return;
    void classificarFalha(erro, (this.props.ambiente ?? ambienteDoNavegador)()).then((falha) => {
      if (this.montado) this.setState({ falha });
    });
  }

  render() {
    const { falha } = this.state;
    if (falha === null) return this.props.children;
    if (falha === "conferindo") return <CarregandoTela titulo={this.props.titulo} desde={this.state.desde} />;
    return <AvisoDaFalha falha={falha} />;
  }
}
