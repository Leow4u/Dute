import type { DocumentoDoOrcamento } from "@/lib/comercial/documento";
import { cn } from "@/lib/utils";

/**
 * O orçamento como documento A4 (docs/mockups/ComDocumento.dc.html): é o
 * que sai no PDF (Imprimir → Salvar como PDF), como a fatura
 * (components/billing/invoice-document.tsx). Não há gerador de PDF no
 * servidor; o navegador imprime só a área .print-area (index.css). É papel:
 * fica branco nos dois temas, por isso as cores fixas (PAPER_FILES em
 * lib/theme-colors.test.ts). Até o envio, a marca "Prévia".
 */

/** O e-mail do Comercial da Dutelog, o mesmo do site (artifacts/dutelog-site). */
export const EMAIL_DO_COMERCIAL = "comercial@dutelog.com.br";

const LARGURA: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  6: "col-span-6",
};

export function OrcamentoDocumento({ documento }: { documento: DocumentoDoOrcamento }) {
  return (
    <article
      aria-label={documento.titulo}
      className="print-area relative mx-auto flex w-full max-w-[794px] flex-col gap-3.5 overflow-hidden bg-white px-6 py-8 text-[13px] leading-[1.45] text-[#161616] sm:px-12 sm:py-11"
    >
      {/* A4 em pé; a margem é a do resto do app (index.css). */}
      <style>{"@media print { @page { size: A4; } }"}</style>
      {documento.previa ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[30deg] select-none text-[120px] font-extrabold uppercase tracking-[0.2em] text-[#161616]/[0.06]">
            Prévia
          </span>
        </div>
      ) : null}

      <header className="flex items-start justify-between gap-6 border-b-2 border-[#161616] pb-3.5">
        <div className="flex flex-col gap-2">
          <img src="/dutelog-logo.png" alt="Dutelog Soluções Logísticas" className="h-9 w-auto self-start" />
          <b className="block text-[13.5px] font-extrabold">Dutelog Soluções Logísticas</b>
        </div>
        <div className="flex flex-col items-end gap-1.5 text-right">
          <div className="flex items-center gap-1.5">
            {documento.previa ? (
              <span className="inline-flex h-[22px] items-center rounded-[4px] border border-[#8A4B00] bg-[#FDF0D5] px-2 text-[12px] font-extrabold uppercase tracking-[0.06em] text-[#8A4B00]">
                Prévia
              </span>
            ) : null}
            <span className="inline-flex h-[22px] items-center rounded-[4px] border border-[#CFCFCB] px-2 text-[12px] font-extrabold uppercase tracking-[0.06em] text-[#3F403F]">
              {documento.tipo}
            </span>
          </div>
          <h1 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.01em] tabular-nums">{documento.titulo}</h1>
          <span className="text-[14px] font-extrabold tabular-nums">{`Total ${documento.total}`}</span>
        </div>
      </header>

      <section
        aria-label="Dados do orçamento"
        className="grid grid-cols-6 gap-px overflow-hidden rounded-[6px] border border-[#CFCFCB] bg-[#CFCFCB]"
      >
        {documento.campos.map((campo) => (
          <div key={campo.rotulo} className={cn("min-w-0 bg-white px-3 py-[7px]", LARGURA[campo.largura])}>
            <span className="block text-[12px] font-bold leading-4 text-[#5F6368]">{campo.rotulo}</span>
            <b className="block break-words text-[13.5px] font-bold leading-[19px] tabular-nums">{campo.valor}</b>
          </div>
        ))}
      </section>

      <div className="overflow-hidden rounded-[6px] border border-[#CFCFCB]">
        <table className="w-full table-fixed border-collapse text-[12.5px]">
          <colgroup>
            <col className="w-[60px]" />
            <col />
            <col className="w-[100px]" />
            <col className="w-[52px]" />
            <col className="w-[92px]" />
            <col className="w-[44px]" />
            <col className="w-[92px]" />
          </colgroup>
          <thead>
            <tr className="bg-[#F5F5F3] text-left text-[12px] font-extrabold text-[#3F403F]">
              <th className="border-b border-[#CFCFCB] px-2 py-[7px]">Código</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[7px]">Item</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[7px]">Serviço</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[7px]">Unid.</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[7px] text-right">Valor unit.</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[7px] text-right">Qtd</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[7px] text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {documento.linhas.map((linha) => (
              <tr key={linha.chave} className="break-inside-avoid align-top font-semibold">
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 tabular-nums text-[#3F403F]">{linha.codigo}</td>
                <td className="break-words border-b border-[#E5E5E1] px-2 py-1.5">{linha.item}</td>
                <td className="break-words border-b border-[#E5E5E1] px-2 py-1.5">{linha.servico}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5">{linha.unidade}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{linha.valorUnitario}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{linha.quantidade}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{linha.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#F5F5F3]">
              <td colSpan={5} className="border-t border-[#161616] px-2 py-[9px] text-right text-[13px] font-extrabold">
                Total geral
              </td>
              <td colSpan={2} className="border-t border-[#161616] px-2 py-[9px] text-right text-[15px] font-extrabold tabular-nums">
                {documento.total}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {documento.condicoes.length ? (
        <section aria-label="Condições" className="break-inside-avoid">
          <h2 className="mb-1.5 text-[12px] font-extrabold uppercase leading-4 tracking-[0.08em] text-[#3F403F]">Condições</h2>
          <ul className="list-disc pl-[18px] text-[12.5px] font-semibold leading-[1.55]">
            {documento.condicoes.map((condicao, indice) => (
              <li key={`${indice}-${condicao}`} className="pl-0.5">
                {condicao}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-6 flex items-end justify-between gap-4 border-t border-[#CFCFCB] pt-2.5">
        <div>
          {documento.autor ? (
            <b className="block text-[13px] font-extrabold">{`Orçamento elaborado por ${documento.autor}`}</b>
          ) : null}
          <a href={`mailto:${EMAIL_DO_COMERCIAL}`} className="block text-[12px] font-bold text-[#0054CE]">
            {EMAIL_DO_COMERCIAL}
          </a>
        </div>
        <span className="text-[12px] font-bold tabular-nums text-[#5F6368]">{documento.rotulo}</span>
      </footer>
    </article>
  );
}
