import { z } from "zod";

import type { EscopoDoAgente } from "./agente-escopo.js";
import { ferramenta, normalizado, numero, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import type { LeitorDoAgente, RegistroLido } from "./agente-leitor.js";

/**
 * As ferramentas do Agent Dute do núcleo que valem em todo módulo (parte
 * 5.5e): as conversas anteriores da pessoa, o playbook aprovado e os cartões.
 * Nenhuma grava. O que no WMS gravava vira cartão: a anotação sugerida volta
 * como rascunho, que a pessoa envia (pergunta 34), e o uso do playbook fica no
 * registro de uso da resposta, gravado pelo fluxo da conversa.
 *
 * Os rascunhos de pedido e de aviso de envio são os do WMS
 * (functions/wms/src/domain/agent-drafts.ts) pelo leitor: o cartão os envia
 * pela createCustomerRequest do WMS, que confere a mensagem do agente.
 */

/** As ferramentas cuja resposta vira o cartão da mensagem. */
export const FERRAMENTAS_DE_CARTAO = ["rascunho_pedido", "rascunho_envio", "sugerir_rotina", "sugerir_anotacao"] as const;

// --- Conversas anteriores -----------------------------------------------------------------------

const CONVERSAS_LIDAS = 20;
const MENSAGENS_POR_CONVERSA = 30;
const TRECHOS = 6;
const TRECHO = 500;

function trecho(valor: string): string {
  const limpo = valor.replace(/\s+/g, " ").trim();
  return limpo.length > TRECHO ? `${limpo.slice(0, TRECHO)}…` : limpo;
}

function palavras(busca: string): string[] {
  return [...new Set(normalizado(busca).split(/[^a-z0-9.-]+/).filter((palavra) => palavra.length >= 3))];
}

type MensagemLida = { papel: "user" | "assistant"; conteudo: string; em: string; contexto: string };

/** As mensagens em ordem; no empate do horário, a pergunta antes da resposta. */
export function emOrdem(mensagens: readonly RegistroLido[]): MensagemLida[] {
  return mensagens
    .map((mensagem) => ({ papel: mensagem.role === "assistant" ? ("assistant" as const) : ("user" as const), conteudo: texto(mensagem.content), em: texto(mensagem.created_at_iso), contexto: texto(mensagem.context) }))
    .sort((a, b) => a.em.localeCompare(b.em) || (a.papel === b.papel ? 0 : a.papel === "user" ? -1 : 1));
}

/** O que a pessoa já conversou com o agente sobre o cliente, fora a conversa atual. */
export async function conversasAnteriores(leitor: LeitorDoAgente, escopo: EscopoDoAgente, busca: string, conversaAtual?: string) {
  const termos = palavras(busca);
  if (!termos.length) return { encontrados: 0, trechos: [], observacao: "Diga sobre o que procurar (ex.: número do pedido, item, assunto)." };
  const conversas = (await leitor.doCliente("agent_conversations", { onde: [["user_id", "==", escopo.uid]], ordem: [["last_message_at", "desc"]], limite: CONVERSAS_LIDAS + 1 }))
    .filter((conversa) => conversa.id !== conversaAtual)
    .slice(0, CONVERSAS_LIDAS);
  const porConversa = await Promise.all(
    conversas.map(async (conversa) => {
      const mensagens = emOrdem(
        await leitor.doCliente("agent_messages", {
          onde: [
            ["conversation_id", "==", conversa.id],
            ["user_id", "==", escopo.uid],
          ],
          ordem: [["created_at_iso", "desc"]],
          limite: MENSAGENS_POR_CONVERSA,
        }),
      );
      const titulo = texto(conversa.title) || "Conversa";
      const achados: Array<{ pontos: number; conversa: string; quando: string; pergunta: string; resposta: string }> = [];
      mensagens.forEach((mensagem, indice) => {
        if (mensagem.papel !== "user") return;
        const resposta = mensagens[indice + 1]?.papel === "assistant" ? mensagens[indice + 1]!.conteudo : "";
        const palheiro = normalizado(`${mensagem.conteudo} ${resposta}`);
        const pontos = termos.filter((termo) => palheiro.includes(termo)).length;
        if (pontos) achados.push({ pontos, conversa: titulo, quando: mensagem.em, pergunta: trecho(mensagem.conteudo), resposta: trecho(resposta) });
      });
      return achados;
    }),
  );
  const ordenados = porConversa.flat().sort((a, b) => b.pontos - a.pontos || b.quando.localeCompare(a.quando));
  return {
    encontrados: ordenados.length,
    trechos: ordenados.slice(0, TRECHOS).map(({ pontos: _pontos, ...achado }) => achado),
    observacao: ordenados.length ? undefined : `Nada encontrado nas últimas ${CONVERSAS_LIDAS} conversas.`,
  };
}

// --- Anotações e playbooks no prompt ----------------------------------------------------------

const NOTAS_NO_PROMPT = 30;
const PLAYBOOKS_NO_PROMPT = 40;

/** As anotações aprovadas do cliente que entram no prompt; o cliente só recebe as "para todos". */
export async function notasDoPrompt(leitor: LeitorDoAgente): Promise<string[]> {
  return (await leitor.doCliente("ai_agent_notes", { onde: [["status", "==", "active"]], limite: NOTAS_NO_PROMPT * 2 }))
    .filter((nota) => leitor.audiencia === "equipe" || nota.visibility !== "equipe")
    .map((nota) => texto(nota.text))
    .filter(Boolean)
    .slice(0, NOTAS_NO_PROMPT);
}

function playbookVisivel(playbook: RegistroLido, leitor: LeitorDoAgente): boolean {
  return leitor.audiencia === "equipe" || playbook.audience === "todos";
}

/** O índice dos playbooks aprovados para o prompt: o id, o nome e quando usar. Os passos vêm pela ferramenta. */
export async function playbooksDoPrompt(leitor: LeitorDoAgente): Promise<Array<{ id: string; titulo: string; quando: string }>> {
  return (await leitor.doCliente("ai_agent_playbooks", { onde: [["status", "==", "active"]], limite: PLAYBOOKS_NO_PROMPT * 2 }))
    .filter((playbook) => playbookVisivel(playbook, leitor))
    .map((playbook) => ({ id: playbook.id, titulo: texto(playbook.title), quando: texto(playbook.when) }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"))
    .slice(0, PLAYBOOKS_NO_PROMPT);
}

export async function lerPlaybook(leitor: LeitorDoAgente, id: string) {
  const playbook = await leitor.documento("ai_agent_playbooks", id);
  if (!playbook || playbook.status !== "active" || !playbookVisivel(playbook, leitor)) return { encontrado: false, motivo: "Não há playbook aprovado com esse id." };
  return {
    encontrado: true,
    playbook_id: playbook.id,
    nome: texto(playbook.title),
    quando_usar: texto(playbook.when),
    passos: Array.isArray(playbook.steps) ? playbook.steps.map(texto).filter(Boolean) : [],
    instrucao: "Oriente a pessoa com estes passos, adaptados ao caso dela, e diga que é o procedimento aprovado pela coordenação. Use os dados reais das consultas. Você não executa nenhum passo: quem faz é a pessoa, na tela indicada.",
  };
}

// --- Cartões ------------------------------------------------------------------------------------

/** A anotação sugerida (pergunta 34): não grava; a pessoa envia pelo cartão e a coordenação aprova. */
export function anotacaoSugerida(escopo: EscopoDoAgente, entrada: { texto: string; motivo?: string }) {
  const nota = entrada.texto.replace(/\s+/g, " ").trim().slice(0, 300);
  if (nota.length < 8) return { erro: "Anotação curta demais." };
  return {
    tipo: "anotacao" as const,
    texto: nota,
    motivo: entrada.motivo?.trim().slice(0, 300) || undefined,
    visibilidade: escopo.audiencia === "cliente" ? ("todos" as const) : ("equipe" as const),
    instrucao: "Abaixo da resposta aparece um cartão com a anotação: a pessoa confere e envia pelo botão 'Sugerir anotação'. Depois a coordenação da Dutelog aprova antes de valer. Você não grava nada e nunca diga que anotou.",
  };
}

const DIAS: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, "sáb": 6 };
const FREQUENCIAS = { todo_dia: "daily", dia_util: "weekdays", semanal: "weekly", mensal: "monthly" } as const;

function horarioDe15(valor: string | undefined): string {
  const lido = /^(\d{1,2})(?::(\d{2}))?/.exec((valor ?? "").trim());
  if (!lido) return "08:00";
  const horas = Math.min(23, Number(lido[1]));
  const minutos = Math.min(45, Math.round(Number(lido[2] ?? 0) / 15) * 15);
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

/** A rotina sugerida: não cria nada; a pessoa confere e cria pelo cartão. O mesmo formato do WMS. */
export function rotinaSugerida(entrada: { nome: string; pergunta: string; frequencia: keyof typeof FREQUENCIAS; dias?: string[]; dia_do_mes?: number; horario?: string }) {
  const frequency = FREQUENCIAS[entrada.frequencia];
  const dias = (entrada.dias ?? []).map((dia) => DIAS[dia.trim().toLowerCase().slice(0, 3)]).filter((dia): dia is number => dia !== undefined);
  return {
    tipo: "rotina" as const,
    nome: entrada.nome.trim().slice(0, 80),
    pergunta: entrada.pergunta.trim().slice(0, 600),
    frequency,
    days: frequency === "weekly" ? [...new Set(dias.length ? dias : [1])].sort() : [],
    day_of_month: frequency === "monthly" ? Math.min(28, Math.max(1, Math.floor(entrada.dia_do_mes ?? 1))) : null,
    time: horarioDe15(entrada.horario),
    instrucao: "Abaixo da resposta aparece um cartão com a rotina; a pessoa confere e cria pelo botão 'Criar rotina'. Você não cria nada. Diga que a rotina só consulta e que a resposta chega numa conversa própria aqui no Agent Dute.",
  };
}

const LINHAS_DO_RASCUNHO = 40;

function curto(valor: string | undefined, maximo: number): string | undefined {
  const limpo = texto(valor);
  return limpo ? limpo.slice(0, maximo) : undefined;
}

function diaIso(valor: string | undefined) {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;
}

function horaIso(valor: string | undefined) {
  return valor && /^([01]\d|2[0-3]):[0-5]\d$/.test(valor) ? valor : undefined;
}

async function estoqueDoRascunho(leitor: LeitorDoAgente) {
  return (await leitor.doCliente("client_inventory", { limite: 5000 })).filter((item) => item.client_archived !== true && texto(item.sku_code));
}

function disponivel(item: RegistroLido): number {
  return item.qty_available !== undefined ? numero(item.qty_available) : numero(item.qty_on_hand) - numero(item.qty_reserved);
}

function codigoDe(item: RegistroLido): string {
  return texto(item.client_item_code) || texto(item.sku_code);
}

function detalheDe(item: RegistroLido): string | undefined {
  return [texto(item.size), texto(item.color)].filter(Boolean).join(" · ") || undefined;
}

type Achado = { tipo: "achado"; item: RegistroLido } | { tipo: "varios"; opcoes: RegistroLido[] } | { tipo: "nenhum" };

/** O código exato primeiro; senão, as palavras no nome, no código, no tamanho e na cor, preferindo o que tem saldo. */
function acharItem(itens: readonly RegistroLido[], referencia: string): Achado {
  const procurado = normalizado(referencia);
  if (!procurado) return { tipo: "nenhum" };
  const exatos = itens.filter((item) => normalizado(item.client_item_code) === procurado || normalizado(item.sku_code) === procurado);
  if (exatos.length) return { tipo: "achado", item: exatos[0]! };
  const termos = procurado.split(/\s+/).filter(Boolean);
  const batem = itens.filter((item) => {
    const palheiro = normalizado([item.product_name, item.client_item_code, item.sku_code, item.size, item.color, item.category].map(texto).join(" "));
    return termos.every((termo) => palheiro.includes(termo));
  });
  const comSaldo = batem.filter((item) => disponivel(item) > 0);
  const candidatos = comSaldo.length ? comSaldo : batem;
  if (candidatos.length === 1) return { tipo: "achado", item: candidatos[0]! };
  if (candidatos.length > 1) return { tipo: "varios", opcoes: candidatos.slice(0, 6) };
  return { tipo: "nenhum" };
}

export type EntradaDoPedido = { itens: Array<{ item: string; quantidade: number }>; destino?: string; prazo?: string; hora?: string; nome?: string; observacoes?: string };

export async function rascunhoDoPedido(leitor: LeitorDoAgente, entrada: EntradaDoPedido) {
  const itens = await estoqueDoRascunho(leitor);
  const linhas: Array<{ sku_code: string; codigo: string; nome: string; detalhe?: string; quantidade: number; disponivel: number }> = [];
  const pendencias: Array<{ item: string; motivo: string; opcoes?: Array<{ codigo: string; nome: string; detalhe?: string; disponivel: number }> }> = [];
  for (const pedido of entrada.itens.slice(0, LINHAS_DO_RASCUNHO)) {
    const quantidade = Math.floor(numero(pedido.quantidade));
    const referencia = texto(pedido.item);
    if (quantidade <= 0) {
      pendencias.push({ item: referencia, motivo: "quantidade não informada" });
      continue;
    }
    const achado = acharItem(itens, referencia);
    if (achado.tipo === "nenhum") {
      pendencias.push({ item: referencia, motivo: "não encontrei no estoque" });
      continue;
    }
    if (achado.tipo === "varios") {
      pendencias.push({
        item: referencia,
        motivo: "mais de um item combina; diga qual",
        opcoes: achado.opcoes.map((item) => ({ codigo: codigoDe(item), nome: texto(item.product_name) || codigoDe(item), detalhe: detalheDe(item), disponivel: Math.max(0, disponivel(item)) })),
      });
      continue;
    }
    const livre = Math.max(0, disponivel(achado.item));
    if (livre <= 0) {
      pendencias.push({ item: referencia, motivo: "sem saldo disponível" });
      continue;
    }
    if (quantidade > livre) pendencias.push({ item: referencia, motivo: `só ${livre} disponíveis; o rascunho leva ${livre}` });
    linhas.push({ sku_code: texto(achado.item.sku_code), codigo: codigoDe(achado.item), nome: texto(achado.item.product_name) || codigoDe(achado.item), detalhe: detalheDe(achado.item), quantidade: Math.min(quantidade, livre), disponivel: livre });
  }
  const destino = curto(entrada.destino, 200);
  return {
    tipo: "pedido" as const,
    nome: curto(entrada.nome, 120),
    destino,
    prazo: diaIso(entrada.prazo),
    hora: diaIso(entrada.prazo) ? horaIso(entrada.hora) : undefined,
    observacoes: curto(entrada.observacoes, 1000),
    linhas,
    pendencias,
    falta_destino: !destino,
    instrucao:
      "Mostre um resumo curto. Abaixo da resposta aparece um cartão com o pedido: a pessoa confere, ajusta quantidades, destino e data e envia pelo botão 'Enviar pedido' do cartão; você não envia nada e nunca diga que enviou. Se houver pendências, pergunte; se faltar destino ou data, pergunte ou diga que dá para preencher no cartão.",
  };
}

export type EntradaDoEnvio = { fornecedor?: string; nota_fiscal?: string; chegada?: string; observacoes?: string; itens: Array<{ codigo?: string; nome?: string; quantidade: number }> };

export async function rascunhoDoEnvio(leitor: LeitorDoAgente, entrada: EntradaDoEnvio) {
  const itens = await estoqueDoRascunho(leitor);
  const porCodigo = new Map<string, RegistroLido>();
  for (const item of itens) {
    for (const codigo of [item.client_item_code, item.sku_code]) {
      const chave = normalizado(codigo);
      if (chave && !porCodigo.has(chave)) porCodigo.set(chave, item);
    }
  }
  const linhas = entrada.itens.slice(0, LINHAS_DO_RASCUNHO).flatMap((pedido) => {
    const quantidade = Math.floor(numero(pedido.quantidade));
    if (quantidade <= 0) return [];
    const codigo = texto(pedido.codigo);
    const conhecido = codigo ? porCodigo.get(normalizado(codigo)) : undefined;
    const nome = texto(pedido.nome) || (conhecido ? texto(conhecido.product_name) : "");
    if (!codigo && !nome) return [];
    return [
      {
        sku_code: conhecido ? texto(conhecido.sku_code) || undefined : undefined,
        codigo: conhecido ? codigoDe(conhecido) : codigo || undefined,
        nome: nome.slice(0, 200) || undefined,
        quantidade,
        situacao: conhecido ? ("no_estoque" as const) : codigo ? ("novo" as const) : ("codigo_a_definir" as const),
      },
    ];
  });
  return {
    tipo: "envio" as const,
    fornecedor: curto(entrada.fornecedor, 160),
    nota_fiscal: curto(entrada.nota_fiscal, 60),
    chegada: diaIso(entrada.chegada),
    observacoes: curto(entrada.observacoes, 1000),
    linhas,
    instrucao:
      "Mostre um resumo curto. Abaixo da resposta aparece um cartão com o aviso: a pessoa confere, ajusta e envia pelo botão 'Enviar aviso' do cartão; você não envia nada e nunca diga que enviou. Se faltar fornecedor ou data de chegada, pergunte ou diga que dá para preencher no cartão.",
  };
}

/** O cartão da resposta: a saída da última ferramenta de cartão, sem a instrução ao modelo e em JSON puro. */
export function cartaoDasRespostas(respostas: ReadonlyArray<{ nome: string; saida: unknown }>): Record<string, unknown> | undefined {
  let cartao: Record<string, unknown> | undefined;
  for (const resposta of respostas) {
    if (!(FERRAMENTAS_DE_CARTAO as readonly string[]).includes(resposta.nome)) continue;
    if (!resposta.saida || typeof resposta.saida !== "object" || "erro" in resposta.saida) continue;
    const { instrucao: _instrucao, ...resto } = resposta.saida as Record<string, unknown>;
    // O Firestore recusa undefined aninhado: o JSON tira esses campos.
    cartao = JSON.parse(JSON.stringify(resto)) as Record<string, unknown>;
  }
  return cartao;
}

/** Os playbooks abertos na resposta, para o registro de uso. */
export function playbooksUsados(respostas: ReadonlyArray<{ nome: string; saida: unknown }>): string[] {
  const ids = respostas
    .filter((resposta) => resposta.nome === "consultar_playbook")
    .map((resposta) => (resposta.saida && typeof resposta.saida === "object" ? texto((resposta.saida as Record<string, unknown>).playbook_id) : ""))
    .filter(Boolean);
  return [...new Set(ids)];
}

// --- O registro -------------------------------------------------------------------------------

const todos = () => true;
const doClienteComArmazenagem = (escopo: EscopoDoAgente) => escopo.audiencia === "cliente";

export const FERRAMENTAS_COMUNS: readonly FerramentaDoAgente[] = [
  ferramenta({
    nome: "conversas_anteriores",
    descricao: "Procura nas conversas anteriores desta mesma pessoa com o Agent Dute sobre este cliente (não na atual). Use quando ela citar algo que já perguntou ou combinou antes. Devolve a pergunta, a resposta dada e a data.",
    modulo: null,
    entrada: z.object({ texto: z.string().max(200).describe("Palavras para procurar, ex.: número do pedido, item ou assunto") }),
    para: todos,
    executar: ({ leitor, escopo, conversaId }, { texto: busca }) => conversasAnteriores(leitor, escopo, busca, conversaId),
  }),
  ferramenta({
    nome: "consultar_playbook",
    descricao: "Abre um playbook aprovado pela coordenação (procedimento da operação) pelo id da lista do prompt e devolve os passos.",
    modulo: null,
    entrada: z.object({ id: z.string().max(160).describe("O id do playbook, como aparece entre colchetes na lista") }),
    para: todos,
    executar: ({ leitor }, { id }) => lerPlaybook(leitor, id),
  }),
  ferramenta({
    nome: "sugerir_anotacao",
    descricao: "Sugere uma anotação duradoura sobre o cliente para o Agent Dute lembrar nas próximas conversas (ex.: 'Entregas na Faria Lima só pela manhã'). Vira um cartão: a pessoa envia e a coordenação aprova. Não use para dado que muda (saldo, status de pedido) nem para dado pessoal sensível.",
    modulo: null,
    entrada: z.object({
      texto: z.string().max(400).describe("A anotação, curta e objetiva, até 300 caracteres"),
      motivo: z.string().max(400).optional().describe("Por que vale anotar (o que a pessoa disse)"),
    }),
    para: todos,
    executar: async ({ escopo }, entrada) => anotacaoSugerida(escopo, entrada),
  }),
  ferramenta({
    nome: "sugerir_rotina",
    descricao: "Propõe uma ROTINA: uma pergunta que o Agent Dute responde sozinho no horário marcado (ex.: 'toda segunda às 8h, resumo da semana'). Não cria nada: a pessoa confirma no cartão.",
    modulo: null,
    entrada: z.object({
      nome: z.string().min(2).max(80).describe("Nome curto da rotina"),
      pergunta: z.string().min(5).max(600).describe("O que o agente deve responder a cada vez, escrito como pedido completo"),
      frequencia: z.enum(["todo_dia", "dia_util", "semanal", "mensal"]),
      dias: z.array(z.string().max(10)).max(7).optional().describe("Na semanal: seg, ter, qua, qui, sex, sáb, dom"),
      dia_do_mes: z.number().int().min(1).max(28).optional(),
      horario: z.string().max(5).optional().describe("HH:MM, de 15 em 15 minutos"),
    }),
    para: todos,
    executar: async (_contexto, entrada) => rotinaSugerida(entrada),
  }),
  ferramenta({
    nome: "rascunho_pedido",
    descricao: "Monta o RASCUNHO de um pedido de retirada com os itens do estoque do cliente. Não envia: vira um cartão que a pessoa confere e envia.",
    modulo: "wms",
    entrada: z.object({
      itens: z.array(z.object({ item: z.string().max(200).describe("Código ou nome do item"), quantidade: z.number() })).min(1).max(40),
      destino: z.string().max(200).optional(),
      prazo: z.string().max(10).optional().describe("AAAA-MM-DD"),
      hora: z.string().max(5).optional().describe("HH:MM"),
      nome: z.string().max(120).optional().describe("Quem recebe"),
      observacoes: z.string().max(1000).optional(),
    }),
    para: doClienteComArmazenagem,
    executar: ({ leitor }, entrada) => rascunhoDoPedido(leitor, entrada),
  }),
  ferramenta({
    nome: "rascunho_envio",
    descricao: "Monta o RASCUNHO de um aviso de envio (o cliente vai mandar itens para o armazém). Não envia: vira um cartão que a pessoa confere e envia.",
    modulo: "wms",
    entrada: z.object({
      fornecedor: z.string().max(160).optional(),
      nota_fiscal: z.string().max(60).optional(),
      chegada: z.string().max(10).optional().describe("AAAA-MM-DD"),
      observacoes: z.string().max(1000).optional(),
      itens: z.array(z.object({ codigo: z.string().max(80).optional(), nome: z.string().max(200).optional(), quantidade: z.number() })).min(1).max(40),
    }),
    para: doClienteComArmazenagem,
    executar: ({ leitor }, entrada) => rascunhoDoEnvio(leitor, entrada),
  }),
];
