import { randomBytes } from "node:crypto";

import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

/**
 * Cadastro de colaboradores e veículos (docs/plataforma/fase-3-operacao.md,
 * parte 1). O plano da plataforma lista os campos; esta parte grava o
 * cadastro e nada de ordem de serviço.
 *
 * A entrada passa por safeParse (invalid-argument, mensagem em português).
 * `aplicar*` é puro: confere a edição e o estado, e devolve o documento e o
 * tipo do evento. A unicidade do CPF e da placa e a gravação ficam na
 * transação (`saveCollaboratorFor` / `saveVehicleFor`).
 */

export const COLLABORATORS_COLLECTION = "collaborators";
export const VEHICLES_COLLECTION = "vehicles";

export const CATEGORIAS_CNH = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;
export type CategoriaCnh = (typeof CATEGORIAS_CNH)[number];

export type Cnh = { categoria: CategoriaCnh; validade: string };

/**
 * Vínculo da pessoa com a Dutelog (parte 3.4): própria, freelancer ou
 * terceiro (motorista de transportadora). Freelancer e terceiro não precisam
 * de login: o líder registra a presença deles na OS.
 */
export const VINCULOS = ["proprio", "freelancer", "terceiro"] as const;
export type Vinculo = (typeof VINCULOS)[number];

/**
 * O que a pessoa faz na OS. Com papéis marcados, o papel dela em cada OS sai
 * desta lista; sem nenhum, a coordenação escolhe qualquer um.
 */
export const PAPEIS_DE_CAMPO = ["lider", "motorista", "montador", "ajudante"] as const;
export type PapelDeCampo = (typeof PAPEIS_DE_CAMPO)[number];

/** De quem é o veículo: da Dutelog ou de um terceiro (transportadora). */
export const DONOS_DE_VEICULO = ["proprio", "terceiro"] as const;
export type DonoDeVeiculo = (typeof DONOS_DE_VEICULO)[number];

/** Quem pode ter o app do campo ligado ao cadastro. */
export const PAPEIS_COM_APP = ["campo", "interno"] as const;

export type ColaboradorGravado = {
  id: string;
  nome: string;
  cpf: string;
  funcao: string;
  telefone: string | null;
  cnh: Cnh | null;
  vinculo: Vinculo;
  /** A empresa do terceiro; null para própria e freelancer. */
  empresa: string | null;
  papeis: PapelDeCampo[];
  /** O login do app (users/{uid}) da pessoa, quando ela tem; é o que deixa o campo ler a própria OS. */
  usuario_uid: string | null;
  usuario_email: string | null;
  ativo: boolean;
  edicao: number;
};

export type VeiculoGravado = {
  id: string;
  placa: string;
  tipo: string;
  modelo: string | null;
  capacidade_kg: number;
  capacidade_m3: number;
  dono: DonoDeVeiculo;
  /** A empresa dona do veículo de terceiro; null no próprio. */
  empresa: string | null;
  /** Data da próxima revisão (AAAA-MM-DD), para o alerta do Início. */
  revisao_em: string | null;
  ativo: boolean;
  edicao: number;
};

const ID_COLABORADOR = /^col_[a-f0-9]{16}$/;
const ID_VEICULO = /^vei_[a-f0-9]{16}$/;

export function novoId(prefixo: "col" | "vei"): string {
  return `${prefixo}_${randomBytes(8).toString("hex")}`;
}

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  switch (issue.code) {
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `${campo}: use ${issue.options.map(String).join(", ")}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `${campo.replace(/\.\d+$/, "")}: use ${issue.options.map(String).join(", ")}.` };
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? `Informe ${campo}.` : `${campo}: tipo inválido.` };
    case z.ZodIssueCode.too_small:
      return { message: `${campo}: curto demais.` };
    case z.ZodIssueCode.too_big:
      return { message: `${campo}: longo demais.` };
    default:
      return { message: `${campo}: valor inválido.` };
  }
};

function parseEntrada<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse(data ?? {}, { errorMap: mensagens });
  if (parsed.success) return parsed.data;
  throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Dados inválidos.");
}

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

const chave = z.string().trim().min(1, "Informe a chave de idempotência.").max(200);
const edicao = z.number().int().min(1).max(100_000);
const nome = z
  .string()
  .trim()
  .max(120, "Use até 120 caracteres no nome.")
  .transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => value.length >= 2, "Informe o nome (ao menos 2 caracteres).");
const funcao = z
  .string()
  .trim()
  .max(40, "Use até 40 caracteres na função.")
  .transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => value.length >= 2, "Informe a função (ao menos 2 caracteres).");
const tipo = z
  .string()
  .trim()
  .max(40, "Use até 40 caracteres no tipo.")
  .transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => value.length >= 2, "Informe o tipo (ao menos 2 caracteres).");
const modelo = z
  .string()
  .trim()
  .max(80, "Use até 80 caracteres no modelo.")
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value == null) return null;
    return value.replace(/\s+/g, " ") || null;
  });

const empresa = z
  .string()
  .trim()
  .max(80, "Use até 80 caracteres na empresa.")
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value == null) return null;
    return value.replace(/\s+/g, " ") || null;
  });
const vinculo = z.enum(VINCULOS);
const papeis = z
  .array(z.enum(PAPEIS_DE_CAMPO))
  .max(PAPEIS_DE_CAMPO.length)
  .transform((lista) => PAPEIS_DE_CAMPO.filter((papel) => lista.includes(papel)));
const emailDoApp = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null))
  .refine((value) => value == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "E-mail do app inválido.");
const dono = z.enum(DONOS_DE_VEICULO);

function digitos(value: string): string {
  return value.replace(/\D/g, "");
}

export function cpfValido(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const digito = (tamanho: number) => {
    let soma = 0;
    for (let indice = 0; indice < tamanho; indice += 1) soma += Number(digits[indice]) * (tamanho + 1 - indice);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(digits[9]) && digito(10) === Number(digits[10]);
}

const cpf = z
  .string()
  .trim()
  .transform(digitos)
  .refine(cpfValido, "CPF inválido.");

const telefoneCampo = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value == null) return null;
    const digits = digitos(value);
    return digits || null;
  })
  .refine((value) => value == null || /^\d{10,11}$/.test(value), "Telefone inválido: use DDD e o número.");

const categoriaCampo = z
  .string()
  .trim()
  .toUpperCase()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null));
const validadeCampo = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null));

function dataCalendario(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ano = Number(value.slice(0, 4));
  const mes = Number(value.slice(5, 7));
  const dia = Number(value.slice(8, 10));
  if (ano < 1980 || ano > 2100) return false;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function cnhDe(categoria: string | null | undefined, validade: string | null | undefined, obrigatoria: boolean): Cnh | null | undefined {
  if (categoria === undefined && validade === undefined) return obrigatoria ? null : undefined;
  const cat = categoria || null;
  const val = validade || null;
  if (!cat && !val) return null;
  if (!cat || !val) invalid("Informe a categoria e a validade da CNH.");
  if (!(CATEGORIAS_CNH as readonly string[]).includes(cat)) invalid("Categoria da CNH inválida.");
  if (!dataCalendario(val)) invalid("Data de validade da CNH inválida.");
  return { categoria: cat as CategoriaCnh, validade: val };
}

const idColaborador = z.string().trim().regex(ID_COLABORADOR, "Colaborador inválido.");
const idVeiculo = z.string().trim().regex(ID_VEICULO, "Veículo inválido.");

const CriarColaborador = z
  .object({
    action: z.literal("create"),
    idempotency_key: chave,
    nome,
    cpf,
    funcao,
    telefone: telefoneCampo,
    cnh_categoria: categoriaCampo,
    cnh_validade: validadeCampo,
    vinculo: vinculo.optional(),
    empresa,
    papeis: papeis.optional(),
    usuario_email: emailDoApp,
  })
  .strict();

const AlterarColaborador = z
  .object({
    action: z.literal("update"),
    idempotency_key: chave,
    id: idColaborador,
    expected_edicao: edicao,
    nome: nome.optional(),
    cpf: cpf.optional(),
    funcao: funcao.optional(),
    telefone: telefoneCampo,
    cnh_categoria: categoriaCampo,
    cnh_validade: validadeCampo,
    vinculo: vinculo.optional(),
    empresa,
    papeis: papeis.optional(),
    usuario_email: emailDoApp,
  })
  .strict();

const AtivarColaborador = z
  .object({
    action: z.literal("set_active"),
    idempotency_key: chave,
    id: idColaborador,
    expected_edicao: edicao,
    ativo: z.boolean(),
  })
  .strict();

export type AcaoColaborador =
  | {
      action: "create";
      idempotency_key: string;
      nome: string;
      cpf: string;
      funcao: string;
      telefone: string | null;
      cnh: Cnh | null;
      vinculo: Vinculo;
      empresa: string | null;
      papeis: PapelDeCampo[];
      usuario_email: string | null;
    }
  | {
      action: "update";
      idempotency_key: string;
      id: string;
      expected_edicao: number;
      nome?: string;
      cpf?: string;
      funcao?: string;
      telefone?: string | null;
      cnh?: Cnh | null;
      vinculo?: Vinculo;
      empresa?: string | null;
      papeis?: PapelDeCampo[];
      usuario_email?: string | null;
    }
  | { action: "set_active"; idempotency_key: string; id: string; expected_edicao: number; ativo: boolean };

export function interpretarColaborador(data: unknown): AcaoColaborador {
  const entrada = parseEntrada(z.discriminatedUnion("action", [CriarColaborador, AlterarColaborador, AtivarColaborador]), data);
  if (entrada.action === "set_active") return entrada;
  const cnh = cnhDe(entrada.cnh_categoria, entrada.cnh_validade, entrada.action === "create");
  if (entrada.action === "create") {
    return {
      action: "create",
      idempotency_key: entrada.idempotency_key,
      nome: entrada.nome,
      cpf: entrada.cpf,
      funcao: entrada.funcao,
      telefone: entrada.telefone ?? null,
      cnh: cnh ?? null,
      vinculo: entrada.vinculo ?? "proprio",
      empresa: entrada.empresa ?? null,
      papeis: entrada.papeis ?? [],
      usuario_email: entrada.usuario_email ?? null,
    };
  }
  const alteracao: AcaoColaborador = {
    action: "update",
    idempotency_key: entrada.idempotency_key,
    id: entrada.id,
    expected_edicao: entrada.expected_edicao,
  };
  if (entrada.nome !== undefined) alteracao.nome = entrada.nome;
  if (entrada.cpf !== undefined) alteracao.cpf = entrada.cpf;
  if (entrada.funcao !== undefined) alteracao.funcao = entrada.funcao;
  if (entrada.telefone !== undefined) alteracao.telefone = entrada.telefone;
  if (cnh !== undefined) alteracao.cnh = cnh;
  if (entrada.vinculo !== undefined) alteracao.vinculo = entrada.vinculo;
  if (entrada.empresa !== undefined) alteracao.empresa = entrada.empresa;
  if (entrada.papeis !== undefined) alteracao.papeis = entrada.papeis;
  if (entrada.usuario_email !== undefined) alteracao.usuario_email = entrada.usuario_email;
  const { action: _action, idempotency_key: _chave, id: _id, expected_edicao: _edicao, ...mudancas } = alteracao;
  if (Object.keys(mudancas).length === 0) invalid("Nada para alterar.");
  return alteracao;
}

function edicaoConfere(atual: { edicao: number }, esperada: number): void {
  if (atual.edicao !== esperada) {
    throw new HttpsError("failed-precondition", "O cadastro foi atualizado. Recarregue e tente de novo.");
  }
}

function idConfere(atual: string, pedido: string): void {
  if (atual !== pedido) throw new HttpsError("internal", "O id do cadastro não confere.");
}

export type EfeitoColaborador = {
  documento: ColaboradorGravado;
  evento: "collaborator.created" | "collaborator.updated" | "collaborator.deactivated" | "collaborator.reactivated";
};

export function aplicarColaborador(atual: ColaboradorGravado | null, acao: AcaoColaborador, id: string): EfeitoColaborador {
  if (!ID_COLABORADOR.test(id)) throw new HttpsError("internal", "Id de colaborador fora do formato.");
  if (acao.action === "create") {
    if (atual) throw new HttpsError("internal", "Criar não recebe um colaborador que já existe.");
    return {
      evento: "collaborator.created",
      documento: {
        id,
        nome: acao.nome,
        cpf: acao.cpf,
        funcao: acao.funcao,
        telefone: acao.telefone,
        cnh: acao.cnh,
        ...vinculoConferido(acao.vinculo, acao.empresa),
        papeis: acao.papeis,
        usuario_uid: null,
        usuario_email: acao.usuario_email,
        ativo: true,
        edicao: 1,
      },
    };
  }
  if (!atual) throw new HttpsError("not-found", "Colaborador não encontrado.");
  idConfere(atual.id, id);
  idConfere(acao.id, id);
  edicaoConfere(atual, acao.expected_edicao);
  if (acao.action === "update") {
    if (!atual.ativo) throw new HttpsError("failed-precondition", "Colaborador desativado. Reative para alterar.");
    return {
      evento: "collaborator.updated",
      documento: {
        ...atual,
        nome: acao.nome ?? atual.nome,
        cpf: acao.cpf ?? atual.cpf,
        funcao: acao.funcao ?? atual.funcao,
        telefone: acao.telefone === undefined ? atual.telefone : acao.telefone,
        cnh: acao.cnh === undefined ? atual.cnh : acao.cnh,
        ...vinculoConferido(acao.vinculo ?? atual.vinculo, acao.empresa === undefined ? atual.empresa : acao.empresa),
        papeis: acao.papeis ?? atual.papeis,
        usuario_uid: acao.usuario_email === undefined ? atual.usuario_uid : null,
        usuario_email: acao.usuario_email === undefined ? atual.usuario_email : acao.usuario_email,
        edicao: atual.edicao + 1,
      },
    };
  }
  if (atual.ativo === acao.ativo) {
    throw new HttpsError("failed-precondition", acao.ativo ? "O colaborador já está ativo." : "O colaborador já está desativado.");
  }
  return {
    evento: acao.ativo ? "collaborator.reactivated" : "collaborator.deactivated",
    documento: { ...atual, ativo: acao.ativo, edicao: atual.edicao + 1 },
  };
}

/** O terceiro tem empresa; própria e freelancer, não (a empresa some). */
export function vinculoConferido(vinculoPedido: Vinculo, empresaPedida: string | null): { vinculo: Vinculo; empresa: string | null } {
  if (vinculoPedido === "terceiro") {
    if (!empresaPedida) invalid("Informe a empresa do terceiro.");
    return { vinculo: vinculoPedido, empresa: empresaPedida };
  }
  return { vinculo: vinculoPedido, empresa: null };
}

/** O dono terceiro tem empresa; o próprio, não. */
export function donoConferido(donoPedido: DonoDeVeiculo, empresaPedida: string | null): { dono: DonoDeVeiculo; empresa: string | null } {
  if (donoPedido === "terceiro") {
    if (!empresaPedida) invalid("Informe a empresa dona do veículo.");
    return { dono: donoPedido, empresa: empresaPedida };
  }
  return { dono: donoPedido, empresa: null };
}

/** Outro colaborador já está ligado a este login do app. */
export function conflitoDeUsuario(proprioId: string, ids: readonly string[]): string | null {
  return ids.some((id) => id !== proprioId) ? "Este login do app já está ligado a outro colaborador." : null;
}

export function conflitoDeCpf(proprioId: string | null, ids: readonly string[]): string | null {
  return ids.some((id) => id !== proprioId) ? "Já existe um colaborador com este CPF." : null;
}

const placaCampo = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .refine((value) => /^[A-Z]{3}[0-9]{4}$/.test(value) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(value), "Placa inválida.");

const quilos = z
  .number({ invalid_type_error: "Informe a capacidade em quilos." })
  .int("A capacidade em quilos é um número inteiro.")
  .min(1, "Informe a capacidade em quilos.")
  .max(80_000, "Capacidade em quilos acima do limite.");

function metrosCubicos(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid("Informe a capacidade em metros cúbicos.");
  const centesimos = Math.round(value * 100);
  if (Math.abs(value * 100 - centesimos) > 1e-6) invalid("A capacidade em metros cúbicos tem no máximo duas casas.");
  if (centesimos < 1 || centesimos > 20_000) invalid("Informe a capacidade em metros cúbicos.");
  return centesimos / 100;
}

const metros = z.number({ invalid_type_error: "Informe a capacidade em metros cúbicos." }).transform((value) => {
  try {
    return metrosCubicos(value);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw error;
  }
});

const revisaoCampo = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null))
  .refine((value) => value == null || dataCalendario(value), "Data da revisão inválida.");

const CriarVeiculo = z
  .object({
    action: z.literal("create"),
    idempotency_key: chave,
    placa: placaCampo,
    tipo,
    modelo,
    capacidade_kg: quilos,
    capacidade_m3: metros,
    dono: dono.optional(),
    empresa,
    revisao_em: revisaoCampo,
  })
  .strict();

const AlterarVeiculo = z
  .object({
    action: z.literal("update"),
    idempotency_key: chave,
    id: idVeiculo,
    expected_edicao: edicao,
    placa: placaCampo.optional(),
    tipo: tipo.optional(),
    modelo,
    capacidade_kg: quilos.optional(),
    capacidade_m3: metros.optional(),
    dono: dono.optional(),
    empresa,
    revisao_em: revisaoCampo,
  })
  .strict();

const AtivarVeiculo = z
  .object({
    action: z.literal("set_active"),
    idempotency_key: chave,
    id: idVeiculo,
    expected_edicao: edicao,
    ativo: z.boolean(),
  })
  .strict();

export type AcaoVeiculo =
  | {
      action: "create";
      idempotency_key: string;
      placa: string;
      tipo: string;
      modelo: string | null;
      capacidade_kg: number;
      capacidade_m3: number;
      dono: DonoDeVeiculo;
      empresa: string | null;
      revisao_em: string | null;
    }
  | {
      action: "update";
      idempotency_key: string;
      id: string;
      expected_edicao: number;
      placa?: string;
      tipo?: string;
      modelo?: string | null;
      capacidade_kg?: number;
      capacidade_m3?: number;
      dono?: DonoDeVeiculo;
      empresa?: string | null;
      revisao_em?: string | null;
    }
  | { action: "set_active"; idempotency_key: string; id: string; expected_edicao: number; ativo: boolean };

export function interpretarVeiculo(data: unknown): AcaoVeiculo {
  const entrada = parseEntrada(z.discriminatedUnion("action", [CriarVeiculo, AlterarVeiculo, AtivarVeiculo]), data);
  if (entrada.action === "create") {
    return {
      ...entrada,
      modelo: entrada.modelo ?? null,
      dono: entrada.dono ?? "proprio",
      empresa: entrada.empresa ?? null,
      revisao_em: entrada.revisao_em ?? null,
    };
  }
  if (entrada.action === "set_active") return entrada;
  const alteracao: AcaoVeiculo = {
    action: "update",
    idempotency_key: entrada.idempotency_key,
    id: entrada.id,
    expected_edicao: entrada.expected_edicao,
  };
  if (entrada.placa !== undefined) alteracao.placa = entrada.placa;
  if (entrada.tipo !== undefined) alteracao.tipo = entrada.tipo;
  if (entrada.modelo !== undefined) alteracao.modelo = entrada.modelo;
  if (entrada.capacidade_kg !== undefined) alteracao.capacidade_kg = entrada.capacidade_kg;
  if (entrada.capacidade_m3 !== undefined) alteracao.capacidade_m3 = entrada.capacidade_m3;
  if (entrada.dono !== undefined) alteracao.dono = entrada.dono;
  if (entrada.empresa !== undefined) alteracao.empresa = entrada.empresa;
  if (entrada.revisao_em !== undefined) alteracao.revisao_em = entrada.revisao_em;
  const { action: _action, idempotency_key: _chave, id: _id, expected_edicao: _edicao, ...mudancas } = alteracao;
  if (Object.keys(mudancas).length === 0) invalid("Nada para alterar.");
  return alteracao;
}

export type EfeitoVeiculo = {
  documento: VeiculoGravado;
  evento: "vehicle.created" | "vehicle.updated" | "vehicle.deactivated" | "vehicle.reactivated";
};

export function aplicarVeiculo(atual: VeiculoGravado | null, acao: AcaoVeiculo, id: string): EfeitoVeiculo {
  if (!ID_VEICULO.test(id)) throw new HttpsError("internal", "Id de veículo fora do formato.");
  if (acao.action === "create") {
    if (atual) throw new HttpsError("internal", "Criar não recebe um veículo que já existe.");
    return {
      evento: "vehicle.created",
      documento: {
        id,
        placa: acao.placa,
        tipo: acao.tipo,
        modelo: acao.modelo,
        capacidade_kg: acao.capacidade_kg,
        capacidade_m3: acao.capacidade_m3,
        ...donoConferido(acao.dono, acao.empresa),
        revisao_em: acao.revisao_em,
        ativo: true,
        edicao: 1,
      },
    };
  }
  if (!atual) throw new HttpsError("not-found", "Veículo não encontrado.");
  idConfere(atual.id, id);
  idConfere(acao.id, id);
  edicaoConfere(atual, acao.expected_edicao);
  if (acao.action === "update") {
    if (!atual.ativo) throw new HttpsError("failed-precondition", "Veículo desativado. Reative para alterar.");
    return {
      evento: "vehicle.updated",
      documento: {
        ...atual,
        placa: acao.placa ?? atual.placa,
        tipo: acao.tipo ?? atual.tipo,
        modelo: acao.modelo === undefined ? atual.modelo : acao.modelo,
        capacidade_kg: acao.capacidade_kg ?? atual.capacidade_kg,
        capacidade_m3: acao.capacidade_m3 ?? atual.capacidade_m3,
        ...donoConferido(acao.dono ?? atual.dono, acao.empresa === undefined ? atual.empresa : acao.empresa),
        revisao_em: acao.revisao_em === undefined ? atual.revisao_em : acao.revisao_em,
        edicao: atual.edicao + 1,
      },
    };
  }
  if (atual.ativo === acao.ativo) {
    throw new HttpsError("failed-precondition", acao.ativo ? "O veículo já está ativo." : "O veículo já está desativado.");
  }
  return {
    evento: acao.ativo ? "vehicle.reactivated" : "vehicle.deactivated",
    documento: { ...atual, ativo: acao.ativo, edicao: atual.edicao + 1 },
  };
}

export function conflitoDePlaca(proprioId: string | null, ids: readonly string[]): string | null {
  return ids.some((id) => id !== proprioId) ? "Já existe um veículo com esta placa." : null;
}
