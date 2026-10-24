# Fase 8: RH

Desenho e registro da Fase 8 do plano de implantação
(`plano-de-implantacao.md`, seção 10). Este runbook registra cada parte. O
plano ordena as partes. Escrito em 23/10/2026.

## Objetivo

- Os documentos, a CNH, os exames e os treinamentos de cada colaborador, com
  o vencimento avisado.
- Num banco à parte, que a operação não lê.
- A folha e o eSocial por integração (parte 8.3, com o fornecedor que o
  Leonardo escolher).

## O que existe hoje

- **O papel `rh` e o módulo `rh`** estão na lista única de `lib/dominio`
  desde a Fase 2. As callables de hoje negam o papel `rh` por padrão.
- **O cadastro operacional do colaborador** é o `collaborators` da Operação
  (Fase 3): o nome, a função, os papéis, a CNH com a validade, o telefone e o
  vínculo.
  - A rotina `runDailyAlerts` já avisa a CNH que vence, no Início da
    Operação.
  - Esse cadastro continua onde está. O RH guarda o sensível ligado ao id do
    colaborador.

## Decisões

Seguem a recomendação até a resposta do Leonardo:

| Pergunta | Recomendação seguida |
|---|---|
| 23 | `owner` e `admin` leem o RH; só `rh` grava. |
| 24 | O fornecedor da folha e do eSocial fica para a parte 8.3. |

- **O banco `rh` é um banco Firestore à parte**, no mesmo projeto, com as
  regras dele (`firestore-rh.rules`). Guarda os documentos, os exames, os
  treinamentos, o contrato de trabalho e o salário, ligados ao id do
  colaborador.
- **O navegador não lê nem grava o banco `rh`.**
  - As regras de um banco nomeado não leem o `users` do banco padrão, então
    não sabem o papel de quem pede.
  - Abrir por outro caminho, como uma claim no token ou uma cópia dos papéis
    no banco `rh`, criaria uma segunda lista de papéis, que pode divergir.
  - Quem lê e grava é a codebase `functions/rh`, pelas callables, que
    conferem o papel no `users` do banco padrão, como todas as outras.
  - O RH não tem tempo real: a tela lê pela callable e lê de novo depois de
    cada gravação.
- **Os eventos do RH ficam no `events` do próprio banco `rh`** (invariante 2).
  - O `events` do banco padrão é lido por interno, wms e suporte, e um
    evento de exame já diz coisa de saúde.
  - O evento leva o id do colaborador e o tipo, nunca o conteúdo do
    documento, o resultado do exame nem o salário.
- **Os arquivos do RH** ficam no Storage, em `rh/{colaborador}/`, fechados ao
  navegador pelas regras. Sobem e descem por URL assinada da callable, que
  confere o papel (parte 8.2).
- **Os vencimentos.**
  - Uma rotina diária da codebase `rh` (`runRhAlerts`) grava o alerta de
    exame, treinamento e documento vencendo, uma vez por item e por marco.
    Ele aparece no Início do RH.
  - A CNH segue avisada no Início da Operação, como hoje.
- **A zeragem do WMS nunca toca o banco `rh`.** O `tools/full_reset_btg.py`
  abre o banco padrão e recusa o `--database rh` (parte 8.1a).
- **Liberação própria:** `RH_AMBIENTES_LIBERADOS`, só o `dute-homolog` até o
  lançamento, com o OK do Leonardo.

## Como o banco `rh` nasce

O banco `rh` precisa existir antes de o `firebase.json` apontar para ele, e
nos dois projetos que a publicação atende: a homologação e a produção. A
publicação sobe as regras de todo banco do `firebase.json` em cada projeto.
Sem o banco, ela falha, e com ela nada mais sobe. Por isso, as partes até a
8.2 não ligam o banco nem a codebase na publicação, e a 8.1b só entra
depois de o banco existir nos dois projetos.

Criar o banco não abre nada. As regras dele negam tudo, e as callables do RH
só atendem na homologação (`RH_AMBIENTES_LIBERADOS`) até o lançamento da
fase.

Quem cria é o workflow `Banco rh` (`.github/workflows/banco-rh.yml`), por
disparo manual, um ambiente por vez. Ele roda o `tools/banco_rh.sh`:

- cria o banco em `southamerica-east1`, nativo, com proteção contra exclusão;
- liga o PITR;
- na produção, cria o backup diário de 14 dias, como o do banco padrão
  (`docs/plataforma/backup-e-recuperacao.md`);
- se o banco já existe, só confere, e liga o que faltar;
- nunca apaga nem desliga nada.

A conta do workflow é a das functions (`github-actions-functions@<projeto>`).
Criar banco exige `roles/datastore.owner`, que ela não tinha (decisão do
Leonardo em 24/10/2026: liberar a conta do CI). Quem concede é o Leonardo,
uma vez, porque só o Owner do projeto mexe em papel:

```powershell
cd C:\DEV\Dute
foreach ($p in @("dute-homolog", "dute-prod")) {
  gcloud projects add-iam-policy-binding $p --member="serviceAccount:github-actions-functions@$p.iam.gserviceaccount.com" --role=roles/datastore.owner --condition=None
}
```

Depois, Actions > Banco rh > Run workflow, primeiro com `homologacao` e
depois com `producao`. Sem o papel, o job falha dizendo qual falta, e nada é
criado.

Com o banco criado nos dois, o papel pode sair (o mesmo laço com
`remove-iam-policy-binding`). Sem ele, o workflow volta a falhar, mas a
publicação continua: ela só publica as regras do banco, e para isso bastam
os papéis que a conta já tinha.

## Partes

| Parte | Entrega | Teste que falha antes |
|---|---|---|
| 8.0 | O desenho (este documento) | — |
| 8.1a | As regras do banco `rh`, fechadas ao navegador; a codebase `functions/rh` (o perfil, a liberação, o recibo e o evento no banco `rh`); os jobs do CI. Ainda fora da publicação | Nenhum papel lê nem grava o banco `rh` pelo navegador; só `rh`, `admin` e `owner` passam pela callable, e só `rh` grava |
| 8.1b | Com o banco criado pelo workflow `Banco rh` nos dois ambientes: o `firebase.json` com o banco `rh` e a codebase `rh`; a publicação confere as regras dele; o shell do RH com o Início | A publicação recusa sem o banco; o shell só abre para `rh`, `admin` e `owner` |
| 8.2 | A ficha do colaborador: documentos, exames e treinamentos, com o vencimento; os alertas no Início do RH | O vencimento gera o alerta uma vez; o documento só abre no RH |
| 8.3 | A integração da folha e do eSocial (pergunta 24) | A exportação é idempotente |

**Pronto quando** só `rh`, `admin` e `owner` leem o RH, pela callable, e o
exame, o treinamento e o documento vencendo aparecem no Início do RH (a CNH,
no da Operação).

## Registro

### Parte 8.1a: as regras do banco `rh` e a codebase `functions/rh`

Feita em 23/10/2026. Nada entra na publicação: o `firebase.json` só ganha o
banco `rh` e a codebase na parte 8.1b, depois de o banco existir.

- **`firestore-rh.rules`** fecha o banco inteiro ao navegador, para todo
  papel, inclusive o rh, o owner e o admin.
- **A codebase `functions/rh`** (npm, como as outras):
  - `requireRhCaller` confere, nesta ordem:
    - a liberação (`RH_AMBIENTES_LIBERADOS`, só o `dute-homolog`);
    - o login e o perfil no `users` do banco padrão;
    - o papel: owner, admin e rh abrem; só o rh grava.
  - A callable `rhStatus` diz ao shell quem abre e se grava.
  - O recibo, o evento e o acesso ao banco `rh` entram na parte 8.2, com a
    primeira gravação.
- **O CI** ganha `rh-unit` e `rh-integration`, e a publicação da produção
  espera os dois.
- **A zeragem** recusa o `--database rh`.
- **As travas:**
  - `platform-lists.test.ts` trava os papéis do RH contra `lib/dominio`: os
    que têm o módulo `rh` abrem, e só o rh grava;
  - também trava a liberação.
- **Testes:**
  - `functions/wms/src/rh.rules.test.ts`: nenhum papel lê, lista, cria,
    muda nem apaga;
  - `functions/rh`: o formato das callables, os papéis, a liberação e o
    perfil no emulador;
  - `tools/test_full_reset_btg.py`: a zeragem recusa o banco do RH.

### O workflow `Banco rh` (antes da parte 8.1b)

Feito em 24/10/2026. O Leonardo pediu que o banco fosse criado sem ele rodar
os comandos e escolheu liberar a conta do CI (`roles/datastore.owner`).

- **`.github/workflows/banco-rh.yml`:** disparo manual, um ambiente por vez,
  com a conta das functions pelo Workload Identity.
- **`tools/banco_rh.sh`:**
  - cria o banco `rh` com proteção contra exclusão;
  - liga o PITR;
  - na produção, cria o backup diário de 14 dias;
  - se o banco existe, só confere e liga o que faltar;
  - falha sem mexer quando o banco está em outra região ou é de outro tipo;
  - sem o papel, falha dizendo qual falta.
- **Testes:**
  - `tools/test_banco_rh.py`: o script com um `gcloud` de mentira (criar,
    rodar de novo, homologação sem backup, sem o papel, outra região, projeto
    fora da lista);
  - `tools/test_workflows.py`: o workflow só roda por disparo manual, com os
    projetos e os números da publicação, a conta das functions e o script.
