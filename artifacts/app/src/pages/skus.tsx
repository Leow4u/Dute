import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { type Sku, useListSkus, useCreateSku, useUpdateSku, useDeleteSku, getListSkusQueryKey } from "@workspace/api-client-react";
import { tamanhoDoCodigo } from "@workspace/dominio";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
import { useContagemLembrada } from "@/lib/carregando/contagem-lembrada";
import { falhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { useChegada } from "@/lib/carregando/use-chegada";
import { useEspera } from "@/lib/carregando/use-espera";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { ConteudoEmTroca, useListaComFiltro, useListaEmTroca } from "@/lib/carregando/use-lista-em-troca";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Boxes, ClipboardCheck, Edit, Layers, MapPin, PackageCheck, PackagePlus, Plus, Trash2 } from "lucide-react";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Dialog, DialogCancelar, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { useAppUser } from "@/lib/auth";
import { canWriteCatalog, humanApiError } from "@/lib/permissions";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { atributosDoProblema, problemaDoNomeNoCadastro, seguirSugestao } from "@/features/warehouse-ops/product-identity";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import {
  formatStockNumber,
  StockFilterChip,
  StockMetricCard,
  StockMetricsGrid,
  StockPageShell,
  StockTableCard,
  StockTablePagination,
  StockToolbar,
  LinhaFantasmaDaTabela,
  corpoDaTabela,
  type ColunaFantasma,
} from "@/components/stock/stock-workbench";

const skuSchema = z.object({
  cod_btg: z.string().min(1, "Obrigatório"),
  cod_cliente: z.string().min(1, "Obrigatório"),
  produto: z.string().min(1, "Obrigatório"),
  estoque_tipo: z.string().optional(),
  genero: z.string().optional(),
  categoria: z.string().optional(),
  cor: z.string().optional(),
  tamanho: z.string().optional(),
  estado: z.string().optional(),
  // Vazio = sem mínimo (o item nunca aparece como "Baixo").
  estoque_minimo: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .refine(
      (value) =>
        value === undefined || value === null || /^\d*$/.test(String(value).trim()),
      "Use um número inteiro, ou deixe vazio",
    ),
});

type SkuFormValues = z.infer<typeof skuSchema>;

/**
 * O nome no padrão de 06/11/2026, como no Cadastro (products.tsx): recusa
 * antes de enviar na criação e quando o nome ou o tamanho mudam na edição.
 */
function skuSchemaFor(sku?: { produto?: unknown; tamanho?: unknown }) {
  return skuSchema.superRefine((dados, ctx) => {
    const achado = problemaDoNomeNoCadastro(dados, sku);
    if (achado) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [achado.campo], message: achado.problema.mensagem });
  });
}

export default function Skus() {
  // Espelho do requireCatalogWrite do servidor (mesma regra de Produtos).
  const { user } = useAppUser();
  const catalogWriter = canWriteCatalog(user?.publicMetadata.role);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("todos");
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  // A busca e a página leem no servidor: a lista anterior fica, a 50% e inert, até a nova chegar (carregamento
  // v2, momento 7, caso 4); a releitura que falha não a apaga, e a troca que falha mostra o aviso no lugar dela.
  const leitura = useListSkus(
    { search: debouncedSearch || undefined, limit, offset: page * limit },
    { query: { queryKey: getListSkusQueryKey({ search: debouncedSearch || undefined, limit, offset: page * limit }), placeholderData: keepPreviousData } }
  );
  const { data, isLoading } = leitura;
  const lista = useListaComFiltro(leitura);
  const troca = useListaEmTroca(lista.trocando);
  const idDaLinha = useId();

  const skus = data?.items ?? [];
  // Antes da primeira leitura, o bloco no lugar de cada número e do resumo da página; com ela falhando, "—": nunca
  // zero antes de ler (carregamento v2, parte 13d; necessidade 3).
  const lido = data !== undefined && !lista.falhou;
  const contagem = useContagemLembrada("skus", "todos", lido && !lista.trocando ? { linhas: skus.length } : null);

  // Endereço mora no SALDO (stock_balances.location_id) — é lá que a
  // contagem de abertura grava rua/prateleira/caixa. Os campos rua/
  // prateleira/caixa do catálogo são herança da planilha e ficam como
  // fallback para dados importados.
  const balancesQuery = useQuery({
    queryKey: ["stock-balances", "skus-screen"],
    queryFn: async () => {
      const response = await fetch("/api/stock-balances?limit=1000");
      if (!response.ok) throw new Error("HTTP " + response.status);
      return (await response.json()) as {
        items?: Array<{
          sku_code?: string;
          client_item_code?: string;
          location_id?: string;
        }>;
      };
    },
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
  // O endereço só se afirma com os saldos lidos: antes, nenhuma linha diz "Sem endereço" (o lugar fica neutro), e a
  // falha deles não tira a lista, mas diz que os endereços não vieram, com "Tentar de novo" (a cópia fica na tela
  // enquanto tenta). A releitura de 2 min que falha com os saldos lidos não muda nada na tela.
  const saldos = useLeituraComFalha(balancesQuery);
  const enderecosLidos = balancesQuery.data !== undefined;
  const falhaDosEnderecos = lido ? falhaDasLeituras([[balancesQuery, saldos]]) : null;

  const balancesBySku = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const balance of balancesQuery.data?.items ?? []) {
      const location = String(balance.location_id ?? "").trim();
      if (!location) continue;
      for (const key of [balance.sku_code, balance.client_item_code]) {
        const normalized = String(key ?? "").trim();
        if (!normalized) continue;
        const list = map.get(normalized) ?? [];
        if (!list.includes(location)) list.push(location);
        map.set(normalized, list);
      }
    }
    return map;
  }, [balancesQuery.data]);

  /** Os endereços do SKU; nulo enquanto os saldos não foram lidos (a tela não sabe e não afirma). */
  const locationsForSku = (sku: {
    cod_btg?: string | null;
    cod_cliente?: string | null;
    rua?: string | null;
    prateleira?: string | null;
    caixa?: string | null;
    endereco?: string | null;
  }): string[] | null => {
    if (!enderecosLidos) return null;
    const fromBalances =
      balancesBySku.get(String(sku.cod_btg ?? "").trim()) ??
      balancesBySku.get(String(sku.cod_cliente ?? "").trim()) ??
      [];
    if (fromBalances.length) return fromBalances;
    const legacy =
      sku.endereco ||
      [
        sku.rua && "R" + sku.rua,
        sku.prateleira && "P" + sku.prateleira,
        sku.caixa && "C" + sku.caixa,
      ]
        .filter(Boolean)
        .join(" ");
    return legacy ? [legacy] : [];
  };
  const stats = useMemo(() => {
    return skus.reduce(
      (acc, sku) => {
        const current = Number(sku.estoque_atual ?? 0);
        const reserved = Number((sku as any).estoque_reservado ?? 0);
        const available = Number((sku as any).estoque_disponivel ?? Math.max(0, current - reserved));
        acc.physical += current;
        acc.available += available;
        acc.reserved += reserved;
        if (current <= 0) acc.zero += 1;
        if (current > 0 && current <= 10) acc.low += 1;
        if (locationsForSku(sku)?.length === 0) acc.noLocation += 1;
        return acc;
      },
      { physical: 0, available: 0, reserved: 0, low: 0, zero: 0, noLocation: 0 },
    );
  }, [skus, balancesBySku, enderecosLidos]);

  // "Sem endereço" antes dos saldos lidos não sabe quais são: a tabela espera os endereços (as linhas-fantasma, com a
  // linha de estado dizendo "Carregando os endereços…"), e na falha deles o aviso diz; nunca o falso zero da página.
  const filtroEsperaOsEnderecos = quickFilter === "sem-local" && !enderecosLidos;
  const lendoOsEnderecos = lido && filtroEsperaOsEnderecos && !falhaDosEnderecos;
  const lendoAsLinhas = isLoading || lendoOsEnderecos;
  // As linhas-fantasma entram aos 300 ms, e na chegada as reais tomam o lugar delas em cascata (momento 2).
  const fantasmas = useEspera(lendoAsLinhas);
  const chegando = useChegada(isLoading);

  const filteredSkus = skus.filter((sku) => {
    const current = Number(sku.estoque_atual ?? 0);
    const hasLocation = (locationsForSku(sku)?.length ?? 0) > 0;
    if (quickFilter === "baixo") return current > 0 && current <= 10;
    if (quickFilter === "zerado") return current <= 0;
    if (quickFilter === "sem-local") return enderecosLidos && !hasLocation;
    return true;
  });

  return (
    <StockPageShell
      eyebrow="Estoque"
      title="SKUs e saldos"
      icon={<Layers className="h-6 w-6" />}
      actions={catalogWriter ? <SkuModal /> : undefined}
      // A casa do estado da lista, sob o título, sem empurrar a lista: "Carregando SKUs…" na primeira leitura, com as
      // linhas-fantasma no lugar da tabela (carregamento v2, parte 13d).
      // Os saldos (os endereços) são da primeira leitura da tela: até chegarem, a linha diz que lê, com a demora aos 10 s e
      // o "Tentar de novo"; na falha deles, o aviso fica sobre a tabela e a linha fica vazia (a cópia da falha).
      estado={
        <LinhaDeEstado
          id={idDaLinha}
          leitura={enderecosLidos ? leitura : [leitura, saldos]}
          objeto={data !== undefined && !enderecosLidos ? "os endereços" : "SKUs"}
        />
      }
    >
      {/* "SKUs carregados" era contagem técnica da página, não decisão de
          estoque — o total já aparece na paginação da tabela. */}
      <StockMetricsGrid>
        <StockMetricCard
          label="Saldo físico"
          value={lido ? formatStockNumber(stats.physical) : lista.falhou ? "—" : <Esqueleto forma="contagem" />}
          icon={<Boxes className="h-5 w-5" />}
        />
        <StockMetricCard
          label="Disponível"
          value={lido ? formatStockNumber(stats.available) : lista.falhou ? "—" : <Esqueleto forma="contagem" />}
          icon={<PackageCheck className="h-5 w-5" />}
        />
        {/* "Atenção" conta os sem endereço: só com os saldos lidos. */}
        <StockMetricCard
          label="Atenção"
          value={
            lido && enderecosLidos
              ? formatStockNumber(stats.low + stats.zero + stats.noLocation)
              : lista.falhou || falhaDosEnderecos
                ? "—"
                : <Esqueleto forma="contagem" />
          }
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={lido && enderecosLidos && stats.low + stats.zero + stats.noLocation ? "amber" : "default"}
        />
      </StockMetricsGrid>

      <StockToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Buscar por cod. cliente, SKU interno, produto ou localização"
        // A página que não chegou não tem contagem: o aviso está no lugar da lista, e "0" seria um falso zero.
        resultText={
          lista.falhou || (filtroEsperaOsEnderecos && falhaDosEnderecos) ? undefined : lido && !filtroEsperaOsEnderecos ? (
            `${formatStockNumber(filteredSkus.length)} SKU(s) exibido(s) nesta página.`
          ) : (
            <span className="flex h-5 items-center"><Esqueleto forma="texto" className="w-48" /></span>
          )
        }
      >
        <StockFilterChip active={quickFilter === "todos"} onClick={() => setQuickFilter("todos")} count={lido ? skus.length : undefined}>
          Todos
        </StockFilterChip>
        <StockFilterChip active={quickFilter === "baixo"} onClick={() => setQuickFilter("baixo")} count={lido ? stats.low : undefined}>
          Baixo estoque
        </StockFilterChip>
        <StockFilterChip active={quickFilter === "zerado"} onClick={() => setQuickFilter("zerado")} count={lido ? stats.zero : undefined}>
          Zerados
        </StockFilterChip>
        <StockFilterChip active={quickFilter === "sem-local"} onClick={() => setQuickFilter("sem-local")} count={lido && enderecosLidos ? stats.noLocation : undefined}>
          Sem endereço
        </StockFilterChip>
      </StockToolbar>

      <StockTableCard trocando={lista.trocando} pagina={page}>
          {lista.falhou ? (
            <FalhaNaLeitura leitura={leitura} erro={lista.erro} mensagem="Não consegui carregar os SKUs." className="rounded-none border-0" focoAoSair={idDaLinha} />
          ) : (
          <>
          {falhaDosEnderecos ? (
            <FalhaNaLeitura leitura={falhaDosEnderecos.leitura} erro={falhaDosEnderecos.erro} mensagem="Não consegui carregar os endereços." className="m-3" focoAoSair={idDaLinha} />
          ) : null}
          <div
            // Lendo, a faixa do brilho anda além do corpo da tabela (o tbody não recorta): quem recorta é a caixa, sem
            // abrir a rolagem lateral.
            className={lendoAsLinhas ? "overflow-hidden" : "overflow-x-auto"}
            {...troca.props}
          >
            <ConteudoEmTroca trocando={lista.trocando}>
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border/80 bg-card">
                <tr>
                  <th className="px-5 py-4 font-medium">Cod. cliente</th>
                  <th className="px-4 py-4 font-medium">SKU interno</th>
                  <th className="px-4 py-3 font-medium">Detalhes do Produto</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                  <th className="px-4 py-3 font-medium">Localização</th>
                  <th className="px-4 py-3 font-medium text-right">Estoque Atual</th>
                  <th className="px-4 py-3 font-medium text-center">Ações</th>
                </tr>
              </thead>
              <tbody {...corpoDaTabela({ lendo: lendoAsLinhas, visivel: fantasmas.visivel, chegando, idDaLinha, className: "divide-y divide-border" })}>
                {lendoAsLinhas ? (
                  // As linhas-fantasma da primeira leitura, na altura da linha real; quem diz é a linha de estado.
                  Array.from({ length: contagem.linhas("linhas") }, (_, ordem) => (
                    <LinhaFantasmaDaTabela key={ordem} visivel={fantasmas.visivel} larguras={FANTASMA_DOS_SKUS} />
                  ))
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhum SKU encontrado.</td>
                  </tr>
                ) : (
                  filteredSkus.map((sku: Sku) => {
                    const reserved = Number((sku as any).estoque_reservado ?? 0);
                    const current = Number(sku.estoque_atual ?? 0);
                    const available = Number(
                      (sku as any).estoque_disponivel ?? Math.max(0, current - reserved),
                    );
                    const isLow = current > 0 && current <= 10;
                    const enderecos = locationsForSku(sku);

                    return (
                      <tr key={sku.id} className="hover:bg-muted/80 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-primary font-bold">{sku.cod_cliente}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{sku.cod_btg}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-foreground truncate max-w-[200px]" title={sku.produto}>{sku.produto}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {sku.categoria && `${sku.categoria} • `}
                            {sku.cor || "-"} / {sku.tamanho || "-"}
                          </div>
                        </td>
                        {/* Coluna "Tipo" (estoque_tipo) removida: era campo
                            exclusivo da planilha Excel — o fluxo nativo nunca
                            o preenche e o histórico foi zerado no go-live.
                            Status sem estado legado = OK (saldo saudável). */}
                        <td className="px-4 py-2 text-center">
                          <Badge variant="secondary" className={
                            current <= 0 ? 'bg-destructive-soft text-destructive-soft-foreground' :
                            isLow ? 'bg-warning-soft text-warning-soft-foreground' :
                            sku.estado === 'AVARIADO' ? 'bg-destructive-soft text-destructive-soft-foreground' :
                            'bg-primary/10 text-primary'
                          }>
                            {current <= 0 ? "ZERADO" : isLow ? "BAIXO" : sku.estado || "OK"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          {enderecos === null ? (
                            // Os saldos ainda não chegaram (ou falharam): o lugar do endereço fica neutro, nunca "Sem endereço".
                            falhaDosEnderecos ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <span className="flex h-6 items-center"><Esqueleto forma="texto" className="h-3 w-20" /></span>
                            )
                          ) : enderecos.length ? (
                            <div
                              className="flex items-center gap-1.5 text-xs font-medium text-info-soft-foreground bg-info-soft px-2 py-1 rounded w-fit border border-info-soft-border"
                              title={enderecos.join(" · ")}
                            >
                              <MapPin className="h-3 w-3" aria-hidden="true" />
                              {enderecos[0]}
                              {enderecos.length > 1 ? " +" + (enderecos.length - 1) : ""}
                            </div>
                          ) : (
                            <span className="text-xs text-warning-soft-foreground">Sem endereço</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className={`font-semibold ${current === 0 ? 'text-destructive-soft-foreground' : 'text-foreground'}`}>
                            {current.toLocaleString('pt-BR')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            disp. {available.toLocaleString('pt-BR')}
                            {reserved > 0 ? ` · res. ${reserved.toLocaleString('pt-BR')}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {catalogWriter ? (
                            <div className="flex items-center justify-center gap-2">
                              <SkuModal sku={sku} />
                              <DeleteSkuButton id={sku.id} cod_btg={sku.cod_btg} />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </ConteudoEmTroca>
          </div>
          </>
          )}
          
          <StockTablePagination
            page={page}
            isLoading={isLoading}
            ocupada={lista.trocando}
            /* Sem a leitura, nem "Exibindo 0 de 0": a contagem só depois de ler (necessidade 3). */
            semContagem={lista.falhou || data === undefined}
            count={data?.items?.length || 0}
            total={data?.total || 0}
            limit={limit}
            label="SKUs"
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
      </StockTableCard>
    </StockPageShell>
  );
}

export function SkuModal({ sku, trigger }: { sku?: any; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createSku = useCreateSku();
  const updateSku = useUpdateSku();

  const isEdit = !!sku;
  // Depois da abertura concluída, saldo novo só entra por recebimento; o
  // atalho para a abertura some para não levar a um beco sem saída.
  const openingSession = useOpeningInventorySession();
  const openingAvailable = openingSession.data?.status !== "completed";

  const schema = useMemo(() => skuSchemaFor(sku), [sku]);
  // O Tamanho que o código pôs sozinho no item novo (seguirSugestao).
  const tamanhoPosto = useRef("");

  const { register, handleSubmit, formState: { errors, isSubmitted }, reset, getValues, setValue, trigger: validar } = useForm<SkuFormValues>({
    resolver: zodResolver(schema),
    // Campo nulo no cadastro vira vazio: o schema só aceita texto.
    defaultValues: sku ? {
      ...sku,
      estoque_tipo: sku.estoque_tipo ?? "",
      genero: sku.genero ?? "",
      categoria: sku.categoria ?? "",
      cor: sku.cor ?? "",
      tamanho: sku.tamanho ?? "",
      estado: sku.estado ?? "",
      estoque_minimo: sku.estoque_minimo ?? "",
    } : {
      cod_btg: "",
      cod_cliente: "",
      produto: "",
      estoque_tipo: "",
      genero: "",
      categoria: "",
      cor: "",
      tamanho: "",
      estado: "NOVO",
      estoque_minimo: "",
    }
  });

  // No item novo, o fim do código preenche o Tamanho (A.01.0806.005.XG → XG).
  const codCliente = register("cod_cliente", {
    onChange: (event) => {
      if (!isEdit) {
        const atual = getValues("tamanho") ?? "";
        const sugestao = seguirSugestao(atual, tamanhoPosto.current, tamanhoDoCodigo(event.target.value) ?? "");
        tamanhoPosto.current = sugestao.posto;
        if (sugestao.valor !== atual) setValue("tamanho", sugestao.valor);
      }
      // A recusa do nome depende do código: depois de tentar salvar, ela acompanha.
      if (isSubmitted) void validar(["produto", "tamanho"]);
    },
  });

  const onSubmit = (data: SkuFormValues) => {
    if (isEdit) {
      updateSku.mutate(
        { id: sku.id, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
            queryClient.invalidateQueries({ queryKey: ["estoque"] });
            toast({ title: "SKU atualizado com sucesso" });
            setOpen(false);
          },
          onError: (error) => {
            toast({
              title: "Erro ao atualizar SKU",
              description: humanApiError(error, "Tente novamente em instantes."),
              variant: "destructive",
            });
          }
        }
      );
    } else {
      createSku.mutate(
        { data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
            queryClient.invalidateQueries({ queryKey: ["estoque"] });
            toast({ title: "SKU criado com sucesso" });
            setOpen(false);
            reset();
            tamanhoPosto.current = "";
          },
          onError: (error) => {
            toast({
              title: "Erro ao criar SKU",
              description: humanApiError(error, "Tente novamente em instantes."),
              variant: "destructive",
            });
          }
        }
      );
    }
  };

  return (
    <Dialog open={open} ocupado={createSku.isPending || updateSku.isPending} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ? trigger : isEdit ? (
          <Button variant="ghost" size="icon" aria-label={`Editar ${sku.cod_btg}`} className="h-8 w-8 text-info-soft-foreground hover:text-info-soft-foreground hover:bg-info-soft">
            <Edit className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Adicionar SKU
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cadastro mestre" : "Novo cadastro mestre de SKU"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Identificadores</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Os dois códigos são a identidade do cadastro: o servidor recusa a
                  troca (catalogCodeForMutation), então a edição só os mostra. */}
              <div className="space-y-2">
                <Label htmlFor="cod_btg">SKU *</Label>
                <Input id="cod_btg" readOnly={isEdit} className="read-only:bg-muted read-only:text-muted-foreground" {...register("cod_btg")} />
                {errors.cod_btg && <span className="text-xs text-destructive">{errors.cod_btg.message}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cod_cliente">Cod. Cliente *</Label>
                <Input id="cod_cliente" readOnly={isEdit} className="read-only:bg-muted read-only:text-muted-foreground" {...codCliente} {...atributosDoProblema(errors.cod_cliente, "cod_cliente")} />
                {errors.cod_cliente && <span id="cod_cliente-problema" className="text-xs text-destructive">{errors.cod_cliente.message}</span>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="produto">Nome do Produto *</Label>
                <Input id="produto" className="aria-[invalid=true]:border-destructive" {...register("produto")} {...atributosDoProblema(errors.produto, "produto")} />
                {errors.produto && <span id="produto-problema" className="text-xs text-destructive">{errors.produto.message}</span>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Atributos</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="categoria">Categoria</Label>
                <Input id="categoria" {...register("categoria")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cor">Cor</Label>
                <Input id="cor" {...register("cor")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tamanho">Tamanho</Label>
                <Input id="tamanho" className="aria-[invalid=true]:border-destructive" {...register("tamanho")} {...atributosDoProblema(errors.tamanho, "tamanho")} />
                {errors.tamanho && <span id="tamanho-problema" className="text-xs text-destructive">{errors.tamanho.message}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="estoque_tipo">Tipo de Estoque</Label>
                <Input id="estoque_tipo" {...register("estoque_tipo")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estado">Condição</Label>
                <Input id="estado" placeholder="NOVO" {...register("estado")} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Reposição</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="estoque_minimo">Estoque mínimo</Label>
                <Input
                  id="estoque_minimo"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Sem mínimo"
                  {...register("estoque_minimo")}
                />
              </div>
              <p className="col-span-2 self-end pb-2 text-xs leading-5 text-muted-foreground">
                Com saldo igual ou abaixo deste número o item aparece como “Baixo” no Estoque. Vazio: sem alerta.
              </p>
            </div>
            {errors.estoque_minimo && <span className="text-xs text-destructive">{errors.estoque_minimo.message}</span>}
          </div>

          <div className="rounded-2xl border border-info-soft-border bg-info-soft/55 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-info-soft-border bg-card text-info-soft-foreground">
                <Boxes className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Saldo e endereço são registrados no WMS</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Depois de salvar o SKU, escolha o fluxo que corresponde à movimentação física.
                </p>
              </div>
            </div>

            <div className={cn("mt-4 grid gap-2", openingAvailable && "sm:grid-cols-2")}>
              {openingAvailable ? (
                <Button asChild type="button" variant="outline" className="h-auto min-h-16 justify-between gap-3 bg-card px-4 py-3 text-left">
                  <Link href="/wms/contagem" onClick={() => setOpen(false)}>
                    <span className="flex min-w-0 items-center gap-3">
                      <ClipboardCheck className="h-4 w-4 shrink-0 text-info-soft-foreground" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">Inventário de abertura</span>
                        <span className="block text-xs font-normal text-muted-foreground">Registrar o primeiro saldo</span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </Button>
              ) : null}

              <Button asChild type="button" variant="outline" className="h-auto min-h-16 justify-between gap-3 bg-card px-4 py-3 text-left">
                <Link href="/wms/receber" onClick={() => setOpen(false)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <PackagePlus className="h-4 w-4 shrink-0 text-info-soft-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Recebimento</span>
                      <span className="block text-xs font-normal text-muted-foreground">Lançar as próximas entradas</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </Button>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              {isEdit ? "Caminhos" : "Salve este cadastro antes de seguir. Depois, use"}:{" "}
              {openingAvailable
                ? "Estoque › Contagem, aba Inventário de abertura, ou Estoque › Receber."
                : "Estoque › Receber. O inventário de abertura já foi concluído; saldo novo entra por recebimento."}
            </p>
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <DialogCancelar />
            <BotaoDeAcao type="submit" estado={createSku.isPending || updateSku.isPending ? "andamento" : "repouso"} rotulo="Salvar SKU" andamento="Salvando…" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSkuButton({ id, cod_btg, trigger }: { id: number, cod_btg: string, trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteSku = useDeleteSku();

  const onDelete = () => {
    deleteSku.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
          toast({ title: "Item arquivado" });
          setOpen(false);
        },
        onError: (error) => {
          toast({
            title: "Erro ao arquivar item",
            description: humanApiError(error, "Tente novamente em instantes."),
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <Dialog open={open} ocupado={deleteSku.isPending} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label={`Arquivar ${cod_btg}`} className="h-8 w-8 text-destructive-soft-foreground hover:text-destructive-soft-foreground hover:bg-destructive-soft">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Arquivar item</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Arquivar <strong className="text-foreground">{cod_btg}</strong>? O item sai das
            listas; o histórico de movimentos continua guardado.
          </p>
        </div>
        <DialogFooter>
          <DialogCancelar />
          <BotaoDeAcao variant="destructive" estado={deleteSku.isPending ? "andamento" : "repouso"} rotulo="Arquivar" andamento="Arquivando…" onClick={onDelete} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A largura do bloco de cada coluna da linha-fantasma dos SKUs. */
const FANTASMA_DOS_SKUS: readonly ColunaFantasma[] = ["w-28", "w-24", "w-44", "w-14", "w-20", "w-12", "acoes"];
