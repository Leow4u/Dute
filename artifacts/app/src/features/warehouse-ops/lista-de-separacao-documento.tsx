import { Fragment, type ReactNode } from "react";

import { resumoDoGrupo, type FolhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";

/**
 * A lista de separação impressa (separação com caixas, parte 1b;
 * docs/mockups/WmsSepararListaImpressa.dc.html): o papel que quem separa leva
 * ao corredor, com as prateleiras na ordem de caminhada, o quadrado para
 * marcar a linha, a caixa de cada item e "Separado" em branco, para anotar a
 * quantidade diferente. O navegador imprime só a área .print-area (index.css),
 * como a OS e as etiquetas. É papel: fica branco nos dois temas, por isso as
 * cores fixas (PAPER_FILES em lib/theme-colors.test.ts).
 *
 * A lista de um pedido grande passa de uma folha: o cabeçalho da tabela se
 * repete em cada página, a linha não se parte, o cabeçalho da prateleira não
 * fica sozinho no fim da folha e a prateleira pequena não se divide entre
 * duas folhas. O rodapé de cada página ("PED-0001 · página 2 de 5") vem das
 * caixas de margem do @page, que o Chrome e o Edge imprimem; na tela, o
 * rodapé fica no fim da folha.
 */

const numero = new Intl.NumberFormat("pt-BR");

/** A prateleira com até estas linhas fica inteira numa folha; a maior quebra onde a folha acabar. */
export const LINHAS_DA_PRATELEIRA_INTEIRA = 12;

/**
 * "CX-000011 · CX-000012" na célula estreita: cada código fica inteiro na
 * linha (o navegador quebrava depois do hífen) e o separador vai junto do
 * código anterior, nunca no começo da linha.
 */
function Codigos({ partes }: { partes: readonly string[] }) {
  return (
    <>
      {partes.map((parte, indice) => (
        <Fragment key={`${indice}-${parte}`}>
          {indice ? " " : null}
          <span className="whitespace-nowrap">{indice < partes.length - 1 ? `${parte} ·` : parte}</span>
        </Fragment>
      ))}
    </>
  );
}

/** O texto dentro de uma string do CSS: sem aspas, barra nem quebra de linha. */
function textoNoCss(valor: string): string {
  return valor.replace(/["\\\n\r\f]/g, " ").trim();
}

/** O @page da folha: A4, com o rodapé de cada página nas caixas de margem. */
export function cssDaFolha(pedido: string): string {
  const rodape = "font: 600 7pt Manrope, system-ui, sans-serif; color: #5F6368;";
  return `@media print {
  @page {
    size: A4;
    margin: 12mm 12mm 16mm;
    @bottom-left { content: "app.dutelog.com.br"; ${rodape} }
    @bottom-right { content: "${textoNoCss(pedido)} · página " counter(page) " de " counter(pages); ${rodape} }
  }
}`;
}

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

export function ListaDeSeparacaoDocumento({ folha }: { folha: FolhaDaLista }) {
  return (
    <article
      aria-label={`Lista de separação ${folha.numero}`}
      className="print-area mx-auto flex w-[794px] max-w-none shrink-0 flex-col gap-3 bg-white px-10 py-[34px] text-[12px] leading-[1.4] text-[#161616]"
    >
      <style>{cssDaFolha(folha.numero)}</style>

      <header className="flex items-end justify-between gap-4 border-b-[3px] border-[#E71C23] pb-2.5">
        <img src="/dutelog-logo.png" alt="Dutelog" className="h-9 w-auto" />
        <div className="text-right">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5F6368]">Lista de separação</span>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tabular-nums">{folha.numero}</h1>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-x-3.5 gap-y-2">
        <Campo rotulo="Cliente">{folha.cliente || "—"}</Campo>
        <Campo rotulo="Destino">{folha.destino || "—"}</Campo>
        <Campo rotulo="Para quando">{folha.paraQuando || "—"}</Campo>
        <Campo rotulo="Pedido">{folha.resumo}</Campo>
        <Campo rotulo="Impressa em">{folha.impressaEm}</Campo>
        <Campo rotulo="Por">{folha.por || "—"}</Campo>
      </div>

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[24px]" />
          <col />
          <col className="w-[178px]" />
          <col className="w-[140px]" />
          <col className="w-[46px]" />
          <col className="w-[64px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              <span className="sr-only">Conferido</span>
            </th>
            <th scope="col" className={TH}>
              Produto
            </th>
            <th scope="col" className={TH}>
              Código
            </th>
            <th scope="col" className={TH}>
              Caixa
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Qtd.
            </th>
            <th scope="col" className={TH}>
              Separado
            </th>
          </tr>
        </thead>
        {folha.grupos.map((grupo) => (
          <tbody key={grupo.posicao || "sem-endereco"} className={grupo.linhas.length <= LINHAS_DA_PRATELEIRA_INTEIRA ? "break-inside-avoid" : undefined}>
            <tr className="break-inside-avoid break-after-avoid">
              <th scope="rowgroup" colSpan={6} className="bg-[#F0F0ED] p-1.5 text-left text-[11.5px] font-bold text-[#3F403F]">
                <span className="mr-2 font-mono text-[13px] font-extrabold text-[#161616]">{grupo.posicao || "sem endereço"}</span>
                {resumoDoGrupo(grupo)}
              </th>
            </tr>
            {grupo.linhas.map((linha) => (
              <tr key={linha.id} className="break-inside-avoid">
                <td className={TD}>
                  <span aria-hidden="true" className="inline-block size-[13px] rounded-[2px] border-[1.5px] border-[#161616] align-middle" />
                </td>
                <td className={`${TD} break-words text-[12.5px] font-bold`}>{linha.nome}</td>
                <td className={TD}>
                  <Codigos partes={linha.codigos.split(" · ")} />
                </td>
                <td className={TD}>
                  <Codigos partes={linha.caixas} />
                </td>
                <td className={`${TD} text-right text-[12.5px] font-extrabold tabular-nums`}>{numero.format(linha.quantidade)}</td>
                <td className={TD}>
                  <span aria-hidden="true" className="inline-block h-[13px] w-[46px] border-b border-[#161616]" />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      {/* Na impressão, o rodapé de cada página é o das caixas de margem. */}
      <footer className="no-print flex justify-between border-t border-[#E5E5E1] pt-2 text-[9.5px] font-semibold text-[#5F6368]">
        <span>app.dutelog.com.br</span>
        <span className="tabular-nums">{folha.numero}</span>
      </footer>
    </article>
  );
}
