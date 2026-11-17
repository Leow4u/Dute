import { areaDePassagem, nomeComTamanho, nomeSemTamanho, ordemDoTamanho, saldoDaCaixa, tamanhoDoCodigo } from "@workspace/dominio";

import { boxBalanceUnits, type WarehouseBox } from "@/lib/warehouse-boxes";
import { sortPositions, type WarehousePosition } from "@/lib/warehouse-positions";

import { entradaDasCaixas, type LinhaDeEntrada } from "./caixas-da-separacao";
import { impressaEmTexto } from "./lista-de-separacao";

/**
 * A contagem por caixa, só leitura (docs/plataforma/diagnostico-contagem-
 * ciclica.md, seção 6, item 1; docs/mockups/WmsContagemFolha.dc.html e o
 * cartão "Caixas × saldo" de WmsContagemRodada.dc.html): o que o sistema
 * espera em cada caixa de cada prateleira do cliente ativo, e a regra de ouro
 * do mapa, por prateleira: a soma do esperado das caixas contra o saldo do
 * razão. A conta do esperado é a do domínio (saldo-da-caixa.ts): a entrada
 * menos o que as separações tiraram mais o que as recontagens acertaram.
 * Funções puras, sem Firestore.
 */

const numero = new Intl.NumberFormat("pt-BR");

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function chave(valor: unknown): string {
  return texto(valor).toUpperCase();
}

function quantidade(valor: unknown): number {
  const parsed = Number(valor ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plural(quantos: number, singular: string, varios: string): string {
  return `${numero.format(quantos)} ${quantos === 1 ? singular : varios}`;
}

/** O saldo de um SKU numa prateleira, como `/api/stock-balances` o devolve. */
export type SaldoLido = {
  location_id?: unknown;
  sku_code?: unknown;
  qty_on_hand?: unknown;
  qty_reserved?: unknown;
  customer_code?: unknown;
  client_item_code?: unknown;
  product_name?: unknown;
  size?: unknown;
};

/** O que a prateleira precisa do cadastro de Posições. */
export type PosicaoDaContagem = Pick<WarehousePosition, "code" | "aisle" | "shelf" | "sequence" | "customer_code">;

/** O nome de um produto: o do catálogo (`/api/skus`), o da linha da caixa ou o do saldo. */
export type NomeDoSku = { nome: string; codigo: string; tamanho: string | null };

/** Os nomes do catálogo por SKU, das linhas de `/api/skus`. */
export function catalogoDaContagem(rows: ReadonlyArray<Record<string, unknown>>): Map<string, NomeDoSku> {
  const catalogo = new Map<string, NomeDoSku>();
  for (const row of rows) {
    const sku = chave(row.cod_btg) || chave(row.sku_code) || chave(row.id);
    if (!sku) continue;
    catalogo.set(sku, {
      nome: texto(row.produto) || texto(row.product_name) || texto(row.nome),
      codigo: texto(row.cod_cliente) || texto(row.client_item_code),
      tamanho: texto(row.tamanho) || texto(row.size) || null,
    });
  }
  return catalogo;
}

/** Uma linha da folha: um produto de uma caixa, ou o saldo do razão sem caixa que o tenha. */
export type LinhaDaFolha = {
  sku: string;
  /** O código do cliente; "" quando ninguém o conhece. */
  codigo: string;
  /** "Polo Masculino Piquet Preto · G"; sem nome, o SKU. */
  nome: string;
  /**
   * O que entrou na caixa: a entrada e o que as recontagens acharam a mais;
   * null na linha do saldo sem caixa.
   */
  entrou: number | null;
  /**
   * O que saiu da caixa: o que as separações tiraram e o que as recontagens
   * acharam a menos; null na linha do saldo sem caixa.
   */
  saiu: number | null;
  /** A entrada menos o retirado mais os ajustes (saldo-da-caixa.ts); na linha sem caixa, o saldo do razão. */
  esperado: number;
  /** A reserva do saldo da prateleira para o SKU. */
  reserva: number;
};

export type CaixaDaFolha = {
  code: string;
  /** A caixa com o destino confirmado que ainda não chegou à prateleira (`committing`): fora das somas. */
  aCaminho: boolean;
  /** Uma linha por produto do conteúdo de entrada; vazia na caixa sem conteúdo registrado. */
  linhas: LinhaDaFolha[];
  /** A soma do esperado; na caixa sem conteúdo registrado, o que ela diz ter. */
  esperado: number;
};

export type PrateleiraDaContagem = {
  posicao: string;
  /** A rua ("A"); "" no local que não segue o padrão "A-01". */
  rua: string;
  /** O local está no cadastro de Posições. */
  cadastrada: boolean;
  /** As caixas guardadas, por código, e depois as a caminho. */
  caixas: CaixaDaFolha[];
  /** O saldo do razão de SKU que nenhuma caixa guardada tem: uma linha por SKU. */
  semCaixa: LinhaDaFolha[];
  guardadas: number;
  aCaminho: number;
  /** Os produtos (SKUs) das caixas guardadas. */
  itens: number;
  /** A soma do esperado das caixas guardadas. */
  unidades: number;
  /** A soma do `qty_on_hand` do razão na prateleira. */
  saldo: number;
  /** caixas menos saldo. */
  diferenca: number;
  /** Os SKUs em que a soma das caixas e o saldo do razão não fecham. */
  itensDiferentes: number;
};

type SaldoDoSku = { onHand: number; reservado: number };

type Nomeado = { product_name?: unknown; client_item_code?: unknown; size?: unknown };

function nomeDe(sku: string, preferido: Nomeado | undefined, catalogo: ReadonlyMap<string, NomeDoSku>): Pick<LinhaDaFolha, "codigo" | "nome"> & { tamanho: string | null } {
  const doCatalogo = catalogo.get(sku);
  const nome = texto(preferido?.product_name) || doCatalogo?.nome || "";
  const codigo = texto(preferido?.client_item_code) || doCatalogo?.codigo || "";
  const tamanho = texto(preferido?.size) || doCatalogo?.tamanho || null;
  return { codigo, nome: nomeComTamanho({ nome, codigo, tamanho }) || sku, tamanho };
}

/** A ordem das linhas numa caixa: a família do produto, o tamanho e o código. */
function ordenarLinhas(linhas: Array<LinhaDaFolha & { familia: string; tamanho: number }>): LinhaDaFolha[] {
  return linhas
    .sort(
      (esquerda, direita) =>
        esquerda.familia.localeCompare(direita.familia, "pt-BR", { numeric: true }) ||
        esquerda.tamanho - direita.tamanho ||
        esquerda.codigo.localeCompare(direita.codigo, "pt-BR", { numeric: true }) ||
        esquerda.sku.localeCompare(direita.sku, "pt-BR", { numeric: true }),
    )
    .map(({ familia: _familia, tamanho: _tamanho, ...linha }) => linha);
}

function porCodigo(esquerda: { code: string }, direita: { code: string }): number {
  return esquerda.code.localeCompare(direita.code, "pt-BR", { numeric: true });
}

/** "A" de "A-01" (a rua tem uma ou duas letras, como o positionCode); "" no local fora do padrão (DEVOLUCAO, LOC-1). */
export function ruaDoCodigo(posicao: string): string {
  return /^([A-Z]{1,2})-\d+$/.exec(chave(posicao))?.[1] ?? "";
}

export type DadosDaContagem = {
  cliente: string | null | undefined;
  posicoes: readonly PosicaoDaContagem[];
  caixas: readonly WarehouseBox[];
  /** As linhas da abertura do cliente (o conteúdo de entrada das caixas da abertura). */
  abertura: readonly LinhaDeEntrada[];
  saldos: readonly SaldoLido[];
  catalogo?: ReadonlyMap<string, NomeDoSku>;
};

/**
 * As prateleiras do cliente, na ordem de caminhada: as da zona dele no
 * cadastro, mais as que têm caixa ou saldo dele fora da zona; as fora do
 * cadastro vêm depois, em ordem. As áreas de passagem (RECEBIMENTO,
 * EXPEDICAO) ficam de fora: não são prateleira.
 */
export function prateleirasDaContagem(dados: DadosDaContagem): PrateleiraDaContagem[] {
  const dono = chave(dados.cliente);
  if (!dono) return [];
  const catalogo = dados.catalogo ?? new Map<string, NomeDoSku>();

  const caixasDoCliente = dados.caixas.filter(
    (caixa) => chave(caixa.customer_code) === dono && (caixa.status === "stored" || caixa.status === "committing") && chave(caixa.location_id),
  );
  const caixasPorLocal = new Map<string, WarehouseBox[]>();
  for (const caixa of caixasDoCliente) {
    const local = chave(caixa.location_id);
    caixasPorLocal.set(local, [...(caixasPorLocal.get(local) ?? []), caixa]);
  }
  const entrada = entradaDasCaixas(caixasDoCliente, dados.abertura);

  // O nome que a etiqueta da caixa leva: o da linha da própria caixa (o recebimento) ou o da linha da abertura.
  const nomesDasCaixas = new Map<string, Map<string, Nomeado>>();
  for (const caixa of caixasDoCliente) {
    const nomes = new Map<string, Nomeado>();
    for (const linha of caixa.lines) {
      const sku = chave(linha.sku_code);
      if (sku && !nomes.has(sku)) nomes.set(sku, linha);
    }
    nomesDasCaixas.set(caixa.code, nomes);
  }
  for (const linha of dados.abertura) {
    const nomes = nomesDasCaixas.get(linha.box_code);
    if (nomes && !nomes.has(linha.sku_code) && (linha.product_name || linha.client_item_code)) nomes.set(linha.sku_code, linha);
  }
  // O item que só a recontagem pôs na caixa: o nome que o ajuste gravou.
  for (const caixa of caixasDoCliente) {
    const nomes = nomesDasCaixas.get(caixa.code);
    for (const ajuste of caixa.count_adjustments ?? []) {
      const sku = chave(ajuste.sku_code);
      if (nomes && sku && !nomes.has(sku) && (ajuste.product_name || ajuste.client_item_code)) nomes.set(sku, ajuste);
    }
  }

  const saldosPorLocal = new Map<string, Map<string, SaldoDoSku & Nomeado>>();
  for (const saldo of dados.saldos) {
    const doCliente = chave(saldo.customer_code);
    if (doCliente && doCliente !== dono) continue;
    const local = chave(saldo.location_id);
    const sku = chave(saldo.sku_code);
    if (!local || !sku || areaDePassagem(local)) continue;
    const onHand = quantidade(saldo.qty_on_hand);
    const reservado = quantidade(saldo.qty_reserved);
    if (onHand <= 0 && reservado <= 0) continue;
    const skus = saldosPorLocal.get(local) ?? new Map<string, SaldoDoSku & Nomeado>();
    const atual = skus.get(sku);
    skus.set(sku, {
      onHand: (atual?.onHand ?? 0) + onHand,
      reservado: (atual?.reservado ?? 0) + reservado,
      product_name: atual?.product_name ?? saldo.product_name,
      client_item_code: atual?.client_item_code ?? saldo.client_item_code,
      size: atual?.size ?? saldo.size,
    });
    saldosPorLocal.set(local, skus);
  }

  const cadastradas = new Map<string, PosicaoDaContagem>();
  for (const posicao of sortPositions([...dados.posicoes])) {
    const code = chave(posicao.code);
    if (code && !cadastradas.has(code)) cadastradas.set(code, posicao);
  }
  const locais: string[] = [];
  for (const [code, posicao] of cadastradas) {
    if (chave(posicao.customer_code) === dono || caixasPorLocal.has(code) || saldosPorLocal.has(code)) locais.push(code);
  }
  const foraDoCadastro = [...new Set([...caixasPorLocal.keys(), ...saldosPorLocal.keys()])]
    .filter((local) => !cadastradas.has(local) && !areaDePassagem(local))
    .sort((esquerda, direita) => esquerda.localeCompare(direita, "pt-BR", { numeric: true }));

  return [...locais, ...foraDoCadastro].map((local) => {
    const posicao = cadastradas.get(local);
    const saldos = saldosPorLocal.get(local) ?? new Map<string, SaldoDoSku & Nomeado>();
    const todas = caixasPorLocal.get(local) ?? [];
    const guardadas = todas.filter((caixa) => caixa.status === "stored").sort(porCodigo);
    const aCaminho = todas.filter((caixa) => caixa.status === "committing").sort(porCodigo);
    const nasCaixas = new Map<string, number>();

    const caixaDaFolha = (caixa: WarehouseBox): CaixaDaFolha => {
      const daEntrada = entrada.get(caixa.code) ?? new Map<string, number>();
      const retirado = (caixa.taken_lines ?? []).map((linha) => ({ sku_code: chave(linha.sku_code), qty: linha.qty }));
      const ajustes = (caixa.count_adjustments ?? []).map((linha) => ({ sku_code: chave(linha.sku_code), qty: linha.qty }));
      // O que entrou soma o que a recontagem achou a mais; o que saiu, o que ela achou a menos: entrou − saiu = esperado.
      const entrou = new Map(daEntrada);
      const saiu = new Map<string, number>();
      for (const linha of retirado) saiu.set(linha.sku_code, (saiu.get(linha.sku_code) ?? 0) + linha.qty);
      for (const linha of ajustes) {
        if (linha.qty > 0) entrou.set(linha.sku_code, (entrou.get(linha.sku_code) ?? 0) + linha.qty);
        else if (linha.qty < 0) saiu.set(linha.sku_code, (saiu.get(linha.sku_code) ?? 0) - linha.qty);
      }
      // A conta do domínio: a entrada menos o retirado mais os ajustes, nunca negativo (saldo-da-caixa.ts).
      const esperado = new Map(
        saldoDaCaixa([...daEntrada].map(([sku_code, qty]) => ({ sku_code, qty })), retirado, ajustes).map((linha) => [linha.sku_code, linha.qty]),
      );
      const nomes = nomesDasCaixas.get(caixa.code);
      const linhas = ordenarLinhas(
        [...entrou].map(([sku, quantos]) => {
          const { codigo, nome, tamanho } = nomeDe(sku, nomes?.get(sku) ?? saldos.get(sku), catalogo);
          return {
            sku,
            codigo,
            nome,
            entrou: quantos,
            saiu: saiu.get(sku) ?? 0,
            esperado: esperado.get(sku) ?? 0,
            reserva: saldos.get(sku)?.reservado ?? 0,
            familia: nomeSemTamanho({ nome, codigo, tamanho }),
            tamanho: ordemDoTamanho(tamanho || tamanhoDoCodigo(codigo) || ""),
          };
        }),
      );
      return {
        code: caixa.code,
        aCaminho: caixa.status === "committing",
        linhas,
        // Sem o conteúdo registrado, vale o que a caixa diz ter, como na etiqueta.
        esperado: linhas.length ? linhas.reduce((soma, linha) => soma + linha.esperado, 0) : boxBalanceUnits(caixa),
      };
    };

    const caixas = [...guardadas.map(caixaDaFolha), ...aCaminho.map(caixaDaFolha)];
    for (const caixa of caixas) {
      if (caixa.aCaminho) continue;
      for (const linha of caixa.linhas) nasCaixas.set(linha.sku, (nasCaixas.get(linha.sku) ?? 0) + linha.esperado);
    }
    const semCaixa = ordenarLinhas(
      [...saldos]
        .filter(([sku, saldo]) => !nasCaixas.has(sku) && saldo.onHand > 0)
        .map(([sku, saldo]) => {
          const { codigo, nome, tamanho } = nomeDe(sku, saldo, catalogo);
          return {
            sku,
            codigo,
            nome,
            entrou: null,
            saiu: null,
            esperado: saldo.onHand,
            reserva: saldo.reservado,
            familia: nomeSemTamanho({ nome, codigo, tamanho }),
            tamanho: ordemDoTamanho(tamanho || tamanhoDoCodigo(codigo) || ""),
          };
        }),
    );

    const unidades = caixas.filter((caixa) => !caixa.aCaminho).reduce((soma, caixa) => soma + caixa.esperado, 0);
    const saldo = [...saldos.values()].reduce((soma, item) => soma + item.onHand, 0);
    let itensDiferentes = 0;
    for (const sku of new Set([...nasCaixas.keys(), ...saldos.keys()])) {
      if ((nasCaixas.get(sku) ?? 0) !== (saldos.get(sku)?.onHand ?? 0)) itensDiferentes += 1;
    }
    return {
      posicao: local,
      rua: posicao ? chave(posicao.aisle) : ruaDoCodigo(local),
      cadastrada: Boolean(posicao),
      caixas,
      semCaixa,
      guardadas: guardadas.length,
      aCaminho: aCaminho.length,
      itens: nasCaixas.size,
      unidades,
      saldo,
      diferenca: unidades - saldo,
      itensDiferentes,
    };
  });
}

/** A prateleira em que as caixas e o razão não fecham: no total, ou em algum SKU. */
export function prateleiraDifere(prateleira: Pick<PrateleiraDaContagem, "diferenca" | "itensDiferentes">): boolean {
  return prateleira.diferenca !== 0 || prateleira.itensDiferentes > 0;
}

/** "3 caixas · 2 itens · 11 un.", com "· 1 a caminho" quando há; "sem caixa" na prateleira sem caixa guardada. */
export function resumoDaPrateleira(prateleira: Pick<PrateleiraDaContagem, "guardadas" | "aCaminho" | "itens" | "unidades">): string {
  const aCaminho = prateleira.aCaminho ? ` · ${numero.format(prateleira.aCaminho)} a caminho` : "";
  if (!prateleira.guardadas) return `sem caixa${aCaminho}`;
  return `${plural(prateleira.guardadas, "caixa", "caixas")} · ${plural(prateleira.itens, "item", "itens")} · ${numero.format(prateleira.unidades)} un.${aCaminho}`;
}

/** "caixas 142 · saldo 139": a regra de ouro da prateleira. */
export function textoCaixasSaldo(prateleira: Pick<PrateleiraDaContagem, "unidades" | "saldo">): string {
  return `caixas ${numero.format(prateleira.unidades)} · saldo ${numero.format(prateleira.saldo)}`;
}

/** "+12", "−5" (o sinal de menos tipográfico) ou "0". */
export function textoDaDiferenca(diferenca: number): string {
  if (diferenca > 0) return `+${numero.format(diferenca)}`;
  if (diferenca < 0) return `−${numero.format(-diferenca)}`;
  return "0";
}

/** "2 itens diferem" na prateleira cujos SKUs não fecham; "" quando fecham. */
export function textoDosItensDiferentes(prateleira: Pick<PrateleiraDaContagem, "itensDiferentes">): string {
  if (!prateleira.itensDiferentes) return "";
  return prateleira.itensDiferentes === 1 ? "1 item difere" : `${numero.format(prateleira.itensDiferentes)} itens diferem`;
}

/** As ruas das prateleiras, na ordem de caminhada; a prateleira fora do padrão não tem rua. */
export function ruasDaContagem(prateleiras: readonly PrateleiraDaContagem[]): string[] {
  return [...new Set(prateleiras.map((prateleira) => prateleira.rua).filter(Boolean))];
}

export function prateleirasDaRua(prateleiras: readonly PrateleiraDaContagem[], rua: string): PrateleiraDaContagem[] {
  const alvo = chave(rua);
  return prateleiras.filter((prateleira) => prateleira.rua === alvo);
}

/** "A-01 a A-15 · 68 caixas"; com uma prateleira só, "A-01 · 3 caixas". */
export function textoDasPrateleiras(prateleiras: readonly PrateleiraDaContagem[]): string {
  if (!prateleiras.length) return "—";
  const primeira = prateleiras[0].posicao;
  const ultima = prateleiras[prateleiras.length - 1].posicao;
  const caixas = prateleiras.reduce((soma, prateleira) => soma + prateleira.guardadas, 0);
  return `${primeira === ultima ? primeira : `${primeira} a ${ultima}`} · ${plural(caixas, "caixa", "caixas")}`;
}

const DATA_EM_SAO_PAULO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/** "Recontagem · 17/11/2026": a rodada, enquanto ela não existe no sistema. */
export function rodadaEmTexto(agora: Date): string {
  return `Recontagem · ${DATA_EM_SAO_PAULO.format(agora)}`;
}

/** A folha impressa de uma rua (docs/mockups/WmsContagemFolha.dc.html). Os textos chegam prontos: o papel só os mostra. */
export type FolhaDeContagem = {
  rua: string;
  /** "Rua A" */
  titulo: string;
  cliente: string;
  rodada: string;
  /** "A-01 a A-15 · 68 caixas" */
  prateleiras: string;
  /** "17/11/2026 07:55" */
  impressaEm: string;
  por: string;
  grupos: PrateleiraDaContagem[];
};

export function folhaDeContagem(dados: { rua: string; prateleiras: readonly PrateleiraDaContagem[]; cliente?: string | null; por?: string | null; agora: Date }): FolhaDeContagem {
  const rua = chave(dados.rua);
  const grupos = prateleirasDaRua(dados.prateleiras, rua);
  return {
    rua,
    titulo: `Rua ${rua}`,
    cliente: texto(dados.cliente),
    rodada: rodadaEmTexto(dados.agora),
    prateleiras: textoDasPrateleiras(grupos),
    impressaEm: impressaEmTexto(dados.agora),
    por: texto(dados.por),
    grupos,
  };
}

/** O relatório "Caixas × saldo": as prateleiras que diferem primeiro, pela diferença, depois as iguais, na ordem de caminhada. */
export type RelatorioCaixasSaldo = { iguais: number; diferentes: number; linhas: PrateleiraDaContagem[] };

export function relatorioCaixasSaldo(prateleiras: readonly PrateleiraDaContagem[]): RelatorioCaixasSaldo {
  const ordem = new Map(prateleiras.map((prateleira, indice) => [prateleira.posicao, indice]));
  const diferentes = prateleiras.filter(prateleiraDifere);
  const iguais = prateleiras.filter((prateleira) => !prateleiraDifere(prateleira));
  return {
    iguais: iguais.length,
    diferentes: diferentes.length,
    linhas: [
      ...diferentes.sort(
        (esquerda, direita) =>
          Math.abs(direita.diferenca) - Math.abs(esquerda.diferenca) ||
          direita.itensDiferentes - esquerda.itensDiferentes ||
          (ordem.get(esquerda.posicao) ?? 0) - (ordem.get(direita.posicao) ?? 0),
      ),
      ...iguais,
    ],
  };
}

/** "37 prateleiras iguais · 6 diferentes" */
export function resumoDoRelatorio(relatorio: Pick<RelatorioCaixasSaldo, "iguais" | "diferentes">): string {
  const iguais = relatorio.iguais === 1 ? "1 prateleira igual" : `${numero.format(relatorio.iguais)} prateleiras iguais`;
  const diferentes = relatorio.diferentes === 1 ? "1 diferente" : `${numero.format(relatorio.diferentes)} diferentes`;
  return `${iguais} · ${diferentes}`;
}

/** Uma contagem gravada hoje (`cycle_counts`), como o relatório a lista. */
export type ContagemDoDia = {
  id: string;
  /** O `customer_code` da contagem: a fronteira do cliente. */
  cliente: string;
  posicao: string;
  sku: string;
  codigo: string;
  nome: string;
  caixa: string | null;
  antes: number;
  contado: number;
  diferenca: number;
  quem: string;
  /** O instante ISO da contagem. */
  quando: string;
};

/** A contagem como o servidor a grava (recordCycleCountTransaction); sem prateleira ou sem SKU não serve. */
export function contagemLida(id: string, data: Record<string, unknown>, catalogo: ReadonlyMap<string, NomeDoSku> = new Map()): ContagemDoDia | null {
  const posicao = chave(data.location_id);
  const sku = chave(data.sku_code);
  if (!posicao || !sku) return null;
  const { codigo, nome } = nomeDe(sku, data, catalogo);
  const antes = quantidade(data.qty_before);
  const contado = quantidade(data.counted_qty);
  const actor = data.actor && typeof data.actor === "object" ? (data.actor as Record<string, unknown>) : {};
  const quando = texto(data.occurred_at) || (data.created_at && typeof data.created_at === "object" && "toDate" in data.created_at ? (data.created_at as { toDate: () => Date }).toDate().toISOString() : "");
  return {
    id,
    cliente: chave(data.customer_code),
    posicao,
    sku,
    codigo,
    nome,
    caixa: chave(data.box_code) || null,
    antes,
    contado,
    diferenca: data.adjustment_delta == null ? contado - antes : quantidade(data.adjustment_delta),
    quem: texto(actor.name) || texto(actor.email) || "—",
    quando,
  };
}

/** As contagens do cliente, a mais recente primeiro: a leitura do dia é de todos os clientes, e a tela mostra só o ativo. */
export function contagensDoCliente(contagens: readonly ContagemDoDia[], cliente: string | null | undefined): ContagemDoDia[] {
  const dono = chave(cliente);
  return contagens
    .filter((contagem) => Boolean(dono) && contagem.cliente === dono)
    .sort((esquerda, direita) => direita.quando.localeCompare(esquerda.quando) || esquerda.id.localeCompare(direita.id));
}

const PARTES_EM_SAO_PAULO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partesEmSaoPaulo(instante: Date): Record<string, string> {
  return Object.fromEntries(PARTES_EM_SAO_PAULO.formatToParts(instante).map((parte) => [parte.type, parte.value]));
}

/** O começo do dia de hoje em São Paulo (UTC−3, sem horário de verão), como instante ISO: o `occurred_at` do servidor é ISO. */
export function inicioDoDiaEmSaoPaulo(agora: Date): string {
  const partes = partesEmSaoPaulo(agora);
  return new Date(`${partes.year}-${partes.month}-${partes.day}T00:00:00-03:00`).toISOString();
}

/** "08:41", no horário de São Paulo; "—" sem instante válido. */
export function horaEmTexto(instante: string): string {
  const data = new Date(instante);
  if (!instante || Number.isNaN(data.getTime())) return "—";
  const partes = partesEmSaoPaulo(data);
  return `${partes.hour}:${partes.minute}`;
}

export const ROTA_DA_FOLHA_DE_CONTAGEM = "/estoque/contagem/folha";
export const ROTA_DO_RELATORIO_CAIXAS_SALDO = "/estoque/contagem/caixas";

/** O endereço da folha de uma rua: a rua vai na busca; sem ela, a tela abre a primeira. */
export function hrefDaFolha(rua?: string | null): string {
  const alvo = chave(rua);
  return alvo ? `${ROTA_DA_FOLHA_DE_CONTAGEM}?rua=${encodeURIComponent(alvo)}` : ROTA_DA_FOLHA_DE_CONTAGEM;
}

/** A rua da busca (`?rua=a`), em maiúsculas; sem ela, null. */
export function ruaDaBusca(busca: string): string | null {
  return chave(new URLSearchParams(busca).get("rua")) || null;
}
