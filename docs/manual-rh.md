# Manual do RH

Para `owner` e `admin`, que leem, e `rh`, que lê e grava. Os dados do RH
ficam num banco à parte (`dute-rh`), que o navegador não abre: tudo passa pelas
Functions do RH, com o evento de cada gravação e de cada arquivo aberto. As
telas mostram só rótulos, dados e ações; o que elas não explicam está aqui.
O desenho e o registro das partes ficam em `docs/plataforma/fase-8-rh.md`.

## O menu

| Item | O que tem |
|---|---|
| Início | O "Precisa de você": uma linha por pessoa com registro vencido ou vencendo em até 30 dias. "Abrir a ficha" leva à ficha dela. |
| Pessoas | Os colaboradores ativos no cadastro da Operação, com quantos registros, quantos vencendo, quantos vencidos, o próximo vencimento e, no vínculo próprio, a admissão e o desligamento. "Sem admissão" marca o próprio que ainda não tem a data. |
| Exportação | As planilhas do mês para a contabilidade. |

## A ficha

Os registros da pessoa, em três categorias:

- **Documentos:** RG, CPF, CTPS, PIS, título de eleitor, reservista,
  comprovante de residência, contrato de trabalho e outro.
- **Exames:** os ASO admissional, periódico, de retorno ao trabalho, de
  mudança de função e demissional, e outro; com o resultado (apto, apto com
  restrição ou inapto).
- **Treinamentos:** NR-06, NR-10, NR-11, NR-12, NR-18, NR-35, direção
  defensiva, primeiros socorros, integração e outro.

O que vale saber:

- **O vigente** é o registro mais novo de cada tipo. No empate da data de
  emissão, vale o lançado por último, mesmo que vença antes: para corrigir um
  registro, lance-o de novo ou use "Alterar".
- **Os exames ocupacionais** (admissional, periódico, retorno ao trabalho e
  mudança de função) são um grupo só: vale o ASO mais recente de qualquer
  deles, como na NR-7. Depois do periódico, o admissional fica substituído e
  sai do "Precisa de você". O demissional e o "outro" ficam à parte.
- **O vencimento** entra no "Precisa de você" 30 dias antes e fica até a
  pessoa ter um registro novo. A rotina diária grava o vencido uma vez, como
  evento.
- **As datas** vão de 1900 a 2100.
- **Arquivar** tira o registro do vigente e o guarda no histórico; ele
  ainda abre, mas não recebe arquivo.
- **O arquivo** (PDF, JPG, PNG ou WebP, até 10 MB) sobe pela tela e é
  conferido antes de entrar no registro. O arquivo trocado continua guardado.
  Cada abertura fica registrada: quem abriu e quando.
- **A CNH** fica no cadastro do colaborador, na Operação, com o aviso no
  Início da Operação.
- **As datas do vínculo**, só no vínculo próprio: "Datas do vínculo" abre a
  admissão e o desligamento, e só o `rh` grava.
  - A admissão é obrigatória. O desligamento pode ficar vazio e não pode vir
    antes dela.
  - Gravar o desligamento não tira a pessoa da escala: quem a inativa na
    Operação é a coordenação.
  - As datas decidem quem entra na planilha de colaboradores de cada mês.

## A exportação para a contabilidade

A contabilidade faz a folha e transmite o eSocial. A Dute entrega, por
competência, duas planilhas CSV que abrem no Excel em português:

- **Exames:** os ASO do mês das pessoas com vínculo próprio, fora os
  arquivados, com nome, CPF, função, o exame, o código `tpExameOcup` do
  S-2220, a data do ASO, o resultado, o código `resAso` e o vencimento.
- **Colaboradores:** as pessoas com vínculo próprio que tiveram vínculo no
  mês, com nome, CPF, função, admissão, desligamento e a situação no mês.
  - Com a data de admissão, entra quem foi admitido até o último dia do mês
    e, se desligado, desligado a partir do primeiro. Quem entrou depois não
    aparece num mês passado.
  - A situação no mês é Ativo, Admissão no mês, Desligamento no mês, ou
    Admissão e desligamento no mês.
  - Quem ainda está sem a data de admissão entra como antes: se está ativo
    no cadastro da Operação, como Ativo; se está inativo, só com exame no
    mês, como Inativo.
  - O desligamento é do RH, e a inativação, da coordenação: quem a
    coordenação desativou na Operação continua na planilha até o RH gravar
    o desligamento.

Os códigos do S-2220:

| Exame | `tpExameOcup` |
|---|---|
| Admissional | 0 |
| Periódico | 1 |
| Retorno ao trabalho | 2 |
| Mudança de função | 3 |
| Outro | 4 |
| Demissional | 9 |

| Resultado | `resAso` |
|---|---|
| Apto e apto com restrição | 1 |
| Inapto | 2 |

- **"Gerar exportação"** é só do `rh`. A competência começa no mês anterior.
  Gerar de novo sem nada mudado devolve a versão de antes; com mudança, nasce
  a versão seguinte (v2, v3), e as anteriores continuam na lista.
  - O nome e a função saem do cadastro de hoje, mas sozinhos não criam
    versão nova: um mês já exportado não muda porque o nome mudou depois.
    Uma versão nova, por outra mudança, leva o nome de hoje.
  - As versões geradas antes das colunas de admissão e de desligamento
    baixam com as colunas de então (nome, CPF, função e situação). A
    primeira exportação de um mês já exportado, depois delas, nasce numa
    versão nova.
- **Sem data de admissão:** abaixo do Gerar, o `rh` vê quem é próprio, está
  ativo e ainda não tem a data de admissão, com o link da ficha. Até a data
  ser gravada, a pessoa entra na planilha pela regra do cadastro.
- **Baixar** é de `owner`, `admin` e `rh`. A planilha sai da versão
  guardada, e cada download fica registrado.
