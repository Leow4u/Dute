import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip as FilterChip } from "@/components/ui/chip";
import { BarraDeEspera } from "@/components/ui/barra-de-espera";
import { FalhaNaLeitura, type LeituraQueFalhou } from "@/components/ui/erro-na-leitura";
import { LinhaDeEstado, type LeituraDaLista } from "@/components/ui/linha-de-estado";
import { PageHeader } from "@/components/ui/page-header";
import { itensParadosEmTexto, rotuloDoAlerta, type AlertaProposto } from "@/lib/memoria/alertas";
import { dataDoRelogio, diasEmTexto } from "@/lib/memoria/parados";
import { SaiComOFoco, useFocoQueSegue } from "@/lib/carregando/use-foco-que-segue";

/**
 * Estoque › Alertas (docs/plataforma/fase-5-memoria.md, parte 5.4e), só a
 * apresentação: os dados e as ações chegam por props (pages/estoque-alertas.tsx).
 * Na v3, sem legenda: rótulos, dados e ações. Um alerta por vez, do cliente
 * escolhido, com uma ação principal, "Enviar ao cliente".
 */

export type AcoesDosAlertas = {
  escolher: (alertaId: string) => void;
  marcar: (skuCode: string) => void;
  marcarTodos: () => void;
  enviar: () => void;
  descartar: () => void;
};

export type AlertasParadosViewProps = {
  estado: "carregando" | "erro" | "pronto";
  alertas: readonly AlertaProposto[];
  /** O alerta aberto: o escolhido ou o que já estava na tela, mesmo fora da lista; senão o primeiro. */
  alerta: AlertaProposto | null;
  nomeDoCliente: (customerCode: string) => string;
  marcados: ReadonlySet<string>;
  /** A decisão em andamento: as ações esperam. */
  ocupado: boolean;
  /**
   * Qual decisão está em andamento: o botão dela mostra a espera
   * ("Enviando…", "Descartando…") e o outro espera travado (carregamento v2,
   * parte 13b).
   */
  decidindo?: "aprovar" | "descartar" | null;
  /** O erro da última decisão. */
  erro: string | null;
  acoes: AcoesDosAlertas;
  /**
   * A leitura que falhou sem nada lido (a `falhaDasLeituras`): o aviso no
   * lugar da lista, nunca o vazio. Na falta de conexão, "Sem conexão." ou
   * "Reconectando…"; em outro erro, "Não consegui carregar os alertas.", com
   * "Tentar de novo", que só diz "Tentando de novo…" na nova tentativa que a
   * pessoa pede (carregamento v2, parte 13b). Com a lista lida, quem diz é a
   * linha de estado.
   */
  falha?: { leitura: LeituraQueFalhou; erro: unknown } | null;
  /**
   * A leitura dos alertas, para a linha de estado sob o título (carregamento
   * v2, parte 7b): "Carregando alertas…", "Atualizado às 10:42",
   * "Reconectando…" e "Sem conexão · lista de 10:42". Sem ela (a memória
   * desligada), a linha fica vazia.
   */
  leitura?: readonly LeituraDaLista[];
  /** A releitura da volta do app ao primeiro plano: a barra no topo do alerta e, aos 5 s, "Atualizando…". */
  voltando?: boolean;
};

const numero = new Intl.NumberFormat("pt-BR");
/** A linha de estado sob o título: o foco vai a ela quando o aviso da falha sai com ele. */
const ID_DA_LINHA = "alertas-linha-de-estado";
/**
 * O título do alerta na tela (ou o "Nenhum alerta para aprovar."): a decisão que dá certo troca o alerta, e o foco que
 * estava nele vai ao título do seguinte, nunca ao body, e nunca ao "Enviar ao cliente" do outro cliente.
 */
const ID_DO_ALERTA = "alerta-na-tela";

function Alerta({ alerta, nome, marcados, ocupado, decidindo = null, erro, acoes, voltando = false }: { alerta: AlertaProposto; nome: string } & Pick<AlertasParadosViewProps, "marcados" | "ocupado" | "decidindo" | "erro" | "acoes" | "voltando">) {
  const todos = marcados.size === alerta.itens.length;
  // Ocupado não é desabilitado (carregamento v2, seção 7): as marcas ficam aria-disabled, e o toque não muda nada.
  const marcar = (fazer: () => void) => () => {
    if (!ocupado) fazer();
  };
  return (
    <section aria-labelledby={ID_DO_ALERTA} className="relative overflow-hidden rounded-lg border border-border bg-card">
      <BarraDeEspera lugar="topo" ativa={voltando} resultado="fim" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h2 id={ID_DO_ALERTA} tabIndex={-1} className="text-base font-bold text-foreground">
          {nome}
        </h2>
        <p className="flex items-center gap-2 text-sm text-foreground/70">
          <span>{itensParadosEmTexto(alerta.itens.length)}</span>
          <span className="whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-soft-foreground">{rotuloDoAlerta(alerta)}</span>
        </p>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Itens do alerta</caption>
        <thead>
          <tr className="border-b border-border/70 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
            <th scope="col" className="w-10 px-4 py-2.5">
              <Checkbox checked={todos} onCheckedChange={marcar(acoes.marcarTodos)} aria-disabled={ocupado || undefined} className={ocupado ? "opacity-45" : undefined} aria-label="Todos os itens" />
            </th>
            <th scope="col" className="py-2.5 pr-3">Item</th>
            <th scope="col" className="py-2.5 pr-3 text-right">Saldo</th>
            <th scope="col" className="hidden py-2.5 pr-3 md:table-cell">Último movimento</th>
            <th scope="col" className="py-2.5 pr-4 text-right">Sem movimento</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {alerta.itens.map((item) => (
            <tr key={item.skuCode}>
              <td className="px-4 py-2.5">
                <Checkbox
                  checked={marcados.has(item.skuCode)}
                  onCheckedChange={marcar(() => acoes.marcar(item.skuCode))}
                  aria-disabled={ocupado || undefined}
                  className={ocupado ? "opacity-45" : undefined}
                  aria-label={`Enviar ${item.clientItemCode ?? item.skuCode}`}
                />
              </td>
              <td className="min-w-0 py-2.5 pr-3">
                <p className="font-mono text-sm font-bold text-foreground">{item.clientItemCode ?? item.skuCode}</p>
                {item.productName ? <p className="truncate text-foreground/70">{item.productName}</p> : null}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{numero.format(item.saldo)}</td>
              <td className="hidden py-2.5 pr-3 tabular-nums md:table-cell">{dataDoRelogio(item.ultimaMovimentacao)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{diasEmTexto(item.diasParado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-4 py-3">
        {/* A decisão no BotaoDeAcao (carregamento v2, parte 13b): o tocado diz o gerúndio, o outro espera travado, e
            nenhum fica disabled (o foco fica no botão tocado). */}
        <BotaoDeAcao
          // 48 px no celular (seção 7 e momento 3).
          className="max-md:min-h-12"
          estado={decidindo === "aprovar" ? "andamento" : "repouso"}
          rotulo="Enviar ao cliente"
          andamento="Enviando…"
          bloqueado={decidindo !== "aprovar" && (ocupado || marcados.size === 0)}
          onClick={acoes.enviar}
        />
        <BotaoDeAcao
          variant="outline"
          className="max-md:min-h-12"
          estado={decidindo === "descartar" ? "andamento" : "repouso"}
          rotulo="Descartar"
          andamento="Descartando…"
          bloqueado={decidindo !== "descartar" && ocupado}
          onClick={acoes.descartar}
        />
        {erro ? (
          <p role="alert" className="text-sm font-medium text-destructive-soft-foreground">
            {erro}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function AlertasParadosView({
  estado,
  alertas,
  alerta,
  nomeDoCliente,
  marcados,
  ocupado,
  erro,
  acoes,
  falha = null,
  leitura = [],
  voltando = false,
  decidindo = null,
}: AlertasParadosViewProps) {
  const foco = useFocoQueSegue();
  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader title="Alertas de itens parados" estado={<LinhaDeEstado id={ID_DA_LINHA} leitura={leitura} objeto="alertas" pedidaPelaPessoa={voltando} />} />
      {/* A primeira leitura e a falta com a lista lida ficam na linha de estado, sob o título. */}
      {estado === "carregando" ? null : falha ? (
        // A falha nunca vira vazio, e tem a nova tentativa (parte 13b).
        <FalhaNaLeitura leitura={falha.leitura} erro={falha.erro} mensagem="Não consegui carregar os alertas." focoAoSair={ID_DA_LINHA} />
      ) : estado === "erro" ? (
        <p className="text-sm text-destructive-soft-foreground">Não consegui carregar os alertas.</p>
      ) : !alerta ? (
        <p id={ID_DO_ALERTA} tabIndex={-1} className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
          Nenhum alerta para aprovar.
        </p>
      ) : (
        <>
          {alertas.some((opcao) => opcao.id !== alerta.id) ? (
            <div role="group" aria-label="Clientes" className="flex flex-wrap gap-2">
              {alertas.map((opcao) => (
                <FilterChip key={opcao.id} selected={opcao.id === alerta.id} count={opcao.itens.length} onClick={() => acoes.escolher(opcao.id)}>
                  {nomeDoCliente(opcao.customerCode)}
                </FilterChip>
              ))}
            </div>
          ) : null}
          {/* Um alerta por chave: o botão do alerta decidido não passa ao seguinte com o "Enviando…" (parte 13b). */}
          <SaiComOFoco key={alerta.id} alvo={ID_DO_ALERTA} pedido={foco}>
            <Alerta alerta={alerta} nome={nomeDoCliente(alerta.customerCode)} marcados={marcados} ocupado={ocupado} decidindo={decidindo} erro={erro} acoes={acoes} voltando={voltando} />
          </SaiComOFoco>
        </>
      )}
    </div>
  );
}
