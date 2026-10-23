import { horaDe, servicosEmTexto, type FichaDaOs } from "../operacao/ficha-da-os";
import { milesimos } from "../operacao/hoje";
import { quantidadeEmTexto } from "../operacao/os-documento";

/**
 * O comprovante da OS concluída no portal (docs/plataforma/fase-4-financeiro.md,
 * parte 4.3d): o que a Dutelog fez e quem recebeu, para o cliente guardar ou
 * salvar em PDF. Leva o número, o serviço, a data e a janela, os locais, o
 * motorista e a placa, os itens com o feito, quem recebeu (com a assinatura)
 * e as fotos do final. Fica de fora o que é interno, como na parte 4.3b: a
 * revisão, as ocorrências, a equipe além do motorista, o previsto e as outras
 * fotos. Sem valor, como toda OS. A vistoria não tem comprovante.
 */

export type ItemDoComprovante = { id: string; item: string; unidade: string; feito: string };

export type AceiteDoComprovante = {
  /** "Renata Campos"; sem aceite, quem recebeu, se foi dito. */
  nome: string | null;
  /** "Facilities · doc. 12.345.678-9"; sem aceite, "Sem aceite no local". */
  detalhe: string | null;
  /** O caminho da assinatura no Storage, ou null sem aceite. */
  assinatura: string | null;
};

export type ComprovanteDaOs = {
  numero: string;
  demanda: string;
  /** "Transporte e montagem", ou "Serviço" sem serviço da tabela. */
  servicos: string;
  cliente: string;
  /** "23/10/2026 · 14:00–18:00". */
  janela: string | null;
  /** "23/10/2026 às 16:30". */
  concluidaEm: string;
  origem: string | null;
  destino: string | null;
  /** "Ana Lima · DEF-4G56". */
  motorista: string | null;
  itens: ItemDoComprovante[];
  aceite: AceiteDoComprovante;
  /** Os caminhos das fotos do final no Storage. */
  fotos: string[];
};

const FUSO = "America/Sao_Paulo";

function dataBr(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
}

function diaDe(instante: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(instante));
}

function local(lido: FichaDaOs["locais"]["origem"]): string | null {
  if (!lido) return null;
  return [lido.nome, lido.endereco, lido.complemento].filter(Boolean).join(" · ") || null;
}

/** A OS tem comprovante: de serviço, concluída no local (em revisão ou revisada, como o portal a mostra). */
export function temComprovante(ficha: Pick<FichaDaOs, "tipo" | "status" | "conclusao">): boolean {
  return ficha.tipo !== "vistoria" && (ficha.status === "em_revisao" || ficha.status === "revisada") && ficha.conclusao !== null;
}

export function comprovanteDaOs(ficha: FichaDaOs, cliente: string): ComprovanteDaOs | null {
  const conclusao = ficha.conclusao;
  if (!temComprovante(ficha) || !conclusao) return null;
  const motorista = ficha.equipe.find((pessoa) => pessoa.papel === "motorista") ?? null;
  const placa = ficha.veiculos[0]?.placa ?? null;
  const janela = ficha.janela
    ? [dataBr(ficha.janela.data), ficha.janela.inicio ? (ficha.janela.fim ? `${ficha.janela.inicio}–${ficha.janela.fim}` : ficha.janela.inicio) : null].filter(Boolean).join(" · ")
    : null;
  const assinada = conclusao.aceite === "assinatura";
  const { cargo, documento } = conclusao.responsavel;
  return {
    numero: ficha.numero,
    demanda: ficha.demanda,
    servicos: servicosEmTexto(ficha.servicos) ?? "Serviço",
    cliente: cliente || ficha.clienteNome || ficha.customerCode,
    janela,
    concluidaEm: `${diaDe(conclusao.instante)} às ${horaDe(conclusao.instante)}`,
    origem: local(ficha.locais.origem),
    destino: local(ficha.locais.destino),
    motorista: [motorista?.nome ?? null, placa].filter(Boolean).join(" · ") || null,
    itens: ficha.itens.map((item) => ({
      id: item.id,
      item: item.item,
      unidade: (item.unidade ?? "").toLocaleLowerCase("pt-BR"),
      feito: quantidadeEmTexto(item.executado ? milesimos(item.executado) : 0),
    })),
    aceite: {
      nome: conclusao.responsavel.nome || null,
      detalhe: assinada ? [cargo, documento ? `doc. ${documento}` : null].filter(Boolean).join(" · ") || null : "Sem aceite no local",
      assinatura: assinada ? conclusao.assinatura : null,
    },
    fotos: conclusao.arquivosDoFinal.map((arquivo) => `os/${ficha.numero}/fotos/${arquivo}`),
  };
}

/** O comprovante na URL: /portal/servicos/comprovante?os=10045-01. */
export const ROTA_DO_COMPROVANTE = "/portal/servicos/comprovante";

export function hrefDoComprovante(numero: string): string {
  return `${ROTA_DO_COMPROVANTE}?os=${encodeURIComponent(numero)}`;
}
