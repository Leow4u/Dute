import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import type { ItemDoCatalogo } from "./demanda-direta.js";
import {
  ETAPAS_DA_VISTORIA,
  ETAPA_ROTULO,
  chave,
  falha,
  informadoPor,
  instante,
  instanteDoRegistro,
  interpretar,
  invalid,
  meio,
  numero,
  origemDoRegistro,
  problemaParaRegistrar,
  registroLido,
  type ContextoDoRegistro,
  type EtapaDaOs,
  type EtapaRegistrada,
  type RegistroDaExecucao,
} from "./execucao.js";
import type { FotoRegistrada } from "./fotos.js";
import { deMilesimos, emMilesimos, type OsGravada } from "./os.js";

/**
 * A vistoria (docs/plataforma/fase-3-operacao.md, parte 3.11a). É uma OS
 * (`tipo: "vistoria"`, sem itens) que vai ao local antes do escopo fechado e
 * levanta, por ambiente, as fotos e os itens do catálogo, com as medidas, o
 * acesso e as observações. "Enviar vistoria ao Comercial" grava tudo na OS e
 * o resumo em `demands/{numero}.vistoria`, que só a Operação escreve: o
 * Comercial lê e monta o orçamento sem redigitar. A vistoria não pede
 * assinatura nem passa pela revisão: vai de Em execução a Revisada.
 *
 * Sem valor: o catálogo do campo não tem preço; o preço sai da tabela no
 * orçamento.
 */

export { ETAPAS_DA_VISTORIA };

export const MAX_AMBIENTES = 30;
export const MAX_ITENS_POR_AMBIENTE = 100;
export const MAX_ITENS_DA_VISTORIA = 300;
export const MAX_FOTOS_POR_AMBIENTE = 50;
export const MAX_MEDIDAS = 30;
export const MAX_NOME = 60;
export const MAX_VALOR_DA_MEDIDA = 60;
export const MAX_ACESSO = 120;
export const MAX_OBSERVACOES = 2000;

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;
const FOTO = /^ft_[a-f0-9]{16}$/;

export type ItemLevantado = { lpu_item_id: string; item: string; unidade: string | null; servico: string | null; quantidade: string };

export type AmbienteDaVistoria = { nome: string; itens: ItemLevantado[]; fotos: string[] };

export type MedidaDaVistoria = { nome: string; valor: string };

export type AcessoDaVistoria = { horario_de_carga: string | null; vaga_de_carga: string | null };

export type VistoriaDaOs = RegistroDaExecucao & {
  ambientes: AmbienteDaVistoria[];
  medidas: MedidaDaVistoria[];
  acesso: AcessoDaVistoria;
  observacoes: string | null;
};

/**
 * O que o Comercial lê na demanda: a OS, quando foi enviada, os ambientes
 * (com os caminhos das fotos no Storage), os itens somados de todos os
 * ambientes, as medidas, o acesso e as observações. Sem valor.
 */
export type VistoriaNaDemanda = {
  os: string;
  enviada_em: string;
  ambientes: Array<{ nome: string; itens: Array<Pick<ItemLevantado, "lpu_item_id" | "item" | "unidade" | "quantidade">>; fotos: string[] }>;
  itens: Array<Pick<ItemLevantado, "lpu_item_id" | "item" | "unidade" | "quantidade">>;
  medidas: MedidaDaVistoria[];
  acesso: AcessoDaVistoria;
  observacoes: string | null;
};

// --- Entrada ------------------------------------------------------------------------------

/** O campo ("o nome do ambiente") e onde ("no nome do ambiente"), para as mensagens. */
type Rotulo = { campo: string; onde: string };

const textoCurto = (rotulo: Rotulo, maximo: number) =>
  z
    .string()
    .trim()
    .min(1, `Informe ${rotulo.campo}.`)
    .max(maximo, `Use até ${maximo} caracteres ${rotulo.onde}.`)
    .transform((valor) => valor.replace(/\s+/g, " "));

const opcional = (onde: string, maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo, `Use até ${maximo} caracteres ${onde}.`)
    .nullable()
    .optional()
    .transform((valor) => (valor ? valor.replace(/\s+/g, " ") : null));

const ItemPedido = z
  .object({
    lpu_item_id: z.string().trim().min(1, "Item do catálogo inválido.").max(120),
    quantidade: z.string().trim().regex(QUANTIDADE, "Quantidade inválida: use número com ponto e até 3 casas."),
  })
  .strict();

const AmbientePedido = z
  .object({
    nome: textoCurto({ campo: "o nome do ambiente", onde: "no nome do ambiente" }, MAX_NOME),
    itens: z
      .array(ItemPedido)
      .max(MAX_ITENS_POR_AMBIENTE, `Um ambiente passa de ${MAX_ITENS_POR_AMBIENTE} itens.`)
      .optional()
      .transform((valor) => valor ?? []),
    fotos: z
      .array(z.string().trim().regex(FOTO, "Foto inválida."))
      .max(MAX_FOTOS_POR_AMBIENTE, `Um ambiente passa de ${MAX_FOTOS_POR_AMBIENTE} fotos.`)
      .optional()
      .transform((valor) => valor ?? []),
  })
  .strict();

const MedidaPedida = z
  .object({
    nome: textoCurto({ campo: "o nome da medida", onde: "no nome da medida" }, MAX_NOME),
    valor: textoCurto({ campo: "o valor da medida", onde: "no valor da medida" }, MAX_VALOR_DA_MEDIDA),
  })
  .strict();

const EnviarVistoria = z
  .object({
    idempotency_key: chave,
    numero,
    instante,
    ambientes: z
      .array(AmbientePedido)
      .min(1, "Levante ao menos um ambiente.")
      .max(MAX_AMBIENTES, `A vistoria passa de ${MAX_AMBIENTES} ambientes.`),
    medidas: z
      .array(MedidaPedida)
      .max(MAX_MEDIDAS, `A vistoria passa de ${MAX_MEDIDAS} medidas.`)
      .optional()
      .transform((valor) => valor ?? []),
    acesso: z
      .object({ horario_de_carga: opcional("no horário de carga", MAX_ACESSO), vaga_de_carga: opcional("na vaga de carga", MAX_ACESSO) })
      .strict()
      .optional()
      .transform((valor) => ({ horario_de_carga: valor?.horario_de_carga ?? null, vaga_de_carga: valor?.vaga_de_carga ?? null })),
    observacoes: opcional("nas observações", MAX_OBSERVACOES),
    informado_por: informadoPor,
    meio,
  })
  .strict();

export type PedidoDeVistoria = z.infer<typeof EnviarVistoria>;

export function interpretarVistoria(data: unknown): PedidoDeVistoria {
  return interpretar(EnviarVistoria, data);
}

// --- Regras -------------------------------------------------------------------------------

function horaEmSaoPaulo(instanteUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instanteUtc));
}

function chaveDoNome(nome: string): string {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export type VistoriaEnviada = {
  vistoria: VistoriaDaOs;
  resumo: VistoriaNaDemanda;
  etapas: EtapaRegistrada[];
  /** A etapa Fim que o envio registrou (null quando ela já estava registrada). */
  fim: EtapaRegistrada | null;
  contagem: { ambientes: number; itens: number; fotos: number; medidas: number };
};

/**
 * Envia a vistoria em execução ao Comercial. Cada ambiente tem nome único;
 * cada item é do catálogo, ativo e orçável, uma vez por ambiente e com
 * quantidade maior que zero; cada foto já está na OS e entra num ambiente
 * só. A vistoria leva ao menos uma foto e um item. A hora não vem antes da
 * última etapa. No celular, quando a OS tem líder, só ele envia.
 */
export function enviarVistoria(
  os: OsGravada,
  entrada: { etapas: readonly EtapaRegistrada[]; fotos: readonly FotoRegistrada[]; catalogo: ReadonlyMap<string, ItemDoCatalogo> },
  pedido: PedidoDeVistoria,
  contexto: ContextoDoRegistro,
): VistoriaEnviada {
  if (os.tipo !== "vistoria") falha("Só a OS de vistoria vai ao Comercial por aqui.");
  const problema = problemaParaRegistrar(os);
  if (problema) falha(problema);
  if (os.status === "agendada") falha("Registre a chegada antes de enviar a vistoria.");

  if (contexto.canal === "celular") {
    const lideres = os.equipe.filter((pessoa) => pessoa.papel === "lider").map((pessoa) => pessoa.colaborador_id);
    if (lideres.length > 0 && !lideres.includes(contexto.informante ?? "")) {
      throw new HttpsError("permission-denied", "Só o líder envia a vistoria pelo celular.");
    }
  }

  const quando = instanteDoRegistro(pedido.instante, os, contexto.agora);
  const ultima = entrada.etapas.at(-1);
  if (ultima && quando < ultima.instante) {
    falha(`A hora vem antes de ${ETAPA_ROTULO[ultima.etapa]} (${horaEmSaoPaulo(ultima.instante)}).`);
  }

  const fotosDaOs = new Map(entrada.fotos.map((foto) => [foto.id, foto]));
  const nomes = new Set<string>();
  const fotosUsadas = new Set<string>();
  const soma = new Map<string, { item: ItemLevantado; milesimos: number }>();
  const ambientes = pedido.ambientes.map((ambiente): AmbienteDaVistoria => {
    const chaveNome = chaveDoNome(ambiente.nome);
    if (nomes.has(chaveNome)) invalid(`O ambiente ${ambiente.nome} aparece duas vezes.`);
    nomes.add(chaveNome);
    const vistosNoAmbiente = new Set<string>();
    const itens = ambiente.itens.map((pedido): ItemLevantado => {
      const doCatalogo = entrada.catalogo.get(pedido.lpu_item_id);
      if (!doCatalogo || !doCatalogo.ativo) invalid(`${ambiente.nome}: um item não está ativo no catálogo.`);
      if (!doCatalogo.orcavel) invalid(`${ambiente.nome}: ${doCatalogo.item} não se orça.`);
      if (vistosNoAmbiente.has(doCatalogo.id)) invalid(`${ambiente.nome}: ${doCatalogo.item} aparece duas vezes.`);
      vistosNoAmbiente.add(doCatalogo.id);
      const milesimos = emMilesimos(pedido.quantidade) ?? 0;
      if (milesimos <= 0) invalid(`${ambiente.nome}: informe uma quantidade maior que zero para ${doCatalogo.item}.`);
      const item: ItemLevantado = {
        lpu_item_id: doCatalogo.id,
        item: doCatalogo.item,
        unidade: doCatalogo.unidade || null,
        servico: doCatalogo.servico || null,
        quantidade: deMilesimos(milesimos),
      };
      const somado = soma.get(item.lpu_item_id);
      soma.set(item.lpu_item_id, { item, milesimos: (somado?.milesimos ?? 0) + milesimos });
      return item;
    });
    const fotos = ambiente.fotos.map((id) => {
      if (!fotosDaOs.has(id)) invalid(`${ambiente.nome}: uma foto não está na OS. Envie a foto antes.`);
      if (fotosUsadas.has(id)) invalid("Uma foto está em dois ambientes.");
      fotosUsadas.add(id);
      return id;
    });
    return { nome: ambiente.nome, itens, fotos };
  });
  if (fotosUsadas.size === 0) falha("Tire ao menos uma foto da vistoria.");
  if (soma.size === 0) falha("Levante ao menos um item do catálogo.");
  const totalDeItens = ambientes.reduce((total, ambiente) => total + ambiente.itens.length, 0);
  if (totalDeItens > MAX_ITENS_DA_VISTORIA) invalid(`A vistoria passa de ${MAX_ITENS_DA_VISTORIA} itens.`);

  const medidas = new Set<string>();
  for (const medida of pedido.medidas) {
    const chaveMedida = chaveDoNome(medida.nome);
    if (medidas.has(chaveMedida)) invalid(`A medida ${medida.nome} aparece duas vezes.`);
    medidas.add(chaveMedida);
  }

  const registro: RegistroDaExecucao = {
    instante: quando,
    canal: contexto.canal,
    ...origemDoRegistro(os, pedido, contexto),
    registrado_por: contexto.registrado_por,
    registrado_em: contexto.agora.toISOString(),
  };
  const jaTemFim = entrada.etapas.some((etapa) => etapa.etapa === "fim");
  const fim: EtapaRegistrada | null = jaTemFim ? null : { ...registro, etapa: "fim" };
  const vistoria: VistoriaDaOs = { ...registro, ambientes, medidas: pedido.medidas, acesso: pedido.acesso, observacoes: pedido.observacoes };
  const semServico = ({ lpu_item_id, item, unidade, quantidade }: ItemLevantado) => ({ lpu_item_id, item, unidade, quantidade });
  const resumo: VistoriaNaDemanda = {
    os: os.numero,
    enviada_em: quando,
    ambientes: ambientes.map((ambiente) => ({
      nome: ambiente.nome,
      itens: ambiente.itens.map(semServico),
      fotos: ambiente.fotos.map((id) => (fotosDaOs.get(id) as FotoRegistrada).caminho),
    })),
    itens: [...soma.values()].map(({ item, milesimos }) => semServico({ ...item, quantidade: deMilesimos(milesimos) })),
    medidas: pedido.medidas,
    acesso: pedido.acesso,
    observacoes: pedido.observacoes,
  };
  return {
    vistoria,
    resumo,
    etapas: fim ? [...entrada.etapas, fim] : [...entrada.etapas],
    fim,
    contagem: { ambientes: ambientes.length, itens: soma.size, fotos: fotosUsadas.size, medidas: pedido.medidas.length },
  };
}

// --- Leitura ------------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function objetos(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/** A vistoria gravada na OS, ou null. */
export function vistoriaLida(data: Record<string, unknown>): VistoriaDaOs | null {
  const bruto = data.vistoria;
  if (!bruto || typeof bruto !== "object") return null;
  const vistoria = bruto as Record<string, unknown>;
  const registro = registroLido(vistoria);
  if (!registro) return null;
  const acesso = vistoria.acesso && typeof vistoria.acesso === "object" ? (vistoria.acesso as Record<string, unknown>) : {};
  return {
    ...registro,
    ambientes: objetos(vistoria.ambientes).map((ambiente) => ({
      nome: texto(ambiente.nome),
      itens: objetos(ambiente.itens).map((item) => ({
        lpu_item_id: texto(item.lpu_item_id),
        item: texto(item.item),
        unidade: texto(item.unidade) || null,
        servico: texto(item.servico) || null,
        quantidade: texto(item.quantidade),
      })),
      fotos: Array.isArray(ambiente.fotos) ? ambiente.fotos.filter((id): id is string => typeof id === "string") : [],
    })),
    medidas: objetos(vistoria.medidas).map((medida) => ({ nome: texto(medida.nome), valor: texto(medida.valor) })),
    acesso: { horario_de_carga: texto(acesso.horario_de_carga) || null, vaga_de_carga: texto(acesso.vaga_de_carga) || null },
    observacoes: texto(vistoria.observacoes) || null,
  };
}
