import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip as FilterChip } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { itensParadosEmTexto, rotuloDoAlerta, type AlertaProposto } from "@/lib/memoria/alertas";
import { dataDoRelogio, diasEmTexto } from "@/lib/memoria/parados";

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
  /** O erro da última decisão. */
  erro: string | null;
  acoes: AcoesDosAlertas;
};

const numero = new Intl.NumberFormat("pt-BR");

function Alerta({ alerta, nome, marcados, ocupado, erro, acoes }: { alerta: AlertaProposto; nome: string } & Pick<AlertasParadosViewProps, "marcados" | "ocupado" | "erro" | "acoes">) {
  const todos = marcados.size === alerta.itens.length;
  return (
    <section aria-labelledby={`alerta-${alerta.id}`} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h2 id={`alerta-${alerta.id}`} className="text-base font-bold text-foreground">
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
              <Checkbox checked={todos} onCheckedChange={() => acoes.marcarTodos()} disabled={ocupado} aria-label="Todos os itens" />
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
                  onCheckedChange={() => acoes.marcar(item.skuCode)}
                  disabled={ocupado}
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
        <Button type="button" onClick={acoes.enviar} disabled={ocupado || marcados.size === 0}>
          {ocupado ? "Gravando..." : "Enviar ao cliente"}
        </Button>
        <Button type="button" variant="outline" onClick={acoes.descartar} disabled={ocupado}>
          Descartar
        </Button>
        {erro ? (
          <p role="alert" className="text-sm font-medium text-destructive-soft-foreground">
            {erro}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function AlertasParadosView({ estado, alertas, alerta, nomeDoCliente, marcados, ocupado, erro, acoes }: AlertasParadosViewProps) {
  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader title="Alertas de itens parados" />
      {estado === "carregando" ? (
        <p className="text-sm text-muted-foreground">Carregando alertas...</p>
      ) : estado === "erro" ? (
        <p className="text-sm text-destructive-soft-foreground">Não consegui carregar os alertas.</p>
      ) : !alerta ? (
        <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">Nenhum alerta para aprovar.</p>
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
          <Alerta alerta={alerta} nome={nomeDoCliente(alerta.customerCode)} marcados={marcados} ocupado={ocupado} erro={erro} acoes={acoes} />
        </>
      )}
    </div>
  );
}
