/**
 * A retenção da exportação do RH (LGPD, decisão 7 do Leonardo, 26/10/2026,
 * docs/plataforma/lgpd.md, seção 6): de cada competência, a última versão
 * fica inteira; a substituída perde as linhas (nome e CPF de cada
 * colaborador, e os exames) 30 dias depois de a versão seguinte ser gerada,
 * e fica com o hash, as contagens, quem gerou e quando. 30 dias é o "prazo
 * curto" da decisão: a contabilidade ainda pode conferir a diferença entre
 * as duas versões.
 */

export const DIAS_DA_SUBSTITUIDA = 30;

const UM_DIA_MS = 86_400_000;

export type VersaoGuardada = { id: string; competencia: string; versao: number; gerada_em: string; limpa: boolean };

export type SubstituidaParaLimpar = { id: string; competencia: string; versao: number; substituida_por: number };

/**
 * As versões substituídas há mais de DIAS_DA_SUBSTITUIDA dias que ainda têm
 * as linhas: a substituição é a versão seguinte da mesma competência.
 */
export function substituidasParaLimpar(versoes: readonly VersaoGuardada[], agora: Date): SubstituidaParaLimpar[] {
  const limite = agora.getTime() - DIAS_DA_SUBSTITUIDA * UM_DIA_MS;
  const porCompetencia = new Map<string, VersaoGuardada[]>();
  for (const versao of versoes) porCompetencia.set(versao.competencia, [...(porCompetencia.get(versao.competencia) ?? []), versao]);
  const devidas: SubstituidaParaLimpar[] = [];
  for (const [competencia, daCompetencia] of [...porCompetencia.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const emOrdem = [...daCompetencia].sort((a, b) => a.versao - b.versao);
    emOrdem.forEach((versao, indice) => {
      const seguinte = emOrdem[indice + 1];
      const substituidaEm = seguinte ? Date.parse(seguinte.gerada_em) : Number.NaN;
      if (!seguinte || versao.limpa || !(substituidaEm < limite)) return;
      devidas.push({ id: versao.id, competencia, versao: versao.versao, substituida_por: seguinte.versao });
    });
  }
  return devidas;
}
