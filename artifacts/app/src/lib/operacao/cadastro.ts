/**
 * O que a tela mostra do cadastro (docs/plataforma/fase-3-operacao.md, parte 1).
 * A validação de verdade é a callable; aqui só a leitura e o texto.
 */

export const CATEGORIAS_CNH = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;

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
  };
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
  };
}

export function porNome<T extends { ativo: boolean; nome?: string; placa?: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((esquerda, direita) => {
    if (esquerda.ativo !== direita.ativo) return esquerda.ativo ? -1 : 1;
    const a = esquerda.nome ?? esquerda.placa ?? "";
    const b = direita.nome ?? direita.placa ?? "";
    return a.localeCompare(b, "pt-BR");
  });
}
