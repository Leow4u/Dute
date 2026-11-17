import type { ReactNode } from "react";

import { LINHAS_DA_PRATELEIRA_INTEIRA, cssDaFolha } from "@/features/warehouse-ops/lista-de-separacao-documento";
import { prateleiraDifere, resumoDaPrateleira, textoCaixasSaldo, type CaixaDaFolha, type FolhaDeContagem, type LinhaDaFolha, type PrateleiraDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";

/**
 * A folha de contagem por rua, para imprimir (docs/mockups/WmsContagemFolha
 * .dc.html; diagnóstico da Contagem cíclica, seção 6, item 1): o papel que
 * quem conta leva ao corredor, com as prateleiras na ordem de caminhada e, por
 * caixa guardada, uma linha por produto com o que entrou, o que a separação
 * tirou, o esperado e a reserva, e "Contado" em branco; uma linha "Fora da
 * lista" por prateleira; e, no cabeçalho de cada prateleira, caixas × saldo,
 * em vermelho quando não fecham. Sem valores em lugar nenhum. É papel: fica
 * branco nos dois temas, por isso as cores fixas (PAPER_FILES em
 * lib/theme-colors.test.ts). O navegador imprime só a .print-area, como a
 * lista de separação, e o rodapé de cada página vem das caixas de margem do
 * @page ("Rua A · página 2 de 5").
 */

const numero = new Intl.NumberFormat("pt-BR");

/** O texto da caixa com o destino confirmado que ainda não chegou à prateleira. */
export const A_CAMINHO = "a caminho";
/** O texto da linha do saldo do razão que nenhuma caixa guardada tem. */
export const SEM_CAIXA = "sem caixa";
/** O texto da caixa guardada sem conteúdo registrado. */
export const SEM_CONTEUDO_REGISTRADO = "sem conteúdo registrado";
/** A linha em branco de cada prateleira, para o que a folha não lista. */
export const FORA_DA_LISTA = "Fora da lista";

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9.5px] font-bold uppercase leading-4 tracking-[0.04em] text-[#5F6368]">{rotulo}</span>
      <b className="block break-words text-[12.5px] font-bold leading-[18px]">{children}</b>
    </div>
  );
}

const TH = "border-b-[1.5px] border-[#161616] p-1.5 text-left text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-[#5F6368]";
const TD = "border-b border-[#D9D9D4] px-1.5 py-[5px] align-middle text-[11px]";
const NUMERO = `${TD} text-right text-[12px] font-bold tabular-nums whitespace-nowrap`;

/** A linha para escrever à mão: desenho, fora da leitura. */
function Branco({ className = "w-full" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block h-[14px] border-b border-[#161616] align-middle ${className}`} />;
}

function Numero({ valor }: { valor: number | null }) {
  return <td className={NUMERO}>{valor == null ? "—" : numero.format(valor)}</td>;
}

function Linha({ linha, caixa }: { linha: LinhaDaFolha; caixa: ReactNode }) {
  return (
    <tr className="break-inside-avoid">
      <td className={`${TD} whitespace-nowrap font-mono text-[11px] font-bold`}>{caixa}</td>
      <td className={`${TD} break-words text-[11.5px] font-bold`}>{linha.nome}</td>
      <td className={`${TD} whitespace-nowrap leading-[1.25]`}>
        {linha.codigo ? <span className="block">{linha.codigo}</span> : null}
        {linha.sku && linha.sku !== linha.codigo ? <span className="block">{linha.sku}</span> : null}
      </td>
      <Numero valor={linha.entrou} />
      <Numero valor={linha.saiu} />
      <td className={`${NUMERO} text-[12.5px] font-extrabold`}>{numero.format(linha.esperado)}</td>
      <td className={NUMERO}>{linha.reserva > 0 ? numero.format(linha.reserva) : "—"}</td>
      <td className={TD}>
        <Branco />
      </td>
    </tr>
  );
}

function Caixa({ caixa }: { caixa: CaixaDaFolha }) {
  const codigo = caixa.aCaminho ? (
    <>
      <span className="block">{caixa.code}</span>
      <span className="block font-sans text-[9.5px] font-bold text-[#5F6368]">{A_CAMINHO}</span>
    </>
  ) : (
    caixa.code
  );
  if (!caixa.linhas.length) {
    return (
      <tr className="break-inside-avoid">
        <td className={`${TD} whitespace-nowrap font-mono text-[11px] font-bold`}>{codigo}</td>
        <td className={`${TD} text-[10.5px] font-bold text-[#5F6368]`} colSpan={2}>
          {SEM_CONTEUDO_REGISTRADO}
        </td>
        <td className={NUMERO}>—</td>
        <td className={NUMERO}>—</td>
        <td className={`${NUMERO} text-[12.5px] font-extrabold`}>{numero.format(caixa.esperado)}</td>
        <td className={NUMERO}>—</td>
        <td className={TD}>
          <Branco />
        </td>
      </tr>
    );
  }
  return (
    <>
      {caixa.linhas.map((linha) => (
        <Linha key={`${caixa.code}-${linha.sku}`} linha={linha} caixa={codigo} />
      ))}
    </>
  );
}

/** Quantas linhas a prateleira ocupa: as das caixas (a caixa sem conteúdo é uma), as sem caixa e a "Fora da lista". */
function linhasDaPrateleira(prateleira: PrateleiraDaContagem): number {
  return prateleira.caixas.reduce((soma, caixa) => soma + Math.max(1, caixa.linhas.length), 0) + prateleira.semCaixa.length + 1;
}

function Prateleira({ prateleira }: { prateleira: PrateleiraDaContagem }) {
  const difere = prateleiraDifere(prateleira);
  return (
    <tbody className={linhasDaPrateleira(prateleira) <= LINHAS_DA_PRATELEIRA_INTEIRA ? "break-inside-avoid" : undefined}>
      <tr className="break-inside-avoid break-after-avoid">
        <th scope="rowgroup" colSpan={8} className="bg-[#F0F0ED] p-1.5 text-left text-[11.5px] font-bold text-[#3F403F]">
          <span className="flex items-baseline justify-between gap-3">
            <span>
              <span className="mr-2 font-mono text-[13px] font-extrabold text-[#161616]">{prateleira.posicao}</span>
              {resumoDaPrateleira(prateleira)}
            </span>
            <span className={`whitespace-nowrap font-extrabold ${difere ? "text-[#8E1016]" : "text-[#161616]"}`}>{textoCaixasSaldo(prateleira)}</span>
          </span>
        </th>
      </tr>
      {prateleira.caixas.map((caixa) => (
        <Caixa key={caixa.code} caixa={caixa} />
      ))}
      {prateleira.semCaixa.map((linha) => (
        <Linha key={`sem-caixa-${linha.sku}`} linha={linha} caixa={<span className="font-sans text-[10.5px] text-[#5F6368]">{SEM_CAIXA}</span>} />
      ))}
      <tr className="break-inside-avoid text-[10.5px] font-bold text-[#5F6368]">
        <td className={TD}>{FORA_DA_LISTA}</td>
        <td className={TD}>
          <Branco />
        </td>
        <td className={TD}>
          <Branco />
        </td>
        <td className={TD} />
        <td className={TD} />
        <td className={TD} />
        <td className={TD} />
        <td className={TD}>
          <Branco />
        </td>
      </tr>
    </tbody>
  );
}

export function FolhaDeContagemDocumento({ folha }: { folha: FolhaDeContagem }) {
  return (
    <article
      aria-label={`Folha de contagem ${folha.titulo}`}
      className="print-area mx-auto flex w-[794px] max-w-none shrink-0 flex-col gap-3 bg-white px-10 py-[34px] text-[12px] leading-[1.4] text-[#161616]"
    >
      <style>{cssDaFolha(folha.titulo)}</style>

      <header className="flex items-end justify-between gap-4 border-b-[3px] border-[#E71C23] pb-2.5">
        <img src="/dutelog-logo.png" alt="Dutelog" className="h-9 w-auto" />
        <div className="text-right">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5F6368]">Folha de contagem</span>
          <h1 className="text-[30px] font-extrabold leading-[1.05]">{folha.titulo}</h1>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-x-3.5 gap-y-2">
        <Campo rotulo="Cliente">{folha.cliente || "—"}</Campo>
        <Campo rotulo="Rodada">{folha.rodada}</Campo>
        <Campo rotulo="Prateleiras">{folha.prateleiras}</Campo>
        <Campo rotulo="Impressa em">{folha.impressaEm}</Campo>
        <Campo rotulo="Por">{folha.por || "—"}</Campo>
      </div>

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[70px]" />
          <col />
          <col className="w-[132px]" />
          <col className="w-[46px]" />
          <col className="w-[40px]" />
          <col className="w-[58px]" />
          <col className="w-[52px]" />
          <col className="w-[96px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Caixa
            </th>
            <th scope="col" className={TH}>
              Produto
            </th>
            <th scope="col" className={TH}>
              Código
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Entrou
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Saiu
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Esperado
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Reserva
            </th>
            <th scope="col" className={TH}>
              Contado
            </th>
          </tr>
        </thead>
        {folha.grupos.map((prateleira) => (
          <Prateleira key={prateleira.posicao} prateleira={prateleira} />
        ))}
      </table>

      {/* Na impressão, o rodapé de cada página é o das caixas de margem. */}
      <footer className="no-print flex justify-between border-t border-[#E5E5E1] pt-2 text-[9.5px] font-semibold text-[#5F6368]">
        <span>app.dutelog.com.br</span>
        <span>{folha.titulo}</span>
      </footer>
    </article>
  );
}
