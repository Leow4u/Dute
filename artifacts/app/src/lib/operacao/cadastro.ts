/**
 * O que a tela mostra do cadastro (docs/plataforma/fase-3-operacao.md, parte 1).
 * A validação de verdade é a callable; aqui só a leitura e o texto.
 */

export const CATEGORIAS_CNH = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;

/** Iguais às de functions/operacao (domain/cadastro.ts), parte 3.4. */
export const VINCULOS = ["proprio", "freelancer", "terceiro"] as const;
export type Vinculo = (typeof VINCULOS)[number];
export const PAPEIS_DE_CAMPO = ["lider", "motorista", "montador", "ajudante"] as const;
export type PapelDeCampo = (typeof PAPEIS_DE_CAMPO)[number];
export const DONOS_DE_VEICULO = ["proprio", "terceiro"] as const;
export type DonoDeVeiculo = (typeof DONOS_DE_VEICULO)[number];

export const VINCULO_ROTULO: Record<Vinculo, string> = { proprio: "Equipe própria", freelancer: "Freelancer", terceiro: "Terceiro" };
export const PAPEL_ROTULO: Record<PapelDeCampo, string> = { lider: "Líder", motorista: "Motorista", montador: "Montador", ajudante: "Ajudante" };
export const DONO_ROTULO: Record<DonoDeVeiculo, string> = { proprio: "Próprio", terceiro: "Terceiro" };

export type ColaboradorDaLista = {
  id: string;
  edicao: number;
  ativo: boolean;
  nome: string;
  funcao: string;
  cpf: string;
  telefone: string;
  cnhCategoria: string;
  cnhValidade: string;
  cnh: string | null;
  vinculo: Vinculo;
  /** A empresa do terceiro, ou vazio. */
  empresa: string;
  papeis: PapelDeCampo[];
  /** O e-mail do login do app ligado à pessoa, ou vazio. */
  usuarioEmail: string;
  /** O login do app está ligado (a pessoa vê as próprias OS no campo). */
  noApp: boolean;
};

export type VeiculoDaLista = {
  id: string;
  edicao: number;
  ativo: boolean;
  placa: string;
  tipo: string;
  modelo: string;
  capacidadeKg: string;
  capacidadeM3: string;
  resumo: string;
  dono: DonoDeVeiculo;
  empresa: string;
  /** Próxima revisão (AAAA-MM-DD), ou vazio. */
  revisaoEm: string;
};

export function formatarCpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return value.trim();
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatarPlaca(value: string): string {
  const placa = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(placa)) return `${placa.slice(0, 3)}-${placa.slice(3)}`;
  if (/^[A-Z]{3}[0-9]{4}$/.test(placa)) return `${placa.slice(0, 3)}-${placa.slice(3)}`;
  return value.trim();
}

export function formatarData(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function texto(data: Record<string, unknown>, campo: string): string {
  const value = data[campo];
  return typeof value === "string" ? value.trim() : "";
}

export function colaboradorDaLeitura(id: string, data: Record<string, unknown>): ColaboradorDaLista | null {
  const nome = texto(data, "nome");
  const funcao = texto(data, "funcao");
  const cpf = texto(data, "cpf");
  if (!nome || !funcao || !cpf || typeof data.edicao !== "number" || typeof data.ativo !== "boolean") return null;
  const cnh = data.cnh;
  const categoria = cnh && typeof cnh === "object" && typeof (cnh as { categoria?: unknown }).categoria === "string"
    ? (cnh as { categoria: string }).categoria
    : "";
  const validade = cnh && typeof cnh === "object" && typeof (cnh as { validade?: unknown }).validade === "string"
    ? (cnh as { validade: string }).validade
    : "";
  return {
    id,
    edicao: data.edicao,
    ativo: data.ativo,
    nome,
    funcao,
    cpf: formatarCpf(cpf),
    telefone: texto(data, "telefone"),
    cnhCategoria: categoria,
    cnhValidade: validade,
    cnh: categoria && validade ? `${categoria} · ${formatarData(validade)}` : null,
    vinculo: (VINCULOS as readonly string[]).includes(String(data.vinculo)) ? (data.vinculo as Vinculo) : "proprio",
    empresa: texto(data, "empresa"),
    papeis: Array.isArray(data.papeis) ? PAPEIS_DE_CAMPO.filter((papel) => (data.papeis as unknown[]).includes(papel)) : [],
    usuarioEmail: texto(data, "usuario_email"),
    noApp: Boolean(texto(data, "usuario_uid")),
  };
}

/**
 * O que a linha da lista diz da pessoa: função, vínculo (com a empresa do
 * terceiro), papéis e o app. O papel com o mesmo nome da função não se repete.
 */
export function resumoDoColaborador(item: ColaboradorDaLista): string {
  const vinculo = item.vinculo === "proprio" ? null : item.vinculo === "terceiro" && item.empresa ? `Terceiro · ${item.empresa}` : VINCULO_ROTULO[item.vinculo];
  const funcao = item.funcao.toLocaleLowerCase("pt-BR");
  const rotulos = item.papeis.map((papel) => PAPEL_ROTULO[papel]).filter((rotulo) => rotulo.toLocaleLowerCase("pt-BR") !== funcao);
  const papeis = rotulos.length ? rotulos.join(", ") : null;
  return [item.funcao, vinculo, papeis, item.cpf, item.cnh, item.noApp ? "no app" : null].filter(Boolean).join(" · ");
}

/**
 * O e-mail do app na alteração: só quando muda (minúsculas, sem espaço nas
 * pontas). Sem mudança, a chave fica de fora e o login ligado continua como
 * está; mandar o mesmo e-mail faria a callable conferir o usuário de novo.
 * Vazio desliga (null).
 */
export function emailDoAppNaAlteracao(atual: string, digitado: string): { usuario_email: string | null } | Record<string, never> {
  const novo = digitado.trim().toLowerCase() || null;
  const antes = atual.trim().toLowerCase() || null;
  return novo === antes ? {} : { usuario_email: novo };
}

export function veiculoDaLeitura(id: string, data: Record<string, unknown>): VeiculoDaLista | null {
  const placa = texto(data, "placa");
  const tipo = texto(data, "tipo");
  if (!placa || !tipo || typeof data.edicao !== "number" || typeof data.ativo !== "boolean") return null;
  if (typeof data.capacidade_kg !== "number" || typeof data.capacidade_m3 !== "number") return null;
  const modelo = texto(data, "modelo");
  const capacidadeKg = String(data.capacidade_kg);
  const capacidadeM3 = String(data.capacidade_m3);
  return {
    id,
    edicao: data.edicao,
    ativo: data.ativo,
    placa: formatarPlaca(placa),
    tipo,
    modelo,
    capacidadeKg,
    capacidadeM3,
    resumo: [modelo, `${capacidadeKg} kg`, `${capacidadeM3} m³`].filter(Boolean).join(" · "),
    dono: (DONOS_DE_VEICULO as readonly string[]).includes(String(data.dono)) ? (data.dono as DonoDeVeiculo) : "proprio",
    empresa: texto(data, "empresa"),
    revisaoEm: texto(data, "revisao_em"),
  };
}

/**
 * A capacidade do veículo como a pessoa digita: os quilos inteiros, com ou
 * sem o ponto do milhar ("6.000" e "6000" são 6000), e os metros cúbicos com
 * a vírgula ("12,5"). O que não é número vai null, e a callable recusa com a
 * mensagem dela ("Informe a capacidade em quilos.").
 */
export function capacidadeDigitada(kg: string, m3: string): { capacidade_kg: number | null; capacidade_m3: number | null } {
  const quilos = kg.trim();
  const inteiro = /^\d+$/.test(quilos) ? quilos : /^\d{1,3}(\.\d{3})+$/.test(quilos) ? quilos.replace(/\./g, "") : null;
  const metros = m3.trim().replace(",", ".");
  return {
    capacidade_kg: inteiro === null ? null : Number(inteiro),
    capacidade_m3: metros && Number.isFinite(Number(metros)) ? Number(metros) : null,
  };
}

/** O que a linha da lista diz do veículo: modelo e capacidade, a empresa do terceiro e a próxima revisão. */
export function resumoDoVeiculo(item: VeiculoDaLista): string {
  const dono = item.dono === "terceiro" ? `Terceiro${item.empresa ? ` · ${item.empresa}` : ""}` : null;
  return [item.resumo, dono, item.revisaoEm ? `revisão ${formatarData(item.revisaoEm)}` : null].filter(Boolean).join(" · ");
}

export function porNome<T extends { ativo: boolean; nome?: string; placa?: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((esquerda, direita) => {
    if (esquerda.ativo !== direita.ativo) return esquerda.ativo ? -1 : 1;
    const a = esquerda.nome ?? esquerda.placa ?? "";
    const b = direita.nome ?? direita.placa ?? "";
    return a.localeCompare(b, "pt-BR");
  });
}
