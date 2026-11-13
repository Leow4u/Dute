import { uploadBytesResumable, type StorageReference, type UploadMetadata } from "firebase/storage";

import { COMPACT_ABOVE_BYTES, JPEG_QUALITY, PAGE_MAX_PIXELS, fitWithin } from "./attachment-compact";

/**
 * As fotos do celular (carregamento v2, parte 11; decisão 4 do celular, de
 * 06/11/2026): antes de subir, a foto é compactada para 2000 px no lado
 * maior, como o anexo do Agent Dute (`lib/attachment-compact.ts`), e sobe
 * por `uploadBytesResumable`, que conta os bytes. A tela mostra "3 de 4" e a
 * barra em segmentos (`components/ui/progresso.tsx`); a contagem anda por
 * foto, a barra do segmento atual, pelos bytes.
 */

/** O lado maior da foto depois de compactada: o mesmo do anexo do Agent Dute. */
export const LADO_MAIOR_DA_FOTO = PAGE_MAX_PIXELS;

/** Quantas fotos uma escolha leva de cada vez no catálogo do WMS (Receber, Contagem e a ficha do item). */
export const FOTOS_POR_VEZ = 4;

/** Os tipos que o navegador redesenha. O resto sobe como veio. */
const TIPOS_DE_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface MedidasDaFoto {
  largura: number;
  altura: number;
}

/**
 * O que fazer com a foto: `manter` como veio, `reduzir` para 2000 px no lado
 * maior, ou `recomprimir` no mesmo tamanho (a foto pequena, mas pesada). Com
 * `manterTipo`, só a JPEG muda: o caminho dela no Storage já leva a
 * extensão, e a callable confere o tipo pelo nome (as fotos da OS e os
 * anexos do portal).
 */
export function decisaoDaFoto(
  arquivo: { type: string; size: number },
  medidas: MedidasDaFoto,
  opcoes: { manterTipo?: boolean } = {},
): "manter" | "reduzir" | "recomprimir" {
  if (!TIPOS_DE_FOTO.has(arquivo.type)) return "manter";
  if (opcoes.manterTipo && arquivo.type !== "image/jpeg") return "manter";
  if (Math.max(medidas.largura, medidas.altura) > LADO_MAIOR_DA_FOTO) return "reduzir";
  if (arquivo.size > COMPACT_ABOVE_BYTES) return "recomprimir";
  return "manter";
}

/** O tamanho da foto depois de reduzida: o lado maior em 2000 px, sem nunca ampliar. */
export function medidasReduzidas(medidas: MedidasDaFoto): MedidasDaFoto {
  const escala = fitWithin(medidas.largura, medidas.altura, LADO_MAIOR_DA_FOTO);
  return { largura: Math.max(1, Math.round(medidas.largura * escala)), altura: Math.max(1, Math.round(medidas.altura * escala)) };
}

/** O que a compactação usa do navegador; os testes trocam. */
export interface DependenciasDaFoto {
  medir: (arquivo: File) => Promise<MedidasDaFoto>;
  /** Desenha a foto nas medidas e devolve a JPEG. */
  desenhar: (arquivo: File, medidas: MedidasDaFoto) => Promise<File>;
}

/**
 * A foto pronta para subir: reduzida a 2000 px no lado maior, em JPEG, ou
 * como veio, quando já é pequena, quando o tipo precisa ficar (`manterTipo`)
 * ou quando o navegador não consegue abri-la. A compactação que falha nunca
 * impede o envio.
 */
export async function compactarFoto(
  arquivo: File,
  opcoes: { manterTipo?: boolean; dependencias?: DependenciasDaFoto } = {},
): Promise<File> {
  if (!TIPOS_DE_FOTO.has(arquivo.type)) return arquivo;
  const { medir, desenhar } = opcoes.dependencias ?? dependenciasDoNavegador();
  try {
    const medidas = await medir(arquivo);
    const decisao = decisaoDaFoto(arquivo, medidas, opcoes);
    if (decisao === "manter") return arquivo;
    const pronta = await desenhar(arquivo, decisao === "reduzir" ? medidasReduzidas(medidas) : medidas);
    // A recomprimida que não ficou menor não compensa; a reduzida sempre vale (o lado maior é o combinado).
    if (!(pronta.size > 0) || (decisao === "recomprimir" && pronta.size >= arquivo.size)) return arquivo;
    return pronta;
  } catch (erro) {
    console.warn("compactarFoto: a foto sobe como veio", { nome: arquivo.name, erro });
    return arquivo;
  }
}

function nomeJpeg(nome: string): string {
  return nome.replace(/\.(jpe?g|png|webp|heic|heif)$/i, "") + ".jpg";
}

function dependenciasDoNavegador(): DependenciasDaFoto {
  return {
    async medir(arquivo) {
      const imagem = await createImageBitmap(arquivo);
      try {
        return { largura: imagem.width, altura: imagem.height };
      } finally {
        imagem.close();
      }
    },
    async desenhar(arquivo, medidas) {
      const imagem = await createImageBitmap(arquivo);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = medidas.largura;
        canvas.height = medidas.altura;
        const contexto = canvas.getContext("2d");
        if (!contexto) throw new Error("Canvas indisponível neste navegador.");
        // Fundo branco: a transparência do PNG viraria preto no JPEG.
        contexto.fillStyle = "#ffffff";
        contexto.fillRect(0, 0, canvas.width, canvas.height);
        contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, "image/jpeg", JPEG_QUALITY));
        if (!blob) throw new Error("Não consegui gerar a foto reduzida.");
        return new File([blob], nomeJpeg(arquivo.name), { type: "image/jpeg", lastModified: arquivo.lastModified });
      } finally {
        imagem.close();
      }
    },
  };
}

/** O envio foi cancelado pela tela (o prazo da foto parada, ou a pessoa). */
export class EnvioCancelado extends Error {
  constructor(mensagem = "Envio cancelado.") {
    super(mensagem);
    this.name = "EnvioCancelado";
  }
}

/** A foto que ficou 70 s sem um byte novo. */
export const FOTO_PARADA = "A foto parou de subir. Tente de novo.";

/**
 * Sobe o arquivo pelo `uploadBytesResumable` e conta os bytes: `aoProgredir`
 * recebe a fração enviada (de 0 a 1) a cada evento do SDK, nunca por quadro.
 * O `sinal` cancela o envio. Resolve quando o Storage confirma.
 */
export function enviarComProgresso(
  alvo: StorageReference,
  dados: Blob,
  metadados?: UploadMetadata,
  aoProgredir?: (fracao: number) => void,
  sinal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolver, rejeitar) => {
    if (sinal?.aborted) {
      rejeitar(new EnvioCancelado());
      return;
    }
    const tarefa = uploadBytesResumable(alvo, dados, metadados);
    const cancelar = () => tarefa.cancel();
    sinal?.addEventListener("abort", cancelar, { once: true });
    tarefa.on(
      "state_changed",
      (instantaneo) => {
        if (instantaneo.totalBytes > 0) aoProgredir?.(instantaneo.bytesTransferred / instantaneo.totalBytes);
      },
      (erro) => {
        sinal?.removeEventListener("abort", cancelar);
        rejeitar(sinal?.aborted ? new EnvioCancelado() : erro);
      },
      () => {
        sinal?.removeEventListener("abort", cancelar);
        aoProgredir?.(1);
        resolver();
      },
    );
  });
}
