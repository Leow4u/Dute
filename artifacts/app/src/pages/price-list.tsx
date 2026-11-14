import { useId, useState, type CSSProperties } from "react";
import {
  useListPriceList,
  getListPriceListQueryKey,
  useCreatePriceListItem,
  useUpdatePriceListItem,
  useDeletePriceListItem,
  useGetBillingConfig,
  getGetBillingConfigQueryKey,
  useUpdateBillingConfig,
  type PriceListItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogCancelar, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Confirmacao } from "@/components/ui/confirmacao";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useContagemLembrada } from "@/lib/carregando/contagem-lembrada";
import { useAcaoNaLinha } from "@/lib/carregando/use-acao-na-linha";
import { useChegada } from "@/lib/carregando/use-chegada";
import { useEspera } from "@/lib/carregando/use-espera";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Plus } from "lucide-react";
import { GRUPOS, AUTO_LABELS, fmtBRL } from "@/lib/billing-format";
import { ROTULO_DO_COMERCIAL, fonteDoPreco, ligadoAoComercial, payloadDoItem } from "@/lib/preco-da-cobranca";

type FormState = {
  grupo: string;
  item: string;
  unidade: string;
  valor_unit: string;
  auto_source: string; // "" = manual
  ordem: string;
  ativo: boolean;
};

const EMPTY: FormState = { grupo: "armazenamento", item: "", unidade: "", valor_unit: "0", auto_source: "", ordem: "0", ativo: true };

export default function PriceList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  // A tabela e a cobrança só se afirmam depois de lidas: carregando não é
  // "Nenhum serviço", e a cobrança não salva antes de chegar
  // (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026).
  const lista = useListPriceList();
  const { data } = lista;
  const leituraDaConfig = useGetBillingConfig();
  const config = leituraDaConfig.data;
  // A falha sem nada lido fica na tela enquanto a pessoa tenta de novo (a cópia): o aviso não volta a "carregando"
  // nem sai com o foco no "Tentar de novo"; a releitura que falha com a tabela lida fica na linha de estado
  // (carregamento v2, parte 13d).
  const tabela = useLeituraComFalha(lista);
  const cobranca = useLeituraComFalha(leituraDaConfig);
  const lendoATabela = data === undefined && !tabela.isError;
  const lendoACobranca = config === undefined && !cobranca.isError;
  const idDaLinha = useId();
  // A cobrança tem a casa do estado dela, sob o título: "Carregando a cobrança…" aos 300 ms, a demora aos 10 s com
  // "Tentar de novo" e o foco que volta a ela quando o aviso da falha sai.
  const idDaCobranca = useId();
  // As linhas-fantasma e os blocos da cobrança entram aos 300 ms, quantas linhas a última leitura trouxe (de 1 a 5).
  const fantasmas = useEspera(lendoATabela);
  const fantasmasDaCobranca = useEspera(lendoACobranca);
  // Na chegada, as linhas reais entram no lugar das fantasmas por opacidade, subindo 4 px, em cascata (momento 2).
  const chegando = useChegada(lendoATabela);
  const contagem = useContagemLembrada("tabela-de-precos", "todos", data ? { linhas: data.items?.length ?? 0 } : null);

  const create = useCreatePriceListItem();
  const update = useUpdatePriceListItem();
  const del = useDeletePriceListItem();
  const saveConfig = useUpdateBillingConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  // O item ligado ao Comercial (parte 7.3c) não edita o preço aqui.
  const [editLigado, setEditLigado] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [removing, setRemoving] = useState<PriceListItem | null>(null);
  // "Salvar cobrança" no relógio da ação (momento 3): "Salvando…" até o servidor responder; "Cobrança salva" pelo
  // menos 1 s e até a configuração voltar lida (os campos se refazem com ela); no erro, "Cobrança não salva" por 2 s.
  // Aos 70 s sem resposta, "Conferir" relê a configuração e nunca grava de novo.
  const acoes = useAcaoNaLinha<"cobranca">();

  // Config form
  const [rate, setRate] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  // Os campos nascem com a configuração lida, no mesmo desenho em que ela chega: nem um quadro com eles vazios.
  const [configVista, setConfigVista] = useState<typeof config>(undefined);
  if (config && config !== configVista) {
    setConfigVista(config);
    setRate(String((config.ad_valorem_rate || 0) * 100));
    setNome(config.cliente_nome || "");
    setEmail(config.cliente_email || "");
  }

  const refetch = () => qc.invalidateQueries({ queryKey: getListPriceListQueryKey() });

  const openNew = () => { setEditId(null); setEditLigado(false); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (it: PriceListItem) => {
    setEditId(it.id);
    setEditLigado(ligadoAoComercial(it as PriceListItem & { lpu_item_id?: unknown }));
    setForm({
      grupo: it.grupo,
      item: it.item,
      unidade: it.unidade || "",
      valor_unit: String(it.valor_unit),
      auto_source: it.auto_source || "",
      ordem: String(it.ordem),
      ativo: it.ativo,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      grupo: form.grupo,
      item: form.item,
      unidade: form.unidade || undefined,
      valor_unit: Number(form.valor_unit || 0),
      auto_source: form.auto_source || undefined,
      ordem: Number(form.ordem || 0),
      ativo: form.ativo,
    };
    if (!form.item.trim()) { toast({ title: "Informe o nome do serviço", variant: "destructive" }); return; }
    const onSuccess = () => { toast({ title: "Item salvo" }); setDialogOpen(false); refetch(); };
    const onError = () => toast({ title: "Erro ao salvar item", variant: "destructive" });
    if (editId != null) update.mutate({ id: editId, data: payloadDoItem(payload, editLigado) as typeof payload }, { onSuccess, onError });
    else create.mutate({ data: payload }, { onSuccess, onError });
  };

  const handleDelete = (id: number) => {
    del.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: "Item removido" }); setRemoving(null); refetch(); },
        onError: () => toast({ title: "Erro ao remover item", variant: "destructive" }),
      },
    );
  };

  const handleSaveConfig = () => {
    const dados = { ad_valorem_rate: Number(rate || 0) / 100, cliente_nome: nome, cliente_email: email };
    // A chamada é a de sempre; o segundo toque com a cobrança ocupada não grava de novo.
    void acoes.executar(
      "cobranca",
      "salvar",
      () =>
        saveConfig.mutateAsync({ data: dados }).then(
          () => toast({ title: "Configurações salvas" }),
          (erro: unknown) => {
            toast({ title: "Erro ao salvar configurações", variant: "destructive" });
            throw erro;
          },
        ),
      {
        releitura: () => qc.invalidateQueries({ queryKey: getGetBillingConfigQueryKey() }),
        conferir: async () => {
          const lida = (await leituraDaConfig.refetch()).data;
          return (
            lida !== undefined &&
            lida.ad_valorem_rate === dados.ad_valorem_rate &&
            (lida.cliente_nome || "") === dados.cliente_nome &&
            (lida.cliente_email || "") === dados.cliente_email
          );
        },
      },
    );
  };

  const items = data?.items ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border/60 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Serviços e valores</h2>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" />
              Novo item
            </Button>
          </div>
          {/* A casa do estado da tabela, sob o título e na largura do cartão: "Carregando serviços…" na primeira
              leitura, com as linhas-fantasma no lugar dela; "Atualizado às" e a releitura que falha, sem apagar a
              tabela. No celular, o que não cabe passa à linha de baixo, sem cobrir o "Novo item". */}
          {/* A cópia da falha: a releitura automática da tabela que falhou não diz "Carregando" ao lado do aviso. */}
          <LinhaDeEstado id={idDaLinha} leitura={tabela} objeto="serviços" className="mt-1" />
        </div>
        {/* Lendo, a faixa do brilho anda além do corpo da tabela (o tbody não recorta): quem recorta é a caixa, sem abrir a
            rolagem lateral. */}
        <div className={lendoATabela ? "overflow-hidden" : "overflow-x-auto"}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-5 py-2.5 font-semibold">Serviço</th>
                <th className="px-3 py-2.5 font-semibold">Grupo</th>
                <th className="px-3 py-2.5 font-semibold">Unidade</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Valor unit.</th>
                <th className="px-3 py-2.5 font-semibold">Quantidade</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody
              // Um brilho por cartão (seção 5.2): o corpo das linhas-fantasma inteiro, nunca cada bloco.
              className={lendoATabela && fantasmas.visivel ? "carregando-com-brilho" : undefined}
              {...(lendoATabela ? { "aria-busy": true, "aria-describedby": idDaLinha } : {})}
              {...(chegando ? { "data-chegada": "" } : {})}
            >
              {tabela.isError && data === undefined ? (
                <tr>
                  <td colSpan={6} className="p-3">
                    <FalhaNaLeitura leitura={lista} erro={tabela.error} mensagem="Não consegui carregar a tabela." focoAoSair={idDaLinha} />
                  </td>
                </tr>
              ) : data === undefined ? (
                // As linhas-fantasma da primeira leitura, com a altura da linha real; quem diz é a linha de estado.
                Array.from({ length: contagem.linhas("linhas") }, (_, ordem) => {
                  const celula = "flex h-10 items-center";
                  return (
                    <tr key={ordem} aria-hidden="true" data-fantasmas="" data-visivel={fantasmas.visivel ? "" : undefined} className="border-b border-border/40 last:border-0">
                      <td className="px-5 py-3"><span className={celula}><Esqueleto forma="texto" className="w-36" /></span></td>
                      <td className="px-3 py-3"><span className={celula}><Esqueleto forma="texto" className="w-24" /></span></td>
                      <td className="px-3 py-3"><span className={celula}><Esqueleto forma="texto" className="w-14" /></span></td>
                      <td className="px-3 py-3"><span className={cn(celula, "justify-end")}><Esqueleto forma="texto" className="w-16" /></span></td>
                      <td className="px-3 py-3"><span className={celula}><Esqueleto forma="texto" className="w-16" /></span></td>
                      <td className="px-3 py-3"><span className={cn(celula, "justify-end")}><Esqueleto forma="bloco" className="size-8" /></span></td>
                    </tr>
                  );
                })
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-sm text-muted-foreground">
                    Nenhum serviço na tabela. Adicione o primeiro em "Novo item".
                  </td>
                </tr>
              ) : null}
              {items.map((it) => (
                <tr
                  key={it.id}
                  className={cn("border-b border-border/40 last:border-0", !it.ativo && "text-muted-foreground")}
                >
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{it.item}</span>
                      {!it.ativo ? <Badge variant="secondary">Inativo</Badge> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{GRUPOS[it.grupo]?.label ?? it.grupo}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{it.unidade}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {(() => {
                      const fonte = fonteDoPreco(it as PriceListItem & { lpu_item_id?: unknown });
                      return fonte.tipo === "comercial" ? <span className="text-muted-foreground">{ROTULO_DO_COMERCIAL}</span> : fmtBRL(fonte.valor);
                    })()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {it.auto_source ? (
                      <Badge variant="default">{AUTO_LABELS[it.auto_source] || it.auto_source}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Manual</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Ações de ${it.item}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(it)}>Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(it)}>
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* A cobrança só se mostra lida: antes, os campos vazios e apagados pareciam uma taxa vazia, e um clique gravava
          a taxa 0. Lendo, o esqueleto dos campos e a seção ocupada; na falha, o aviso com "Tentar de novo". */}
      <section
        className="h-fit rounded-lg border border-border bg-card"
        aria-busy={lendoACobranca || undefined}
        aria-describedby={lendoACobranca ? idDaCobranca : undefined}
      >
        <div className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold">Cobrança</h2>
          {/* A casa do estado da cobrança, que lê à parte da tabela: o leitor de tela e quem olha sabem que ela lê. */}
          <LinhaDeEstado id={idDaCobranca} leitura={cobranca} objeto="a cobrança" className="mt-1" />
        </div>
        {cobranca.isError && config === undefined ? (
          <div className="p-3">
            <FalhaNaLeitura
              className="sm:flex-col sm:items-start"
              leitura={leituraDaConfig}
              erro={cobranca.error}
              mensagem="Não consegui carregar a cobrança."
              focoAoSair={idDaCobranca}
            />
          </div>
        ) : config === undefined ? (
          <EsqueletoDaCobranca visivel={fantasmasDaCobranca.visivel} />
        ) : (
        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="billing-rate">Taxa ad valorem (%)</Label>
            <Input id="billing-rate" type="number" step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Aplicada sobre o valor total do estoque.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billing-name">Nome do cliente</Label>
            <Input id="billing-name" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billing-email">E-mail para envio da fatura</Label>
            <Input id="billing-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" />
          </div>
          <BotaoDeAcao
            variant="outline"
            className="w-full"
            estado={acoes.estado("cobranca", "salvar")}
            rotulo="Salvar cobrança"
            andamento="Salvando…"
            sucesso="Cobrança salva"
            erro="Cobrança não salva"
            onClick={handleSaveConfig}
          />
        </div>
        )}
      </section>

      <Dialog open={dialogOpen} ocupado={create.isPending || update.isPending} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId != null ? "Editar item" : "Novo item"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5 col-span-2">
              <Label>Grupo</Label>
              <Select value={form.grupo} onValueChange={(v) => setForm((s) => ({ ...s, grupo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(GRUPOS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Serviço / Item</Label>
              <Input value={form.item} onChange={(e) => setForm((s) => ({ ...s, item: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Unidade</Label>
              <Input value={form.unidade} onChange={(e) => setForm((s) => ({ ...s, unidade: e.target.value }))} placeholder="palete, caixa…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price-list-valor">Valor unitário (R$)</Label>
              {editLigado ? (
                <Input id="price-list-valor" value={ROTULO_DO_COMERCIAL} readOnly disabled />
              ) : (
                <Input id="price-list-valor" type="number" step="0.0001" value={form.valor_unit} onChange={(e) => setForm((s) => ({ ...s, valor_unit: e.target.value }))} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Origem da quantidade</Label>
              <Select value={form.auto_source || "manual"} onValueChange={(v) => setForm((s) => ({ ...s, auto_source: v === "manual" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (digitada)</SelectItem>
                  <SelectItem value="ad_valorem">Ad Valorem (% estoque)</SelectItem>
                  <SelectItem value="mov_entrada_pecas">Entradas (peças)</SelectItem>
                  <SelectItem value="mov_saida_pecas">Saídas (peças)</SelectItem>
                  <SelectItem value="mov_count">Nº de movimentações</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ordem</Label>
              <Input type="number" value={form.ordem} onChange={(e) => setForm((s) => ({ ...s, ordem: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm((s) => ({ ...s, ativo: v }))} />
              <Label>Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <DialogCancelar />
            <BotaoDeAcao estado={create.isPending || update.isPending ? "andamento" : "repouso"} rotulo="Salvar" andamento="Salvando…" onClick={handleSubmit} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Confirmacao
        aberta={removing !== null}
        ocupada={del.isPending}
        titulo={`Remover "${removing?.item ?? ""}"?`}
        descricao="Esta ação não pode ser desfeita."
        confirmar="Remover"
        confirmando="Removendo…"
        onConfirmar={() => { if (removing) handleDelete(removing.id); }}
        onFechar={() => setRemoving(null)}
      />
    </div>
  );
}

/**
 * A cobrança ainda lendo (carregamento v2, parte 13d): os rótulos reais e os
 * blocos no lugar dos campos e do botão, na altura deles, que entram aos 300
 * ms com o brilho. Nada é campo: fica fora da árvore de acessibilidade, e a
 * seção em volta diz que está ocupada.
 */
function EsqueletoDaCobranca({ visivel }: { visivel: boolean }) {
  const bloco = (largura: string) => (
    <span data-fantasmas="" data-visivel={visivel ? "" : undefined} className="block">
      <Esqueleto forma="bloco" className={cn("h-10", largura)} />
    </span>
  );
  // Um brilho no cartão da cobrança, nunca um por bloco (seção 5.2); o segundo cartão da tela, a 120 ms da tabela.
  return (
    <div
      className={cn("space-y-4 p-5", visivel && "carregando-com-brilho")}
      style={visivel ? ({ "--ordem": "1" } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none">Taxa ad valorem (%)</span>
        {bloco("w-full")}
        <span className="block h-4" />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none">Nome do cliente</span>
        {bloco("w-full")}
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none">E-mail para envio da fatura</span>
        {bloco("w-full")}
      </div>
      {bloco("w-full")}
    </div>
  );
}
