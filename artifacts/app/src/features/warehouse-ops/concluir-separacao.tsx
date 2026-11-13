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
 * Concluindo (carregamento v2, parte 11 e momento 6): aos 300 ms, "Etapa 1
 * de 2" com Separação → Embalagem; o botão "Concluindo…" mantém a largura e
 * o "Voltar" fica aria-disabled, como o diálogo, que não fecha. As duas
 * etapas correm numa chamada só (completeOrderSeparation): a tela não sabe
 * quando a primeira termina, e as duas fecham juntas na resposta. Aos 10 s,
 * "Demorando mais que o normal · 0:12"; sem resposta aos 70 s, "Sem
 * confirmação do servidor" e o botão vira "Conferir", que relê o pedido e
 * nunca reenvia (a chave da conclusão é a mesma).
 */

/** As etapas que a conclusão percorre, na ordem do servidor. */
export const ETAPAS_DA_CONCLUSAO = ["Separação", "Embalagem"] as const;

/** Onde as etapas estão: andando na primeira até a resposta, as duas feitas no sucesso. */
export function etapasDaConclusao(estado: EstadoDaAcao): ItemDoProgresso[] {
  return ETAPAS_DA_CONCLUSAO.map((rotulo, indice) => ({
    rotulo,
    estado: estado === "sucesso" ? "feito" : indice === 0 ? "andamento" : "fila",
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
  onLacre: (lacre: string) => void;
  onVoltar: () => void;
  onConfirmar: () => void;
  /** Sem resposta aos 70 s: relê o pedido, sem reenviar. */
  onConferir?: () => void;
}) {
  const atual: EstadoDaAcao = estado ?? (confirmando ? "andamento" : "repouso");
  const espera = useEspera(atual === "andamento");
  const ocupado = atual === "andamento" || atual === "sucesso";
  const comEtapas = (atual === "andamento" && espera.visivel) || atual === "sucesso";
  const acionar = () => {
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
      {comEtapas ? <Progresso forma="etapas" titulo="Concluindo a separação" itens={etapasDaConclusao(atual)} /> : null}
      {atual === "andamento" && espera.calmo ? <AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={espera.decorridoMs} /> : null}
      {atual === "sem-resposta" ? <AvisoDeEspera fase="sem-resposta" tipo="escrita" /> : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          aria-disabled={ocupado || undefined}
          className={ocupado ? "opacity-45 hover:bg-card active:bg-card" : undefined}
          onClick={() => {
            if (!ocupado) onVoltar();
          }}
        >
          Voltar
        </Button>
        <BotaoDeAcao
          type="button"
          estado={atual}
          rotulo="Confirmar separação"
          andamento="Concluindo…"
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
  onLacre: (lacre: string) => void;
  onFechar: () => void;
  onConfirmar: () => void;
  onConferir?: () => void;
}) {
  const atual: EstadoDaAcao = estado ?? (confirmando ? "andamento" : "repouso");
  // Concluindo, o diálogo não fecha: nem o Esc, nem o clique fora, nem o X.
  const ocupado = atual === "andamento" || atual === "sucesso";
  return (
    <Dialog open={aberto} onOpenChange={(open) => (open || ocupado ? undefined : onFechar())}>
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
          onLacre={onLacre}
          onVoltar={onFechar}
          onConfirmar={onConfirmar}
          onConferir={onConferir}
        />
      </DialogContent>
    </Dialog>
  );
}
