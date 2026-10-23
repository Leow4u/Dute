import { z } from "zod";

import type { EscopoDoAgente } from "./agente-escopo.js";
import { bate, diasDesde, ferramenta, instante, normalizado, numero, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import type { LeitorDoAgente, RegistroLido } from "./agente-leitor.js";
import { diaEmSaoPaulo, idadeDoItem, RELOGIO_VAZIO, regraDoModelo, rotuloDaEtiqueta, type RelogioDoItem } from "./parados.js";

/**
 * As ferramentas da Armazenagem no Agent Dute do núcleo (parte 5.5c), as do
 * agente do WMS (functions/wms/src/domain/agent-dute.ts e agent-team.ts)
 * pelo leitor, mais os itens parados da memória (parte 5.4). As leituras
 * usam as mesmas projeções do portal, para o agente não contradizer a tela.
 * A prévia do faturamento fica de fora até a Fase 7 (pergunta 33).
 *
 * Diferenças do WMS: o razão é consultado já pelo cliente, e a ferramenta
 * não alcança o banco.
 */

const COORDENACAO = ["owner", "admin", "interno", "suporte"];

const todos = () => true;
const daEquipe = (escopo: EscopoDoAgente) => escopo.audiencia === "equipe";
const daCoordenacao = (escopo: EscopoDoAgente) => COORDENACAO.includes(escopo.role);

// --- Estoque --------------------------------------------------------------------------------

function itemLido(item: RegistroLido) {
  const emEstoque = numero(item.qty_on_hand);
  const reservado = numero(item.qty_reserved);
  const disponivel = item.qty_available !== undefined ? numero(item.qty_available) : emEstoque - reservado;
  const minimo = item.estoque_minimo !== undefined && item.estoque_minimo !== null ? numero(item.estoque_minimo) : null;
  return {
    codigo: texto(item.client_item_code) || texto(item.sku_code),
    nome: texto(item.product_name) || texto(item.sku_code),
    categoria: texto(item.category) || undefined,
    tamanho: texto(item.size) || undefined,
    cor: texto(item.color) || undefined,
    em_estoque: emEstoque,
    reservado,
    disponivel,
    minimo,
    abaixo_do_minimo: minimo !== null && minimo > 0 && disponivel < minimo,
    arquivado: item.client_archived === true,
  };
}

async function estoque(leitor: LeitorDoAgente) {
  return (await leitor.doCliente("client_inventory", { limite: 5000 })).map(itemLido);
}

export async function resumoDoEstoque(leitor: LeitorDoAgente) {
  const itens = (await estoque(leitor)).filter((item) => !item.arquivado);
  const abaixo = itens.filter((item) => item.abaixo_do_minimo);
  return {
    itens: itens.length,
    itens_com_saldo: itens.filter((item) => item.em_estoque > 0).length,
    itens_zerados: itens.filter((item) => item.em_estoque <= 0).length,
    pecas_em_estoque: itens.reduce((soma, item) => soma + item.em_estoque, 0),
    pecas_reservadas: itens.reduce((soma, item) => soma + item.reservado, 0),
    pecas_disponiveis: itens.reduce((soma, item) => soma + Math.max(0, item.disponivel), 0),
    abaixo_do_minimo: abaixo.length,
    itens_abaixo_do_minimo: abaixo.slice(0, 30),
  };
}

export async function buscarItens(leitor: LeitorDoAgente, busca: string, limite = 25) {
  const achados = (await estoque(leitor)).filter((item) => bate(busca, item.codigo, item.nome, item.categoria, item.tamanho, item.cor));
  // Os totais são de todos os achados: "quanto tenho de polo?" com 127 variações pede a soma.
  const porProduto = new Map<string, { nome: string; itens: number; em_estoque: number; disponivel: number; abaixo_do_minimo: number }>();
  for (const item of achados) {
    const linha = porProduto.get(item.nome) ?? { nome: item.nome, itens: 0, em_estoque: 0, disponivel: 0, abaixo_do_minimo: 0 };
    linha.itens += 1;
    linha.em_estoque += item.em_estoque;
    linha.disponivel += Math.max(0, item.disponivel);
    if (item.abaixo_do_minimo) linha.abaixo_do_minimo += 1;
    porProduto.set(item.nome, linha);
  }
  return {
    encontrados: achados.length,
    total: {
      pecas_em_estoque: achados.reduce((soma, item) => soma + item.em_estoque, 0),
      pecas_reservadas: achados.reduce((soma, item) => soma + item.reservado, 0),
      pecas_disponiveis: achados.reduce((soma, item) => soma + Math.max(0, item.disponivel), 0),
    },
    por_produto: [...porProduto.values()].sort((a, b) => b.disponivel - a.disponivel).slice(0, 30),
    itens: achados.slice(0, limite),
    observacao: achados.length > limite ? `Listando ${limite} de ${achados.length} itens; os totais e o resumo por produto incluem todos.` : undefined,
  };
}

// --- Pedidos --------------------------------------------------------------------------------

export const ETAPAS_DO_PEDIDO = ["Enviado", "Aprovado", "Separando", "Saiu", "Entregue"] as const;
const SEPARANDO = new Set(["separating", "separated", "checking", "ready_to_dispatch", "picking", "packing"]);

/** A mesma leitura de etapa do Início do portal (artifacts/app/src/lib/client-home.ts). */
export function etapaDoPedido(pedido: Record<string, unknown>): string {
  const status = normalizado(pedido.status);
  const operacional = normalizado(pedido.operational_status);
  if (["cancelled", "canceled", "cancelado"].includes(status)) return "Cancelado";
  if (["rejected", "rejeitado", "rejeitada"].includes(status)) return "Recusado";
  if (operacional === "delivered" || status === "closed" || status === "delivered") return "Entregue";
  if (operacional === "received") return "Recebido";
  if (operacional === "dispatched") return "Saiu";
  if (SEPARANDO.has(operacional)) return "Separando";
  if (status === "approved" || status === "aprovado" || operacional === "picking_planned") return "Aprovado";
  return "Enviado";
}

export function tipoDoPedido(pedido: Record<string, unknown>): string {
  const tipo = normalizado(pedido.type);
  if (tipo.includes("receb") || tipo.includes("inbound")) return "aviso de entrega";
  if (tipo.includes("retirada") || tipo.includes("saida") || tipo.includes("outbound") || tipo.includes("pedido")) return "pedido";
  return "solicitação";
}

function pedidoLido(pedido: RegistroLido) {
  const etapa = etapaDoPedido(pedido);
  return {
    id: pedido.id,
    // O número que a pessoa vê no portal (PED-0043, ENV-0012).
    numero: texto(pedido.request_number) || undefined,
    titulo: texto(pedido.title) || tipoDoPedido(pedido),
    tipo: tipoDoPedido(pedido),
    etapa,
    motivo_recusa: etapa === "Recusado" ? texto(pedido.decision_reason) || undefined : undefined,
    criado_em: instante(pedido.created_at),
    atualizado_em: instante(pedido.updated_at),
    itens: numero(pedido.item_count) || undefined,
    pecas: numero(pedido.quantity_total) || undefined,
    destino: texto(pedido.destination) || undefined,
    previsto_para: instante(pedido.due_at),
    fornecedor: texto(pedido.supplier) || undefined,
    nota_fiscal: texto(pedido.invoice_number) || undefined,
  };
}

async function pedidosRecentes(leitor: LeitorDoAgente) {
  return leitor.doCliente("client_request_status", { ordem: [["updated_at", "desc"]], limite: 60 });
}

export type SituacaoDoPedido = "andamento" | "concluidos" | "recusados" | "todos";

export async function listarPedidos(leitor: LeitorDoAgente, entrada: { situacao?: SituacaoDoPedido; tipo?: "pedido" | "aviso" | "todos"; limite?: number }) {
  const limite = Math.min(Math.max(entrada.limite ?? 15, 1), 40);
  const pedidos = (await pedidosRecentes(leitor)).map(pedidoLido).filter((pedido) => {
    if (entrada.tipo === "pedido" && pedido.tipo !== "pedido") return false;
    if (entrada.tipo === "aviso" && pedido.tipo !== "aviso de entrega") return false;
    const feito = pedido.etapa === "Entregue" || pedido.etapa === "Recebido";
    if (entrada.situacao === "andamento") return !feito && pedido.etapa !== "Recusado" && pedido.etapa !== "Cancelado";
    if (entrada.situacao === "concluidos") return feito;
    if (entrada.situacao === "recusados") return pedido.etapa === "Recusado";
    return true;
  });
  return { total: pedidos.length, pedidos: pedidos.slice(0, limite), etapas: ETAPAS_DO_PEDIDO };
}

export async function verPedido(leitor: LeitorDoAgente, referencia: string) {
  const procurado = texto(referencia);
  let pedido = procurado ? await leitor.documento("client_request_status", procurado) : null;
  if (!pedido) {
    const palavras = normalizado(procurado).split(/\s+/).filter(Boolean);
    pedido =
      (await pedidosRecentes(leitor)).find(
        (linha) => palavras.length > 0 && bate(procurado, linha.request_number, linha.title, linha.destination, linha.supplier, linha.invoice_number),
      ) ?? null;
  }
  if (!pedido) return { encontrado: false };
  const origem = await leitor.documento("customer_requests", pedido.id);
  const itens = Array.isArray(origem?.items) ? (origem.items as Array<Record<string, unknown>>) : [];
  return {
    encontrado: true,
    pedido: pedidoLido(pedido),
    itens: itens.slice(0, 60).map((item) => ({
      codigo: texto(item.client_item_code) || texto(item.sku_code) || texto(item.sku),
      nome: texto(item.product_name) || texto(item.name) || texto(item.description),
      quantidade: numero(item.quantity ?? item.qty ?? item.quantidade),
    })),
    observacao: itens.length > 60 ? `Pedido com ${itens.length} itens; mostrando 60.` : undefined,
  };
}

// --- Movimentações ----------------------------------------------------------------------------

/** "AAAA-MM-DD" de São Paulo: o instante UTC do começo do dia. */
function comecoDoDia(dia: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return undefined;
  const data = new Date(`${dia}T03:00:00.000Z`);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

export async function movimentacoes(leitor: LeitorDoAgente, entrada: { de: string; ate: string; texto?: string }) {
  const de = comecoDoDia(entrada.de);
  const ateODia = comecoDoDia(entrada.ate);
  if (!de || !ateODia || ateODia < de) return { erro: "Período inválido. Use datas no formato AAAA-MM-DD, com início antes do fim." };
  const ate = new Date(ateODia.getTime() + 86_400_000);
  if (ate.getTime() - de.getTime() > 186 * 86_400_000) return { erro: "Período longo demais. Consulte até 6 meses por vez." };
  const lidos = await leitor.doCliente("movements", {
    onde: [
      ["data", ">=", de.toISOString()],
      ["data", "<", ate.toISOString()],
    ],
    ordem: [["data", "desc"]],
    limite: 5000,
  });
  const porItem = new Map<string, { codigo: string; nome: string; entradas: number; saidas: number }>();
  let entradas = 0;
  let saidas = 0;
  for (const movimento of lidos) {
    const codigo = texto(movimento.client_item_code) || texto(movimento.sku_code) || texto(movimento.cod_sku);
    const nome = texto(movimento.product_name) || texto(movimento.produto) || codigo;
    if (!bate(entrada.texto, codigo, nome)) continue;
    const quantidade = Math.abs(numero(movimento.quantity ?? movimento.qtde));
    const entrou = texto(movimento.tipo_mov) === "ENTRADA" || numero(movimento.sign ?? movimento.sinal) > 0;
    const linha = porItem.get(codigo) ?? { codigo, nome, entradas: 0, saidas: 0 };
    if (entrou) {
      linha.entradas += quantidade;
      entradas += quantidade;
    } else {
      linha.saidas += quantidade;
      saidas += quantidade;
    }
    porItem.set(codigo, linha);
  }
  const itens = [...porItem.values()].sort((a, b) => b.saidas - a.saidas || b.entradas - a.entradas);
  return {
    periodo: { de: entrada.de, ate: entrada.ate },
    pecas_que_entraram: entradas,
    pecas_que_sairam: saidas,
    itens_movimentados: itens.length,
    por_item: itens.slice(0, 40),
    observacao: itens.length > 40 ? `Mostrando os 40 itens com mais saídas de ${itens.length}.` : undefined,
  };
}

// --- Documentos e conhecimento ----------------------------------------------------------------

/** A mesma condição do portal para mostrar o documento ao cliente. */
export function publicadoAoCliente(documento: Record<string, unknown> | null, customerCode: string): boolean {
  return (
    documento !== null &&
    documento.customer_code === customerCode &&
    documento.customer_visible === true &&
    documento.visibility !== "internal" &&
    documento.archived !== true &&
    documento.status !== "archived"
  );
}

/**
 * O conhecimento ativo do cliente. O cliente só recebe o que vem de documento
 * publicado para ele no portal; sem o documento de origem, não há como provar
 * e fica de fora.
 */
export async function conhecimentoDoCliente(leitor: LeitorDoAgente) {
  let candidatos = await leitor.doCliente("ai_agent_knowledge", { onde: [["status", "==", "active"]], limite: 20 });
  if (leitor.audiencia === "cliente") {
    const publicados = await Promise.all(
      candidatos.map(async (item) => {
        const origem = texto(item.source_document_id);
        return origem ? publicadoAoCliente(await leitor.documento("client_documents", origem), leitor.customerCode) : false;
      }),
    );
    candidatos = candidatos.filter((_, indice) => publicados[indice]);
  }
  const documentos = candidatos.slice(0, 12).map((item) => ({
    id: item.id,
    titulo: texto(item.title) || texto(item.source_file_name) || item.id,
    tipo: texto(item.document_type) || undefined,
    resumo: texto(item.summary) || undefined,
  }));
  const trechos: Array<{ documento: string; texto: string }> = [];
  for (const documento of documentos.slice(0, 6)) {
    const pedacos = await leitor.doCliente("ai_agent_knowledge_chunks", { onde: [["knowledge_id", "==", documento.id]], limite: 4 });
    for (const pedaco of pedacos) {
      const conteudo = texto(pedaco.text).slice(0, 1200);
      if (conteudo) trechos.push({ documento: texto(pedaco.title) || documento.titulo, texto: conteudo });
    }
  }
  return { documentos, trechos };
}

export async function documentos(leitor: LeitorDoAgente, busca?: string) {
  const lista = (await leitor.doCliente("client_documents", { limite: 200 })).filter(
    (documento) => leitor.audiencia === "equipe" || publicadoAoCliente(documento, leitor.customerCode),
  );
  const palavras = normalizado(busca).split(/\s+/).filter(Boolean);
  const achados = lista.filter((documento) => bate(busca, documento.title, documento.file_name, documento.document_type));
  const conhecimento = await conhecimentoDoCliente(leitor);
  const trechos = conhecimento.trechos
    .map((trecho) => ({ ...trecho, relevancia: palavras.filter((palavra) => normalizado(trecho.texto).includes(palavra)).length }))
    .filter((trecho) => palavras.length === 0 || trecho.relevancia > 0)
    .sort((a, b) => b.relevancia - a.relevancia)
    .slice(0, 6)
    .map(({ documento, texto: conteudo }) => ({ documento, trecho: conteudo }));
  return {
    documentos: achados.slice(0, 20).map((documento) => ({
      titulo: texto(documento.title) || texto(documento.file_name),
      tipo: texto(documento.document_type) || undefined,
      data: instante(documento.created_at ?? documento.updated_at),
    })),
    trechos,
  };
}

// --- Só a equipe ------------------------------------------------------------------------------

/** As solicitações do cliente esperando a Dutelog aprovar, das que esperam há mais tempo. */
export async function filaDeSolicitacoes(leitor: LeitorDoAgente, agora: Date) {
  const abertas = (await leitor.doCliente("customer_requests", { ordem: [["created_at", "desc"]], limite: 150 }))
    .filter((pedido) => ["open", "pending", "submitted"].includes(normalizado(pedido.status)))
    .map((pedido) => {
      const por = (pedido.requested_by ?? {}) as Record<string, unknown>;
      return {
        numero: texto(pedido.request_number) || undefined,
        tipo: tipoDoPedido(pedido),
        titulo: texto(pedido.title) || undefined,
        pedido_por: texto(por.name) || texto(pedido.requested_by_name) || undefined,
        criado_em: instante(pedido.created_at),
        dias_esperando: diasDesde(pedido.created_at, agora),
        prioridade: texto(pedido.priority) || undefined,
        itens: numero(pedido.item_count) || (Array.isArray(pedido.items) ? pedido.items.length : undefined),
        pecas: numero(pedido.quantity_total) || undefined,
        destino: texto(pedido.destination) || undefined,
        fornecedor: texto(pedido.supplier) || undefined,
      };
    })
    .sort((a, b) => (b.dias_esperando ?? 0) - (a.dias_esperando ?? 0));
  return { aguardando_aprovacao: abertas.length, solicitacoes: abertas.slice(0, 40) };
}

const RECEBIMENTO_FEITO = new Set(["received", "closed", "cancelled", "canceled", "completed"]);

export async function recebimentos(leitor: LeitorDoAgente, entrada: { situacao?: "abertos" | "todos"; texto?: string }) {
  const situacao = entrada.situacao ?? "abertos";
  const lista = (await leitor.doCliente("inbound_receipts", { ordem: [["created_at", "desc"]], limite: 80 }))
    .filter((recebimento) => situacao === "todos" || !RECEBIMENTO_FEITO.has(normalizado(recebimento.status)))
    .filter((recebimento) => bate(entrada.texto, recebimento.receipt_number, recebimento.supplier, recebimento.invoice_number, recebimento.reference))
    .map((recebimento) => ({
      numero: texto(recebimento.receipt_number) || undefined,
      situacao:
        normalizado(recebimento.status) === "checking" ? "em conferência" : RECEBIMENTO_FEITO.has(normalizado(recebimento.status)) ? "concluído" : "aguardando chegada",
      fornecedor: texto(recebimento.supplier) || undefined,
      nota_fiscal: texto(recebimento.invoice_number) || undefined,
      previsto_para: instante(recebimento.expected_at),
      itens: numero(recebimento.item_count) || undefined,
      pecas_previstas: numero(recebimento.qty_expected) || undefined,
      pecas_recebidas: numero(recebimento.qty_received),
      criado_em: instante(recebimento.created_at),
    }));
  return { encontrados: lista.length, recebimentos: lista.slice(0, 40) };
}

const TAREFA_FEITA = new Set(["completed", "done", "cancelled", "canceled", "closed"]);
const SITUACAO_DA_TAREFA: Record<string, string> = {
  planned: "a fazer",
  assigned: "atribuída",
  in_progress: "em andamento",
  picking: "separando",
  picked: "separada",
  blocked: "bloqueada",
};

export async function tarefasDoArmazem(leitor: LeitorDoAgente, agora: Date) {
  const [separacoes, guardas] = await Promise.all([
    leitor.doCliente("pick_tasks", { ordem: [["updated_at", "desc"]], limite: 150 }),
    leitor.doCliente("putaway_tasks", { ordem: [["updated_at", "desc"]], limite: 150 }),
  ]);
  const lida = (tarefa: RegistroLido, tipo: "separação" | "guarda") => ({
    tipo,
    pedido: tipo === "separação" ? texto(tarefa.order_number) || undefined : undefined,
    recebimento: tipo === "guarda" ? texto(tarefa.receipt_number) || undefined : undefined,
    item: tipo === "guarda" ? texto(tarefa.product_name) || texto(tarefa.client_item_code) || undefined : undefined,
    endereco_destino: tipo === "guarda" ? texto(tarefa.destination_location_id) || undefined : undefined,
    situacao: SITUACAO_DA_TAREFA[normalizado(tarefa.status)] ?? (texto(tarefa.status) || "a fazer"),
    prioridade: texto(tarefa.priority) || undefined,
    pecas: numero(tarefa.total_units) || numero(tarefa.quantity) || undefined,
    pecas_feitas: tipo === "separação" ? numero(tarefa.picked_units) : undefined,
    aberta_ha_dias: diasDesde(tarefa.created_at, agora),
  });
  const abertas = [
    ...separacoes.filter((tarefa) => !TAREFA_FEITA.has(normalizado(tarefa.status))).map((tarefa) => lida(tarefa, "separação")),
    ...guardas.filter((tarefa) => !TAREFA_FEITA.has(normalizado(tarefa.status))).map((tarefa) => lida(tarefa, "guarda")),
  ].sort((a, b) => (b.aberta_ha_dias ?? 0) - (a.aberta_ha_dias ?? 0));
  return {
    separacao_abertas: abertas.filter((tarefa) => tarefa.tipo === "separação").length,
    guarda_abertas: abertas.filter((tarefa) => tarefa.tipo === "guarda").length,
    tarefas: abertas.slice(0, 40),
  };
}

/** Onde está cada item: o saldo por endereço, sem custo. */
export async function enderecos(leitor: LeitorDoAgente, busca: string) {
  const achados = (await leitor.doCliente("stock_balances", { limite: 5000 }))
    .filter((saldo) => numero(saldo.qty_on_hand) > 0 || numero(saldo.qty_reserved) > 0)
    .filter((saldo) => bate(busca, saldo.client_item_code, saldo.sku_code, saldo.product_name, saldo.location_id))
    .map((saldo) => ({
      codigo: texto(saldo.client_item_code) || texto(saldo.sku_code),
      item: texto(saldo.product_name) || texto(saldo.sku_code),
      endereco: texto(saldo.location_id),
      em_estoque: numero(saldo.qty_on_hand),
      reservado: numero(saldo.qty_reserved),
      disponivel: saldo.qty_available !== undefined ? numero(saldo.qty_available) : numero(saldo.qty_on_hand) - numero(saldo.qty_reserved),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo) || a.endereco.localeCompare(b.endereco));
  return {
    encontrados: achados.length,
    enderecos: achados.slice(0, 40),
    observacao: achados.length > 40 ? `Listando 40 de ${achados.length}; refine pelo código.` : undefined,
  };
}

/** Quem fez o quê: os eventos auditáveis mais recentes do cliente, filtrados pela referência. */
export async function eventos(leitor: LeitorDoAgente, entrada: { referencia?: string; limite?: number }) {
  const limite = Math.min(Math.max(entrada.limite ?? 15, 1), 40);
  const achados = (await leitor.doCliente("events", { ordem: [["occurred_at", "desc"]], limite: 300 }))
    .filter((evento) => bate(entrada.referencia, evento.title, evento.description, evento.entity_id, JSON.stringify(evento.payload ?? {})))
    .map((evento) => {
      const ator = (evento.actor ?? {}) as Record<string, unknown>;
      return {
        quando: instante(evento.occurred_at) ?? instante(evento.created_at),
        o_que: texto(evento.title) || texto(evento.type),
        detalhe: texto(evento.description) || undefined,
        quem: texto(ator.name) || texto(ator.email) || undefined,
        papel: texto(ator.role) || undefined,
      };
    });
  return { encontrados: achados.length, eventos: achados.slice(0, limite) };
}

function relogioLido(valor: unknown): RelogioDoItem {
  const registro = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  const lido = (campo: string) => instante(registro[campo]) ?? null;
  return { ...RELOGIO_VAZIO, primeira_entrada: lido("primeira_entrada"), ultima_entrada: lido("ultima_entrada"), ultima_saida: lido("ultima_saida") };
}

/** Os itens parados do cliente pela regra do modelo dele (parte 5.4), os mais parados primeiro. */
export async function itensParados(leitor: LeitorDoAgente, modelo: string | null, agora: Date) {
  const regra = regraDoModelo(modelo);
  const hoje = diaEmSaoPaulo(agora.toISOString()) ?? agora.toISOString().slice(0, 10);
  const itens = (await leitor.doCliente("ai_stock_age", { limite: 5000 }))
    .filter((item) => numero(item.saldo) > 0)
    .map((item) => {
      const idade = idadeDoItem(relogioLido(item.relogio), numero(item.saldo), regra, hoje);
      return {
        codigo: texto(item.client_item_code) || texto(item.sku_code),
        nome: texto(item.product_name) || undefined,
        saldo: numero(item.saldo),
        dias_parado: idade.dias_parado,
        dias_sem_saida: idade.dias_sem_saida,
        etiquetas: idade.etiquetas.map((etiqueta) => rotuloDaEtiqueta(etiqueta, regra)),
      };
    })
    .filter((item) => item.etiquetas.length > 0)
    .sort((a, b) => (b.dias_parado ?? 0) - (a.dias_parado ?? 0));
  return {
    regra: { parado_dias: regra.parado_dias, sem_giro_dias: regra.sem_giro_dias },
    parados: itens.filter((item) => item.etiquetas.includes(rotuloDaEtiqueta("parado", regra))).length,
    sem_giro: itens.filter((item) => item.etiquetas.includes(rotuloDaEtiqueta("sem_giro", regra))).length,
    itens: itens.slice(0, 40),
    observacao: itens.length > 40 ? `Mostrando os 40 mais parados de ${itens.length}.` : undefined,
  };
}

// --- O registro -------------------------------------------------------------------------------

export const FERRAMENTAS_DA_ARMAZENAGEM: readonly FerramentaDoAgente[] = [
  ferramenta({
    nome: "resumo_estoque",
    descricao: "Totais do estoque do cliente: itens, peças em estoque, reservadas e disponíveis, e a lista de itens abaixo do estoque mínimo.",
    modulo: "wms",
    entrada: z.object({}),
    para: todos,
    executar: ({ leitor }) => resumoDoEstoque(leitor),
  }),
  ferramenta({
    nome: "buscar_itens",
    descricao: "Procura itens do estoque por nome, código, categoria, tamanho ou cor. Devolve saldo em estoque, reservado, disponível e mínimo de cada item.",
    modulo: "wms",
    entrada: z.object({ texto: z.string().max(200).describe("Palavras para procurar, ex.: 'polo piquet', 'caneca', 'A.01.0594'") }),
    para: todos,
    executar: ({ leitor }, { texto: busca }) => buscarItens(leitor, busca),
  }),
  ferramenta({
    nome: "listar_pedidos",
    descricao: "Lista os pedidos e avisos de entrega mais recentes, com a etapa atual (Enviado, Aprovado, Separando, Saiu, Entregue, Recebido ou Recusado).",
    modulo: "wms",
    entrada: z.object({
      situacao: z.enum(["andamento", "concluidos", "recusados", "todos"]).optional(),
      tipo: z.enum(["pedido", "aviso", "todos"]).optional(),
      limite: z.number().int().min(1).max(40).optional(),
    }),
    para: todos,
    executar: ({ leitor }, entrada) => listarPedidos(leitor, entrada),
  }),
  ferramenta({
    nome: "ver_pedido",
    descricao: "Detalhe de um pedido ou aviso de entrega: etapa, datas e itens. Aceita o número, o id ou palavras do título, destino, fornecedor ou nota fiscal.",
    modulo: "wms",
    entrada: z.object({ referencia: z.string().max(200).describe("Número do pedido (ex.: 'PED-0043'), id ou palavras do título, ex.: 'Faria Lima'") }),
    para: todos,
    executar: ({ leitor }, { referencia }) => verPedido(leitor, referencia),
  }),
  ferramenta({
    nome: "movimentacoes",
    descricao: "Entradas e saídas de peças do estoque num período (até 6 meses), somadas por item. Pode filtrar por palavras do item.",
    modulo: "wms",
    entrada: z.object({
      de: z.string().max(10).describe("Data inicial AAAA-MM-DD"),
      ate: z.string().max(10).describe("Data final AAAA-MM-DD, inclusive"),
      texto: z.string().max(200).optional().describe("Filtra itens por nome ou código"),
    }),
    para: todos,
    executar: ({ leitor }, entrada) => movimentacoes(leitor, entrada),
  }),
  ferramenta({
    nome: "documentos",
    descricao: "Documentos do cliente (contrato, notas, comprovantes) e trechos do conteúdo deles. Use para perguntas sobre contrato, regras e documentos.",
    modulo: "wms",
    entrada: z.object({ texto: z.string().max(200).optional().describe("Assunto ou palavras para procurar") }),
    para: todos,
    executar: ({ leitor }, { texto: busca }) => documentos(leitor, busca),
  }),
  ferramenta({
    nome: "itens_parados",
    descricao: "Itens do estoque do cliente parados pela regra do modelo de operação (Parado e Sem giro), com o saldo e os dias sem movimento, os mais parados primeiro.",
    modulo: "wms",
    entrada: z.object({}),
    para: daEquipe,
    executar: ({ leitor, escopo, agora }) => itensParados(leitor, escopo.modeloDeOperacao, agora),
  }),
  ferramenta({
    nome: "recebimentos",
    descricao: "Recebimentos no armazém: aguardando chegada ou em conferência (padrão), ou todos. Mostra fornecedor, nota fiscal, previsão e peças previstas e recebidas.",
    modulo: "wms",
    entrada: z.object({
      situacao: z.enum(["abertos", "todos"]).optional(),
      texto: z.string().max(200).optional().describe("Número do recebimento, fornecedor ou nota fiscal"),
    }),
    para: daEquipe,
    executar: ({ leitor }, entrada) => recebimentos(leitor, entrada),
  }),
  ferramenta({
    nome: "tarefas_armazem",
    descricao: "Tarefas abertas do armazém: separação de pedidos e guarda de recebimentos, com situação, peças e há quantos dias estão abertas.",
    modulo: "wms",
    entrada: z.object({}),
    para: daEquipe,
    executar: ({ leitor, agora }) => tarefasDoArmazem(leitor, agora),
  }),
  ferramenta({
    nome: "enderecos",
    descricao: "Onde está cada item no armazém: saldo por endereço (em estoque, reservado, disponível). Procura por código, nome do item ou endereço.",
    modulo: "wms",
    entrada: z.object({ texto: z.string().max(200).describe("Código, nome do item ou endereço, ex.: 'A.01.0594', 'polo', 'R01-P02'") }),
    para: daEquipe,
    executar: ({ leitor }, { texto: busca }) => enderecos(leitor, busca),
  }),
  ferramenta({
    nome: "fila_solicitacoes",
    descricao: "Solicitações do cliente (pedidos, avisos de envio) esperando a Dutelog aprovar, com há quantos dias cada uma espera.",
    modulo: "wms",
    entrada: z.object({}),
    para: daCoordenacao,
    executar: ({ leitor, agora }) => filaDeSolicitacoes(leitor, agora),
  }),
  ferramenta({
    nome: "eventos",
    descricao: "Histórico auditável da operação: quem fez o quê e quando (aprovações, recebimentos, ajustes). Pode filtrar por número do pedido, recebimento ou palavras.",
    modulo: "wms",
    entrada: z.object({
      referencia: z.string().max(200).optional().describe("Ex.: 'PED-0041', 'ENV-0012', 'ajuste'"),
      limite: z.number().int().min(1).max(40).optional(),
    }),
    para: daCoordenacao,
    executar: ({ leitor }, entrada) => eventos(leitor, entrada),
  }),
];
