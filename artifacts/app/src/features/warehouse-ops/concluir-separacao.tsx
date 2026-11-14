import { AvisoDeEspera } from "@/components/ui/aviso-de-espera";
import { BotaoDeAcao, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progresso, type ItemDoProgresso } from "@/components/ui/progresso";
import { useEspera } from "@/lib/carregando/use-espera";
import type { CaixasDoPedido } from "@/lib/warehouse-ops/caixas-da-separacao";

/**
 * "Concluir separação" (separação com caixas, partes 2 e 3;
 * docs/mockups/WmsSepararConcluir.dc.html): com todas as linhas tratadas, o
 * pedido pede o "Número do lacre", um por pedido (decisão 5), e fecha a
 * separação e a embalagem numa chamada. O diálogo diz os volumes do pedido
 * (parte 4) e as caixas de onde ele saiu: as inteiras, as abertas e as
 * vazias. Sem legenda.
 *
 * Concluindo (carregamento v2, parte 11 e momento 6): "Etapa 1 de 2" com
 * Separação → Embalagem fica no diálogo desde o repouso, pendente, como na
 * prancha, e o lugar do aviso também: nada entra empurrando o botão tocado.
 * Aos 300 ms a Separação anda e o leitor de tela ouve "Concluindo a
 * separação"; o botão "Concluindo…" mantém a largura, o "Voltar" e o X
 * ficam aria-disabled e o diálogo não fecha. As duas etapas correm numa
 * chamada só (completeOrderSeparation): a tela não sabe quando a primeira
 * termina, e as duas fecham juntas na resposta. Aos 10 s, "Demorando mais
 * que o normal · 0:12"; sem resposta aos 70 s, "Sem confirmação do servidor"
 * e o botão vira "Conferir", que relê o pedido e nunca reenvia (a chave da
 * conclusão é a mesma). Conferindo, o botão diz "Conferindo…", o aviso fica
 * e as etapas não voltam a andar: nada foi reenviado.
 */

/** As etapas que a conclusão percorre, na ordem do servidor. */
export const ETAPAS_DA_CONCLUSAO = ["Separação", "Embalagem"] as const;

/** Onde as etapas estão: as duas feitas no sucesso; a primeira andando até a resposta; pendentes no resto. */
export function etapasDaConclusao(estado: EstadoDaAcao): ItemDoProgresso[] {
  return ETAPAS_DA_CONCLUSAO.map((rotulo, indice) => ({
    rotulo,
    estado: estado === "sucesso" ? "feito" : estado === "andamento" && indice === 0 ? "andamento" : "fila",
  }));
}

const numero = new Intl.NumberFormat("pt-BR");

export function ConcluirSeparacaoConteudo({
  resumo,
  volumes,
  caixas,
  lacre,
  confirmando = false,
  estado,
  conferindo = false,
  onLacre,
  onVoltar,
  onConfirmar,
  onConferir,
}: {
  /** "BTG Pactual · 116 itens · 3.335 un. · Para quando Seg 16/11 11:36" */
  resumo: string;
  /** Quantos volumes o pedido fecha; sem a leitura deles, o diálogo não os conta. */
  volumes?: number | null;
  /** As caixas de onde o pedido saiu; sem a leitura delas, o diálogo não as conta. */
  caixas?: CaixasDoPedido | null;
  lacre: string;
  /** O antigo "gravando": vale como o `estado` em andamento. */
  confirmando?: boolean;
  /** O estado da conclusão no botão: em andamento, sucesso, erro ou sem resposta (o "Conferir"). */
  estado?: EstadoDaAcao;
  /** O "Conferir" relendo o pedido, com o estado ainda sem resposta: a leitura não é a escrita. */
  conferindo?: boolean;
  onLacre: (lacre: string) => void;
  onVoltar: () => void;
  onConfirmar: () => void;
  /** Sem resposta aos 70 s: relê o pedido, sem reenviar. */
  onConferir?: () => void;
}) {
  const atual: EstadoDaAcao = estado ?? (confirmando ? "andamento" : "repouso");
  const espera = useEspera(atual === "andamento");
  const ocupado = atual === "andamento" || atual === "sucesso" || conferindo;
  // A Separação anda com a conclusão (o Progresso só a mostra andando aos 300 ms); conferindo, que só relê, ficam pendentes.
  const etapas = etapasDaConclusao(atual);
  const acionar = () => {
    if (conferindo) return;
    if (atual === "sem-resposta") onConferir?.();
    else if (!ocupado && lacre.trim()) onConfirmar();
  };
  const comCaixas = caixas && caixas.inteiras + caixas.abertas + caixas.vazias > 0 ? caixas : null;
  // "Volumes | 42 | Caixas inteiras | 31 | Caixas abertas | 23 | Caixas vazias | 4"
  const numeros: Array<readonly [string, number]> = [
    ...(volumes ? [["Volumes", volumes] as const] : []),
    ...(comCaixas
      ? ([
          ["Caixas inteiras", comCaixas.inteiras],
          ["Caixas abertas", comCaixas.abertas],
          ["Caixas vazias", comCaixas.vazias],
        ] as const)
      : []),
  ];
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        acionar();
      }}
    >
      {resumo ? <p className="text-sm font-medium text-muted-foreground">{resumo}</p> : null}
      {numeros.length ? (
        <dl className={numeros.length > 3 ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : "grid grid-cols-3 gap-2"}>
          {numeros.map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-lg border border-border bg-card px-3 py-2">
              <dt className="text-xs font-medium text-muted-foreground">{rotulo}</dt>
              <dd className="text-lg font-extrabold tabular-nums text-foreground">{numero.format(valor)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="grid max-w-[260px] gap-2">
        <Label htmlFor="concluir-separacao-lacre">Número do lacre</Label>
        <Input id="concluir-separacao-lacre" value={lacre} maxLength={60} readOnly={ocupado} onChange={(event) => onLacre(event.target.value)} autoFocus />
      </div>
      <Progresso forma="etapas" titulo="Concluindo a separação" itens={etapas} />
      <div data-lugar-do-aviso="" className="grid min-h-9 items-center">
        {atual === "andamento" && espera.calmo ? <AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={espera.decorridoMs} /> : null}
        {atual === "sem-resposta" ? <AvisoDeEspera fase="sem-resposta" tipo="escrita" /> : null}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          aria-disabled={ocupado || undefined}
          className={ocupado ? "min-h-11 opacity-45 hover:bg-card active:bg-card" : "min-h-11"}
          onClick={() => {
            if (!ocupado) onVoltar();
          }}
        >
          Voltar
        </Button>
        <BotaoDeAcao
          type="button"
          className="min-h-11"
          estado={conferindo ? "andamento" : atual}
          rotulo="Confirmar separação"
          andamento={conferindo ? "Conferindo…" : "Concluindo…"}
          sucesso="Concluído"
          erro="Não concluído"
          bloqueado={atual === "repouso" && !lacre.trim()}
          onClick={acionar}
        />
      </DialogFooter>
    </form>
  );
}

export function ConcluirSeparacaoDialog({
  aberto,
  numero: pedido,
  resumo,
  volumes,
  caixas,
  lacre,
  confirmando,
  estado,
  conferindo = false,
  onLacre,
  onFechar,
  onConfirmar,
  onConferir,
}: {
  aberto: boolean;
  numero: string;
  resumo: string;
  volumes?: number | null;
  caixas?: CaixasDoPedido | null;
  lacre: string;
  confirmando?: boolean;
  estado?: EstadoDaAcao;
  conferindo?: boolean;
  onLacre: (lacre: string) => void;
  onFechar: () => void;
  onConfirmar: () => void;
  onConferir?: () => void;
}) {
  const atual: EstadoDaAcao = estado ?? (confirmando ? "andamento" : "repouso");
  // Concluindo (e conferindo), o diálogo não fecha: nem o Esc, nem o clique fora, nem o X, que fica aria-disabled.
  const ocupado = atual === "andamento" || atual === "sucesso" || conferindo;
  return (
    <Dialog open={aberto} ocupado={ocupado} onOpenChange={(open) => (open ? undefined : onFechar())}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{pedido}: concluir separação</DialogTitle>
        </DialogHeader>
        <ConcluirSeparacaoConteudo
          resumo={resumo}
          volumes={volumes}
          caixas={caixas}
          lacre={lacre}
          estado={atual}
          conferindo={conferindo}
          onLacre={onLacre}
          onVoltar={onFechar}
          onConfirmar={onConfirmar}
          onConferir={onConferir}
        />
      </DialogContent>
    </Dialog>
  );
}
