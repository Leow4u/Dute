import { Clock3, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErroNaLeitura } from "@/components/ui/erro-na-leitura";
import { Spinner } from "@/components/ui/spinner";
import { useAberturaNaTela } from "@/lib/abertura";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/**
 * O nome da tela que não é substantivo pede "a tela" antes: "Abrindo a tela
 * Separar…", "Abrindo a tela A faturar…", "Abrindo a tela Hoje…". Os outros
 * entram direto, como na especificação: "Abrindo Faturamento…".
 */
function pedeATela(nome: string): boolean {
  // Começa com artigo ("A faturar"), com um verbo no infinitivo ("Separar", "Planejar OS") ou é "Hoje".
  return /^(?:A|O|As|Os) /.test(nome) || /^\p{Lu}\p{Ll}+(?:ar|er|ir)(?: |$)/u.test(nome) || nome === "Hoje";
}

/** "Abrindo Faturamento…"; sem o nome da tela, a entrada: "Abrindo a Dutelog…". */
export function rotuloDaCarregandoTela(titulo?: string | null): string {
  const nome = titulo?.trim();
  if (!nome) return "Abrindo a Dutelog…";
  return pedeATela(nome) ? `Abrindo a tela ${nome}…` : `Abrindo ${nome}…`;
}

/** O aviso de 10 s, o mesmo da leitura (a pílula âmbar da linha de estado). */
export const DEMORANDO = "Demorando mais que o normal";
/** A desistência aos 70 s, a mesma do `ErroNaLeitura` das listas. */
export const SEM_RESPOSTA = "Sem resposta do servidor.";

function recarregar() {
  window.location.reload();
}

/**
 * A tela que ainda abre (carregamento v2, seção 9): o arquivo da tela que
 * chega pela rede, o perfil que ainda não veio, a rota que espera o cliente.
 * No relógio da leitura (seção 3): antes de 300 ms nada aparece; depois, a
 * caixa de 40 px e "Abrindo Faturamento…", com o anúncio na região do
 * `Anunciador`; aos 10 s, a volta calma, "Demorando mais que o normal" e
 * "Tentar de novo"; aos 70 s, "Sem resposta do servidor." com "Tentar de
 * novo". Tentar de novo recarrega o app: o arquivo que não veio não se pede de
 * novo sem recarregar. No lugar do "Carregando..." solto e do branco dos
 * `fallback={null}`.
 *
 * Enquanto a abertura do index.html está na tela, também enquanto esmaece,
 * nada é desenhado nem anunciado: ela já diz "Abrindo a Dutelog", e a caixa
 * apareceria por baixo do preto. Quem continua uma espera que já estava na
 * tela (`desde`, a fronteira que confere o arquivo que não veio) segue o mesmo
 * relógio e não repete o anúncio da entrada. A área reserva a altura da tela,
 * para o conteúdo não pular quando chegar.
 */
export function CarregandoTela({
  titulo,
  className,
  desde,
  onTentar = recarregar,
}: {
  titulo?: string | null;
  className?: string;
  /** Quando a espera começou (`performance.now()`), se ela continua outra. */
  desde?: number;
  onTentar?: () => void;
}) {
  const espera = useEspera(true, { desde });
  const anunciar = useAnuncio();
  const aberturaNaTela = useAberturaNaTela();
  const rotulo = rotuloDaCarregandoTela(titulo);
  const [continua] = useState(() => espera.visivel);
  const visivel = espera.visivel && !aberturaNaTela;
  const marco = !visivel
    ? null
    : espera.fase === "sem-resposta"
      ? "sem-resposta"
      : espera.fase === "demorando"
        ? "demorando"
        : "espera";

  // A desistência é um alerta (o ErroNaLeitura): o leitor de tela já a ouve.
  useEffect(() => {
    if (marco === "espera" && !continua) anunciar(rotulo);
    else if (marco === "demorando") anunciar(DEMORANDO);
  }, [marco, continua, anunciar, rotulo]);

  if (marco === "sem-resposta") {
    return (
      // "Tentar de novo" com 44 px, como os outros avisos da tela que não abre.
      <div data-carregando-tela="" className={cn("flex min-h-[40vh] items-center justify-center p-4 [&_button]:min-h-11", className)}>
        <ErroNaLeitura mensagem={SEM_RESPOSTA} tentando={false} onTentar={onTentar} className="w-full max-w-xl" />
      </div>
    );
  }

  return (
    <div
      data-carregando-tela=""
      className={cn("flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 text-center", className)}
    >
      {visivel ? (
        <>
          <Spinner tamanho={40} calmo={espera.calmo} className="text-foreground" />
          <p className="text-base font-bold text-foreground">{rotulo}</p>
          {marco === "demorando" ? (
            <div className="flex flex-col items-center gap-3">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning-soft px-2.5 text-sm font-bold text-amber-soft-foreground">
                <Clock3 className="size-3.5" aria-hidden="true" />
                {DEMORANDO}
              </span>
              <Button type="button" variant="outline" className="min-h-11" onClick={onTentar}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Tentar de novo
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
