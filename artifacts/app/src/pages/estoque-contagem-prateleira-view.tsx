import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Printer, X } from "lucide-react";
import { Link } from "wouter";

import { FalhaDoClienteAtivo } from "@/components/layout/falha-do-cliente-ativo";
import { Badge } from "@/components/ui/badge";
import { BotaoDeAcao, type EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao, FaixaAoVivo, FalhaNaLeitura, erroDaLeituraAoVivo, type LeituraAoVivoNaTela } from "@/components/ui/erro-na-leitura";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { textoDaDiferenca } from "@/lib/warehouse-ops/contagem-por-caixa";
import {
  FORA_DA_LISTA_MAXIMO,
  ROTA_DA_RODADA,
  buscarProdutos,
  contagemCompleta,
  contagemVazia,
  dataCurta,
  diferencaDigitada,
  itensComDiferenca,
  problemaDaQuantidade,
  resumoDaBancada,
  seloDaRecontagem,
  separadosDaCaixa,
  textoDaCaixaFechada,
  textoDaConta,
  textoDaPrateleiraNaBancada,
  textoDaReserva,
  textoDoProgresso,
  tituloDaCaixa,
  unidadesComSinal,
  type BancadaDaPrateleira,
  type CaixaDaBancada,
  type ContagemDigitada,
  type ProdutoDoCatalogo,
} from "@/lib/warehouse-ops/recontagem-por-caixa";

/**
 * Estoque › Contagem por caixa › a prateleira (diagnóstico da Contagem
 * cíclica, seção 6, item 4; docs/mockups/WmsContagemPrateleira.dc.html e,
 * no celular, WmsContagemCelular.dc.html): as caixas da prateleira, cada
 * uma com o esperado de cada item e a reserva antes de digitar; uma caixa
 * por vez se conta e se confirma ("Confirmar caixa", "Caixa vazia", "Item
 * fora da lista"); a confirmada fica numa linha, com "Contar de novo" e o
 * que mudou, com a origem da peça a mais. Os dados e as ações chegam por
 * props (pages/estoque-contagem-prateleira.tsx). Sem legenda.
 */

export type EstadoDaPrateleira = "carregando" | "erro" | "nao_encontrada" | "pronto";

const MENSAGENS: Record<Exclude<EstadoDaPrateleira, "pronto">, string> = {
  carregando: "Carregando a prateleira…",
  erro: "Não consegui carregar a prateleira.",
  nao_encontrada: "Nenhuma caixa do cliente nesta prateleira.",
};

/** O aviso do catálogo que não chegou: o item fora da lista não tem como ser escolhido. */
export const SEM_CATALOGO = "Não consegui carregar o catálogo.";

/** Quantos produtos a busca do item fora da lista mostra. */
const RESULTADOS_A_VISTA = 8;

const numero = new Intl.NumberFormat("pt-BR");

/** A cor da diferença: a falta em vermelho, a sobra em verde, o zero apagado. */
function corDaDiferenca(diferenca: number | null): string {
  if (diferenca === null || diferenca === 0) return "text-muted-foreground";
  return diferenca < 0 ? "text-destructive-soft-foreground" : "text-success-soft-foreground";
}

/** O chip da caixa: o código em fonte fixa, no azul da v3. */
function Chip({ code, id }: { code: string; id?: string }) {
  return (
    <span id={id} className="whitespace-nowrap rounded-md bg-info-soft px-2 py-0.5 font-mono text-sm font-extrabold text-info-soft-foreground">
      {code}
    </span>
  );
}

/** Os ids da caixa: o título do cartão, o primeiro campo e o "Contar de novo". */
export const idsDaCaixa = (code: string) => ({
  titulo: `caixa-${code}`,
  primeiroCampo: `contado-${code}-0`,
  contar: `contar-${code}`,
});

export type AcoesDaContagem = {
  onDigitar: (sku: string, valor: string) => void;
  onAcrescentar: (produto: ProdutoDoCatalogo) => void;
  onDigitarForaDaLista: (sku: string, valor: string) => void;
  onRemoverForaDaLista: (sku: string) => void;
  onCaixaVazia: () => void;
  onConfirmar: () => void;
};

export function EstoqueContagemPrateleiraView({
  estado,
  posicao,
  bancada,
  operador,
  emContagem,
  digitado,
  confirmar,
  produtos,
  clienteFalhou = false,
  catalogoFalhou = false,
  tentandoCatalogo = false,
  onTentarCatalogo,
  hrefDaFolha,
  leitura,
  onTentar,
  onContar,
  acoes,
}: {
  estado: EstadoDaPrateleira;
  /** "A-03": o título, também enquanto lê. */
  posicao: string;
  bancada: BancadaDaPrateleira | null;
  /** Quem grava a recontagem: o suporte só consulta. */
  operador: boolean;
  /** A caixa em contagem; null sem nenhuma aberta. */
  emContagem: string | null;
  digitado: ContagemDigitada;
  /** O botão de confirmar da caixa em contagem: o estado e o rótulo ("Tentar de novo" depois do resultado incerto). */
  confirmar: { estado: EstadoDaAcao; rotulo?: string };
  /** Os produtos do cliente, para o item fora da lista. */
  produtos: readonly ProdutoDoCatalogo[];
  /** A lista dos clientes não veio: a tela não lê com o cliente padrão e diz. */
  clienteFalhou?: boolean;
  catalogoFalhou?: boolean;
  tentandoCatalogo?: boolean;
  onTentarCatalogo?: () => unknown;
  /** A folha de contagem da rua, para imprimir. */
  hrefDaFolha: string;
  /** A falta das leituras ao vivo: a faixa com a hora, ou o aviso da conexão. */
  leitura?: LeituraAoVivoNaTela;
  /** Lê de novo: "Tentar de novo" na demora e na falha da primeira leitura. */
  onTentar?: () => unknown;
  /** "Contar" e "Contar de novo": abre a caixa para contar. */
  onContar: (code: string) => void;
  acoes: AcoesDaContagem;
}) {
  const mensagem = estado === "pronto" ? null : MENSAGENS[estado];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link href={ROTA_DA_RODADA} className="text-sm font-bold text-primary-texto">
            Contagem por caixa
          </Link>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="font-mono text-3xl font-extrabold tracking-tight text-foreground">{posicao}</h1>
          {bancada && estado === "pronto" && !clienteFalhou ? <span className="text-sm font-bold text-muted-foreground">{resumoDaBancada(bancada)}</span> : null}
        </div>
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <Button asChild variant="outline">
            <Link href={hrefDaFolha}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir folha
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={ROTA_DA_RODADA}>Voltar à rodada</Link>
          </Button>
        </div>
      </header>

      {clienteFalhou ? (
        <FalhaDoClienteAtivo />
      ) : estado === "carregando" ? (
        <CarregandoNaRegiao rotulo={MENSAGENS.carregando} continuaARota onTentar={onTentar} className="rounded-lg border border-border bg-card px-5 py-6" />
      ) : estado === "erro" && onTentar ? (
        <FalhaNaLeitura leitura={{ error: erroDaLeituraAoVivo(leitura?.falta), refetch: async () => onTentar() }} mensagem={MENSAGENS.erro} />
      ) : mensagem || !bancada ? (
        <p role={estado === "erro" ? "alert" : undefined} className="rounded-lg border border-border bg-card px-5 py-6 text-sm font-semibold text-muted-foreground">
          {mensagem ?? MENSAGENS.nao_encontrada}
        </p>
      ) : (
        <>
          {leitura ? <FaixaAoVivo leitura={leitura} objeto="prateleira" /> : null}
          {leitura?.falta === "conexao" && leitura.lidaEm == null ? <BlocoSemConexao tentando={leitura.tentando} onTentar={() => leitura.tentar()} /> : null}
          <Progresso bancada={bancada} />
          {catalogoFalhou ? (
            <FalhaNaSecao
              mensagem={SEM_CATALOGO}
              tom="aviso"
              tentando={tentandoCatalogo}
              onTentar={onTentarCatalogo ?? (() => undefined)}
              className="rounded-lg border border-warning-soft-border bg-warning-soft px-4 py-3"
            />
          ) : null}
          <ul aria-label="Caixas" className="flex flex-col gap-3">
            {bancada.caixas.map((caixa) =>
              operador && caixa.code === emContagem && (caixa.estado === "por_contar" || caixa.estado === "confirmada") ? (
                <CaixaEmContagem
                  key={`${caixa.code}-em-contagem`}
                  caixa={caixa}
                  posicao={bancada.posicao}
                  digitado={digitado}
                  confirmar={confirmar}
                  produtos={produtos}
                  catalogoFalhou={catalogoFalhou}
                  acoes={acoes}
                />
              ) : (
                <CaixaFechada
                  key={caixa.code}
                  caixa={caixa}
                  posicao={bancada.posicao}
                  operador={operador}
                  bloqueada={Boolean(bancada.bloqueio) || (emContagem !== null && confirmar.estado === "andamento")}
                  onContar={onContar}
                />
              ),
            )}
          </ul>
          <Rodape bancada={bancada} />
        </>
      )}
    </div>
  );
}

/** "2 de 7 caixas confirmadas", a barra, o esperado, o contado e a diferença das confirmadas, e o que impede recontar. */
function Progresso({ bancada }: { bancada: BancadaDaPrateleira }) {
  const percentual = bancada.total ? Math.round((bancada.confirmadas / bancada.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:gap-4">
      <div className="flex items-center justify-between gap-3 md:contents">
        <p>
          <b className="font-bold text-foreground">{textoDoProgresso(bancada)}</b> confirmadas
        </p>
        {bancada.confirmadas ? (
          <p className="md:order-last">
            diferença{" "}
            <b className={cn("font-bold tabular-nums", bancada.diferencaConfirmadas ? corDaDiferenca(bancada.diferencaConfirmadas) : "text-foreground")}>
              {unidadesComSinal(bancada.diferencaConfirmadas)}
            </b>
          </p>
        ) : null}
      </div>
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted md:w-auto md:flex-1">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${percentual}%` }} />
      </div>
      {bancada.confirmadas ? (
        <p className="hidden gap-4 md:flex">
          <span>
            esperadas <b className="font-bold tabular-nums text-foreground">{numero.format(bancada.esperadasConfirmadas)}</b>
          </span>
          <span>
            contadas <b className="font-bold tabular-nums text-foreground">{numero.format(bancada.contadasConfirmadas)}</b>
          </span>
        </p>
      ) : null}
      {bancada.bloqueio ? (
        <Badge variant="outline" className="w-fit border-amber-soft-border bg-amber-soft text-sm font-bold text-amber-soft-foreground md:order-first">
          {bancada.bloqueio}
        </Badge>
      ) : null}
    </div>
  );
}

/** O selo da caixa confirmada: verde sem diferença, âmbar com ela. */
function SeloDaConfirmada({ caixa }: { caixa: CaixaDaBancada }) {
  if (!caixa.recontagem) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-sm font-bold",
        caixa.recontagem.diferenca === 0 ? "border-success-soft-border bg-success-soft text-success-soft-foreground" : "border-amber-soft-border bg-amber-soft text-amber-soft-foreground",
      )}
    >
      {seloDaRecontagem(caixa.recontagem)}
    </Badge>
  );
}

/**
 * A caixa numa linha: a por contar, com "Contar"; a confirmada, com o selo, o
 * que mudou e "Contar de novo"; a a caminho e a esvaziada, sem ação.
 */
function CaixaFechada({
  caixa,
  posicao,
  operador,
  bloqueada,
  onContar,
}: {
  caixa: CaixaDaBancada;
  posicao: string;
  operador: boolean;
  /** A prateleira com a guarda aberta, ou outra caixa gravando: a caixa espera. */
  bloqueada: boolean;
  onContar: (code: string) => void;
}) {
  const ids = idsDaCaixa(caixa.code);
  const separados = separadosDaCaixa(caixa);
  const mudou = caixa.recontagem ? itensComDiferenca({ ...caixa.recontagem, posicao }) : [];
  const podeContar = operador && (caixa.estado === "por_contar" || caixa.estado === "confirmada");
  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <h2 className="shrink-0">
          <Chip code={caixa.code} id={ids.titulo} />
        </h2>
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          <b className="mr-1.5 font-bold text-foreground max-sm:block">{tituloDaCaixa(caixa)}</b>
          {textoDaCaixaFechada(caixa)}
        </p>
        {caixa.estado === "a_caminho" ? (
          <Badge variant="outline" className="border-border bg-muted text-sm font-bold text-foreground">
            a caminho
          </Badge>
        ) : null}
        {separados.length ? (
          <Badge variant="outline" className="border-amber-soft-border bg-amber-soft text-sm font-bold text-amber-soft-foreground">
            {`em separação · ${separados.join(", ")}`}
          </Badge>
        ) : null}
        <SeloDaConfirmada caixa={caixa} />
        {podeContar && caixa.estado !== "vazia" ? (
          <Button
            id={ids.contar}
            type="button"
            variant="outline"
            className="max-md:min-h-11"
            aria-disabled={bloqueada || separados.length > 0 || undefined}
            aria-describedby={ids.titulo}
            onClick={() => {
              if (!bloqueada && !separados.length) onContar(caixa.code);
            }}
          >
            {caixa.estado === "confirmada" ? "Contar de novo" : "Contar"}
          </Button>
        ) : null}
      </div>
      {mudou.length ? (
        <ul className="flex flex-col gap-1 border-t border-border/60 px-4 py-2.5 text-sm">
          {mudou.map((item) => (
            <li key={item.sku} className="flex flex-wrap gap-x-2">
              <span className="font-semibold text-foreground">{item.nome}</span>
              <span className={cn("font-bold tabular-nums", corDaDiferenca(item.diferenca))}>{item.texto}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A caixa em contagem: o esperado, o contado e a diferença de cada item, o item fora da lista e as ações. */
function CaixaEmContagem({
  caixa,
  posicao,
  digitado,
  confirmar,
  produtos,
  catalogoFalhou,
  acoes,
}: {
  caixa: CaixaDaBancada;
  posicao: string;
  digitado: ContagemDigitada;
  confirmar: { estado: EstadoDaAcao; rotulo?: string };
  produtos: readonly ProdutoDoCatalogo[];
  catalogoFalhou: boolean;
  acoes: AcoesDaContagem;
}) {
  const ids = idsDaCaixa(caixa.code);
  const [buscando, setBuscando] = useState(false);
  const [termo, setTermo] = useState("");
  const raiz = useRef<HTMLLIElement>(null);
  const gravando = confirmar.estado === "andamento";
  const fora = useMemo(() => new Set([...caixa.itens.map((item) => item.sku), ...digitado.foraDaLista.map((item) => item.sku)]), [caixa.itens, digitado.foraDaLista]);
  const resultados = useMemo(() => buscarProdutos(produtos, termo, fora, RESULTADOS_A_VISTA), [produtos, termo, fora]);
  const completa = contagemCompleta(caixa, digitado);
  const vazia = completa && contagemVazia(caixa, digitado);
  const rotulo = confirmar.rotulo ?? (vazia ? "Confirmar caixa vazia" : "Confirmar caixa");
  const cheia = digitado.foraDaLista.length >= FORA_DA_LISTA_MAXIMO;

  // A caixa que abre para contar leva o foco ao primeiro campo (ou, sem item na lista, ao "Item fora da lista").
  useEffect(() => {
    const primeiro = raiz.current?.querySelector<HTMLElement>("input, [data-fora-da-lista]");
    primeiro?.focus();
  }, []);

  const linhas = [
    ...caixa.itens.map((item) => ({ ...item, foraDaLista: false, valor: digitado.contados[item.sku] ?? "" })),
    ...digitado.foraDaLista.map((item) => ({ ...item, esperado: 0, entrou: 0, saiu: 0, reservado: 0, pedidos: [] as string[], separados: [] as string[], foraDaLista: true, valor: item.contado })),
  ];

  return (
    <li ref={raiz} className="overflow-hidden rounded-xl border border-foreground bg-card ring-1 ring-foreground">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <h2 className="shrink-0">
          <Chip code={caixa.code} id={ids.titulo} />
        </h2>
        {caixa.guardadaEm ? <span className="text-sm font-semibold text-muted-foreground">guardada {dataCurta(caixa.guardadaEm)}</span> : null}
        <Badge variant="outline" className="ml-auto border-violet-soft-border bg-violet-soft text-sm font-bold text-violet-soft-foreground">
          em contagem
        </Badge>
      </div>
      {linhas.length ? (
        <div className="hidden grid-cols-[minmax(0,1fr)_150px_120px_110px] gap-4 border-b border-border/60 px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-muted-foreground md:grid">
          <span>Produto</span>
          <span className="text-right">Esperado</span>
          <span className="text-right">Contado</span>
          <span className="text-right">Diferença</span>
        </div>
      ) : null}
      <ul>
        {linhas.map((linha, indice) => {
          const campo = `contado-${caixa.code}-${indice}`;
          const problema = problemaDaQuantidade(linha.valor, linha.foraDaLista);
          const diferenca = diferencaDigitada(linha.esperado, linha.valor);
          const reserva = textoDaReserva([linha]);
          const rotuloDoCampo = `Contado, ${linha.nome}${linha.foraDaLista ? ", fora da lista" : ""}, ${caixa.code}`;
          return (
            <li key={`${linha.foraDaLista ? "fora" : "lista"}-${linha.sku}`} className="flex flex-col gap-2 border-t border-border/60 px-4 py-2.5 first:border-t-0 md:grid md:grid-cols-[minmax(0,1fr)_150px_120px_110px] md:items-center md:gap-4">
              <div className="min-w-0">
                <p className="font-bold leading-snug text-foreground md:truncate">{linha.nome}</p>
                <p className="text-sm text-muted-foreground">
                  {[linha.codigo, linha.sku].filter(Boolean).join(" · ")}
                  {linha.foraDaLista ? <b className="font-bold text-amber-soft-foreground"> · fora da lista</b> : null}
                </p>
                {linha.foraDaLista ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 text-sm max-md:min-h-11"
                    aria-label={`Remover ${linha.nome} da caixa ${caixa.code}`}
                    disabled={gravando}
                    onClick={() => acoes.onRemoverForaDaLista(linha.sku)}
                  >
                    Remover
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-3 md:contents">
                <div className="flex-1 md:text-right">
                  <p className="text-xl font-extrabold tabular-nums text-foreground md:text-base">{numero.format(linha.esperado)}</p>
                  {linha.foraDaLista ? (
                    <p className="text-sm text-muted-foreground md:sr-only">esperadas</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <span className="md:sr-only">esperadas · </span>
                      {textoDaConta(linha)}
                    </p>
                  )}
                  {reserva ? <p className="text-sm font-bold text-amber-soft-foreground">{reserva}</p> : null}
                </div>
                <div className="md:text-right">
                  <Input
                    id={campo}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    aria-label={rotuloDoCampo}
                    aria-invalid={problema ? true : undefined}
                    aria-describedby={problema ? `${campo}-problema` : undefined}
                    readOnly={gravando}
                    value={linha.valor}
                    onChange={(evento) => (linha.foraDaLista ? acoes.onDigitarForaDaLista(linha.sku, evento.target.value) : acoes.onDigitar(linha.sku, evento.target.value))}
                    className="h-12 w-28 text-right text-xl font-extrabold tabular-nums md:ml-auto md:h-10 md:w-24 md:text-base"
                  />
                  {problema ? (
                    <p id={`${campo}-problema`} className="pt-1 text-sm font-semibold text-destructive-soft-foreground">
                      {problema}
                    </p>
                  ) : null}
                </div>
                <p className={cn("min-w-14 text-right text-lg font-extrabold tabular-nums md:text-base", corDaDiferenca(diferenca))}>
                  <span className="sr-only">Diferença </span>
                  {diferenca === null ? "—" : textoDaDiferenca(diferenca)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {buscando ? (
        <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
          <Label htmlFor={`busca-${caixa.code}`}>Item fora da lista</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`busca-${caixa.code}`}
              type="search"
              autoComplete="off"
              autoFocus
              value={termo}
              onChange={(evento) => setTermo(evento.target.value)}
              className="max-md:h-12"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0 max-md:size-12"
              aria-label="Fechar a busca"
              onClick={() => {
                setBuscando(false);
                setTermo("");
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {catalogoFalhou ? (
            <p className="text-sm font-semibold text-carregando-aviso">{SEM_CATALOGO}</p>
          ) : resultados.length ? (
            <ul aria-label="Produtos do cliente" className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
              {resultados.map((produto) => (
                <li key={produto.sku}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco max-md:min-h-12"
                    onClick={() => {
                      acoes.onAcrescentar(produto);
                      setBuscando(false);
                      setTermo("");
                    }}
                  >
                    <span className="text-sm font-bold text-foreground">{produto.nome}</span>
                    <span className="text-xs text-muted-foreground">{[produto.codigo, produto.sku].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : termo.trim() ? (
            <p className="text-sm text-muted-foreground">{`Nenhum produto do cliente com “${termo.trim()}”.`}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 md:flex-row md:items-center">
        <BotaoDeAcao
          id={`confirmar-${caixa.code}`}
          estado={confirmar.estado}
          rotulo={rotulo}
          andamento="Confirmando…"
          bloqueado={!completa && confirmar.estado === "repouso"}
          className="w-full max-md:min-h-12 md:order-last md:ml-auto md:w-auto"
          onClick={acoes.onConfirmar}
        />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className="flex-1 max-md:min-h-12 md:flex-none" disabled={gravando} onClick={acoes.onCaixaVazia}>
            Caixa vazia
          </Button>
          {!buscando && !cheia ? (
            <Button type="button" variant="link" data-fora-da-lista="" className="flex-1 max-md:min-h-12 md:flex-none" disabled={gravando} onClick={() => setBuscando(true)}>
              Item fora da lista
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** A prateleira no rodapé: o saldo do razão, a soma das caixas e a reserva; a diferença quando não fecham. */
function Rodape({ bancada }: { bancada: BancadaDaPrateleira }) {
  const diferenca = bancada.nasCaixas - bancada.saldo;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground lg:sticky lg:bottom-0">
      <b className="font-mono text-base font-extrabold text-foreground">{bancada.posicao}</b>
      <span>{textoDaPrateleiraNaBancada(bancada)}</span>
      {diferenca ? <span className={cn("ml-auto font-extrabold tabular-nums", corDaDiferenca(diferenca))}>{textoDaDiferenca(diferenca)}</span> : null}
    </div>
  );
}
