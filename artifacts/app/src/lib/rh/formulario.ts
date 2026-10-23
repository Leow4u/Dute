import { TIPOS_POR_CATEGORIA, type Categoria, type RegistroDoRh, type ResultadoDoExame } from "./ficha";

/**
 * O formulário do registro da ficha (parte 8.2d): incluir e alterar. A tela
 * só monta o pedido; quem confere o catálogo, as datas e o resultado é a
 * callable saveRhRecord, e a mensagem dela aparece como veio.
 */

export type FormularioDoRegistro = {
  /** A chave de idempotência desta abertura do formulário. */
  chave: string;
  /** O registro que muda; null quando inclui. */
  id: string | null;
  edicao: number | null;
  categoria: Categoria;
  tipo: string;
  descricao: string;
  emitido_em: string;
  vence_em: string;
  resultado: ResultadoDoExame | "";
};

export function tiposDaCategoria(categoria: Categoria): readonly string[] {
  return TIPOS_POR_CATEGORIA[categoria];
}

/** "Emitido em" no documento; "Feito em" no exame e no treinamento. */
export function rotuloDaData(categoria: Categoria): string {
  return categoria === "documento" ? "Emitido em" : "Feito em";
}

export function formularioNovo(chave: string, categoria: Categoria = "documento"): FormularioDoRegistro {
  return { chave, id: null, edicao: null, categoria, tipo: tiposDaCategoria(categoria)[0], descricao: "", emitido_em: "", vence_em: "", resultado: "" };
}

export function formularioDoRegistro(chave: string, registro: RegistroDoRh): FormularioDoRegistro {
  return {
    chave,
    id: registro.id,
    edicao: registro.edicao,
    categoria: registro.categoria,
    tipo: registro.tipo,
    descricao: registro.descricao ?? "",
    emitido_em: registro.emitido_em,
    vence_em: registro.vence_em ?? "",
    resultado: registro.resultado ?? "",
  };
}

/** Trocar a categoria leva o primeiro tipo dela; o tipo e o resultado de antes não valem mais. */
export function comCategoria(formulario: FormularioDoRegistro, categoria: Categoria): FormularioDoRegistro {
  if (formulario.id || formulario.categoria === categoria) return formulario;
  return { ...formulario, categoria, tipo: tiposDaCategoria(categoria)[0], descricao: "", resultado: "" };
}

/** O pedido de saveRhRecord: só o que o tipo leva (o nome no "outro", o resultado no exame). */
export function pedidoDoFormulario(formulario: FormularioDoRegistro, colaboradorId: string): Record<string, unknown> {
  return {
    idempotency_key: formulario.chave,
    colaborador_id: colaboradorId,
    ...(formulario.id ? { id: formulario.id, expected_edicao: formulario.edicao } : {}),
    categoria: formulario.categoria,
    tipo: formulario.tipo,
    ...(formulario.tipo === "outro" ? { descricao: formulario.descricao } : {}),
    emitido_em: formulario.emitido_em,
    vence_em: formulario.vence_em || null,
    ...(formulario.categoria === "exame" ? { resultado: formulario.resultado || null } : {}),
  };
}

/** Os tipos de arquivo que a ficha aceita: os mesmos de functions/rh (arquivos.ts). */
export const TIPOS_DE_ARQUIVO = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const TAMANHO_MAXIMO_DO_ARQUIVO = 10 * 1024 * 1024;

/** Por que o arquivo não sobe, ou null. A mesma regra da callable, antes de pedir a URL. */
export function problemaDoArquivo(arquivo: { type: string; size: number }): string | null {
  if (!(TIPOS_DE_ARQUIVO as readonly string[]).includes(arquivo.type)) return "Envie PDF, JPG, PNG ou WebP.";
  if (arquivo.size < 1) return "O arquivo está vazio.";
  if (arquivo.size > TAMANHO_MAXIMO_DO_ARQUIVO) return "O arquivo passa de 10 MB.";
  return null;
}
