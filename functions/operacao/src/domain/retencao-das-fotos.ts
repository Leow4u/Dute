/**
 * A retenção das fotos da OS (LGPD, decisão 2 do Leonardo, 26/10/2026,
 * docs/plataforma/lgpd.md, seção 6, parte 2): as fotos das etapas, das
 * ocorrências e da vistoria saem 12 meses depois de a OS ficar revisada.
 *
 * Ficam, pela decisão 1 (prazo maior, que o Leonardo ainda fixa), a
 * assinatura e as fotos do final da OS de serviço: a etapa `fim`, que é o
 * que vai ao comprovante (`conclusao.arquivos_do_final`). A OS com
 * divergência cobrada ou aditivo fica com todas: a foto não aponta para a
 * linha da revisão, e qualquer uma pode ser a prova da cobrança.
 */

export const MESES_DAS_FOTOS = 12;

/** O instante antes do qual a revisão deixa as fotos saírem: o mesmo dia, 12 meses antes. */
export function limiteDasFotos(agora: Date): Date {
  const limite = new Date(agora.getTime());
  limite.setUTCMonth(limite.getUTCMonth() - MESES_DAS_FOTOS);
  return limite;
}

type Registro = Record<string, unknown>;

function registro(valor: unknown): Registro {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Registro) : {};
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** Quando a OS ficou revisada: a revisão, na OS de serviço; o envio ao Comercial, na vistoria. */
export function revisadaEm(os: Registro): string | null {
  if (os.status !== "revisada") return null;
  const instante = os.tipo === "vistoria" ? texto(registro(os.vistoria).registrado_em) : texto(registro(os.revisao).instante);
  return instante && !Number.isNaN(Date.parse(instante)) ? instante : null;
}

const DECISOES_COBRADAS = ["cobrar", "aditivo"];

/** A revisão de agora, ou uma de antes da reabertura, cobrou divergência ou pediu aditivo. */
export function teveCobranca(os: Registro): boolean {
  const revisoes = [os.revisao, ...lista(os.revisoes_anteriores).map((anterior) => registro(anterior).revisao)].map(registro);
  return revisoes.some(
    (revisao) =>
      lista(revisao.aditivo).length > 0 || lista(revisao.linhas).some((linha) => DECISOES_COBRADAS.includes(texto(registro(linha).decisao))),
  );
}

const ARQUIVO_DA_FOTO = /^ft_[a-f0-9]{16}\.(?:jpg|png|webp)$/;

export type FotosSeparadas = { saem: Registro[]; ficam: Registro[]; protegida: boolean };

/**
 * As fotos que saem e as que ficam. Só sai o arquivo da própria OS, no
 * caminho das fotos (`os/{numero}/fotos/ft_…`): a entrada com outro
 * caminho fica como está.
 */
export function separarFotos(os: Registro, numero: string): FotosSeparadas {
  const fotos = lista(os.fotos).map(registro);
  const vistoria = os.tipo === "vistoria";
  if (!vistoria && teveCobranca(os)) return { saem: [], ficam: fotos, protegida: true };
  const doFinal = new Set(lista(registro(os.conclusao).arquivos_do_final).map(texto));
  const pasta = `os/${numero}/fotos/`;
  const saem: Registro[] = [];
  const ficam: Registro[] = [];
  for (const foto of fotos) {
    const caminho = texto(foto.caminho);
    const arquivo = caminho.startsWith(pasta) ? caminho.slice(pasta.length) : "";
    const daOs = ARQUIVO_DA_FOTO.test(arquivo);
    const doFinalDaOs = !vistoria && (foto.etapa === "fim" || doFinal.has(arquivo));
    (daOs && !doFinalDaOs ? saem : ficam).push(foto);
  }
  return { saem, ficam, protegida: false };
}
