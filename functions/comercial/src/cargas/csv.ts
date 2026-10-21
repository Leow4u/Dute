/**
 * Leitura de CSV das cargas do Comercial: UTF-8 (com ou sem BOM), separador
 * ";" (o do Excel em português), aspas duplas para campo com ";" ou quebra de
 * linha e "" para aspas dentro do campo. Nada de adivinhar codificação: o
 * arquivo que não é UTF-8 é recusado, com o nome do formato certo.
 */

export class ErroDoCsv extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDoCsv";
  }
}

export type LinhaDoCsv = {
  /** Número da linha no arquivo (1 é o cabeçalho), para o relatório. */
  numero: number;
  campos: string[];
};

export function decodificarUtf8(bytes: Uint8Array): string {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ErroDoCsv('O arquivo não está em UTF-8. No Excel, salve como "CSV UTF-8 (delimitado por vírgulas)".');
  }
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/** Separa o texto em linhas e campos. Linhas só com campos vazios ficam de fora. */
export function lerCsv(texto: string, separador = ";"): LinhaDoCsv[] {
  const linhas: LinhaDoCsv[] = [];
  let campos: string[] = [];
  let campo = "";
  let entreAspas = false;
  let numero = 1;
  let inicioDaLinha = 1;

  const fecharLinha = () => {
    campos.push(campo);
    if (campos.some((valor) => valor.trim() !== "")) linhas.push({ numero: inicioDaLinha, campos });
    campos = [];
    campo = "";
  };

  for (let i = 0; i < texto.length; i += 1) {
    const char = texto[i];
    if (entreAspas) {
      if (char === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreAspas = false;
        }
      } else {
        if (char === "\n") numero += 1;
        campo += char;
      }
      continue;
    }
    if (char === '"' && campo.trim() === "") {
      campo = "";
      entreAspas = true;
    } else if (char === separador) {
      campos.push(campo);
      campo = "";
    } else if (char === "\r" && texto[i + 1] === "\n") {
      // CRLF: o \n fecha a linha.
    } else if (char === "\n" || char === "\r") {
      fecharLinha();
      numero += 1;
      inicioDaLinha = numero;
    } else {
      campo += char;
    }
  }
  if (entreAspas) throw new ErroDoCsv(`linha ${inicioDaLinha}: aspas sem fechar.`);
  fecharLinha();
  return linhas;
}
