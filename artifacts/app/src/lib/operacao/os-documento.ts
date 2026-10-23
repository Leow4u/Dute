import { PAPEL_ROTULO } from "./cadastro";
import { horaDe, servicosEmTexto, type FichaDaOs, type LocalLido } from "./ficha-da-os";
import { milesimos } from "./hoje";

/**
 * A OS impressa, via operacional (docs/plataforma/fase-3-operacao.md, parte
 * 3.9d; docs/mockups/OSImpressao.dc.html): o que a equipe leva ao local e o
 * cliente assina no papel quando não há o celular. O cliente, a janela, a
 * equipe e a frota, a origem e o destino com o contato, os itens com o
 * previsto e o espaço do feito, as instruções e as assinaturas. Concluída, o
 * feito, o aceite e a assinatura entram no lugar do espaço em branco.
 *
 * Sem valor, nem do serviço nem da mercadoria (o mockup de 19/10 tinha o
 * valor da mercadoria; a Operação nunca vê valores).
 */

export type LocalNoDocumento = { endereco: string; contato: string | null };

export type ItemNoDocumento = { id: string; codigo: string | null; item: string; unidade: string; previsto: string; feito: string | null };

export type AssinaturaNoDocumento = {
  /** "Renata Campos". */
  nome: string;
  /** "Facilities · doc. 12.345.678-9 · 17:52". */
  detalhe: string;
  /** O caminho da assinatura no Storage, ou null sem aceite. */
  assinatura: string | null;
  /** "Sem aceite no local". */
  semAceite: boolean;
};

export type DocumentoDaOs = {
  numero: string;
  /** "Transporte e montagem". */
  servicos: string | null;
  /** "Emitida em 23/10/2026 às 10:52 · Em execução". */
  emissao: string;
  cliente: string;
  demanda: string;
  titulo: string | null;
  /** "22/10/2026 · 07:30–18:00". */
  janela: string | null;
  lider: string | null;
  motorista: string | null;
  /** "Carlos Silva (líder)", "Diego Alves (montador · freelancer)". */
  equipe: string[];
  /** "DEF-4G56 · VW Delivery · Baú". */
  veiculos: string[];
  origem: LocalNoDocumento | null;
  destino: LocalNoDocumento | null;
  itens: ItemNoDocumento[];
  instrucoes: string | null;
  /** O aceite colhido (OS concluída), ou null: a via vai com o espaço para assinar. */
  aceite: AssinaturaNoDocumento | null;
};

const FUSO = "America/Sao_Paulo";

function dataBrasileira(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
}

function emitidaEm(agora: Date): string {
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" }).format(agora);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
  return `${data} às ${hora}`;
}

function quantidade(valor: number): string {
  const inteiro = Math.trunc(valor / 1000);
  const resto = valor % 1000;
  return resto ? `${inteiro},${String(resto).padStart(3, "0").replace(/0+$/, "")}` : String(inteiro);
}

function local(lido: LocalLido | null): LocalNoDocumento | null {
  if (!lido) return null;
  const endereco = [lido.endereco ?? lido.nome, lido.complemento].filter(Boolean).join(" · ");
  if (!endereco) return null;
  const contato = lido.contato ? [lido.contato.nome, lido.contato.telefone].filter(Boolean).join(" · ") : null;
  return { endereco, contato };
}

/** O status vem como a tela o mostra ("Em execução": ROTULO_DO_STATUS em components/operacao/partes.tsx). */
export function documentoDaOs(ficha: FichaDaOs, contexto: { cliente: string; titulo: string | null; status: string; agora: Date }): DocumentoDaOs {
  const lider = ficha.equipe.find((pessoa) => pessoa.papel === "lider") ?? null;
  const motorista = ficha.equipe.find((pessoa) => pessoa.papel === "motorista") ?? null;
  const janela = ficha.janela
    ? [dataBrasileira(ficha.janela.data), ficha.janela.inicio ? (ficha.janela.fim ? `${ficha.janela.inicio}–${ficha.janela.fim}` : ficha.janela.inicio) : null].filter(Boolean).join(" · ")
    : null;
  const conclusao = ficha.conclusao;
  return {
    numero: ficha.numero,
    servicos: servicosEmTexto(ficha.servicos),
    emissao: `Emitida em ${emitidaEm(contexto.agora)} · ${contexto.status}`,
    cliente: contexto.cliente || ficha.clienteNome || ficha.customerCode,
    demanda: ficha.demanda,
    titulo: contexto.titulo,
    janela,
    lider: lider?.nome ?? null,
    motorista: motorista?.nome ?? null,
    equipe: ficha.equipe.map((pessoa) => {
      const papel = pessoa.papel ? PAPEL_ROTULO[pessoa.papel].toLocaleLowerCase("pt-BR") : null;
      const vinculo = pessoa.vinculo === "freelancer" ? "freelancer" : pessoa.vinculo === "terceiro" ? ["terceiro", pessoa.empresa].filter(Boolean).join(" ") : null;
      const detalhe = [papel, vinculo].filter(Boolean).join(" · ");
      return detalhe ? `${pessoa.nome} (${detalhe})` : pessoa.nome;
    }),
    veiculos: ficha.veiculos.map((veiculo) => [veiculo.placa, veiculo.modelo, veiculo.tipo, veiculo.dono === "terceiro" ? veiculo.empresa : null].filter(Boolean).join(" · ")),
    origem: local(ficha.locais.origem),
    destino: local(ficha.locais.destino),
    itens: ficha.itens.map((item) => {
      const previsto = milesimos(item.planejado) + item.incluidos.reduce((soma, inclusao) => soma + milesimos(inclusao.quantidade), 0);
      const concluida = ficha.status === "em_revisao" || ficha.status === "revisada";
      return {
        id: item.id,
        codigo: item.codigo,
        item: item.item,
        unidade: (item.unidade ?? "").toLocaleLowerCase("pt-BR"),
        previsto: quantidade(previsto),
        feito: concluida ? quantidade(item.executado ? milesimos(item.executado) : 0) : null,
      };
    }),
    instrucoes: ficha.instrucoes,
    aceite: conclusao
      ? {
          nome: conclusao.responsavel.nome,
          detalhe: [
            conclusao.aceite === "assinatura" ? conclusao.responsavel.cargo : "Recebeu",
            conclusao.aceite === "assinatura" && conclusao.responsavel.documento ? `doc. ${conclusao.responsavel.documento}` : null,
            horaDe(conclusao.instante),
          ]
            .filter(Boolean)
            .join(" · "),
          assinatura: conclusao.assinatura,
          semAceite: conclusao.aceite === "sem_aceite",
        }
      : null,
  };
}
