# Operação completa: roteiro para publicar no `dute-prod`

Escrito na parte 3.14 (23/10/2026), no fim da Fase 3. É o marco 3 do plano de
implantação ("Operação completa"). A publicação na produção espera o OK do
Leonardo; nada aqui é disparado sem ele. Sem dado real neste arquivo.

## 1. Estado de hoje

- **Na `main`.** As partes 3.0 a 3.13b, com o desenho e o registro de cada uma
  em `fase-3-operacao.md`:
  - demanda direta;
  - planejar com várias OS;
  - Agenda;
  - execução pelo escritório e pelo celular, com a fila sem sinal;
  - fotos e assinatura no dedo;
  - revisão com divergência;
  - aditivo e orçamento da execução no Comercial;
  - vistoria como OS;
  - TV da sala;
  - rotina diária e alertas.
- **Liberação.** `OPERACAO_AMBIENTES_LIBERADOS` já inclui `dute-homolog` e
  `dute-prod`, no app e nas Functions. O Leonardo deu o OK em 22/10 e, em
  23/10, disse: "pode deixar ligada, não tem ninguém usando o sistema". O
  `dute-btg` recusa.
- **Última publicação de produção.** Foi o commit `fde9ba0` (PR 177), em 23/10 às 02:16
  UTC. Desde então entraram 46 merges:
  - a Fase 2 inteira: shell v3 por módulo, Inícios, entrada com contadores e barreira por módulo;
  - o fechamento do Comercial: contador das demandas, cabeçalho do PDF e as pendências da conferência;
  - a Fase 3 da parte 3.4a à 3.13b.
  - Confirmar a base antes de disparar.
- **Ciclo conferido no emulador.** O teste é `functions/operacao/src/domain/ciclo.integration.test.ts`:
  - a demanda direta vai do pedido a duas OS, à execução no celular com item a mais, à assinatura, à revisão e a Execução a orçar;
  - a do Comercial vai do escopo fechado à OS, ao item a mais e ao aditivo pedido;
  - a TV mostra a agendada de manhã e a assinada no fim do dia;
  - nenhuma OS guarda preço, total ou valor.

## 2. O que muda no `dute-prod` só por publicar a `main`

- **Regras do Firestore.**
  - O campo lê só a OS em que está escalado (`equipe_uids`).
  - O campo lê o catálogo sem preço (`lpu_items`), para incluir item em campo.
  - O cliente com a Operação contratada lê as próprias OS.
  - O painel continua sem ler nenhuma coleção.
- **Regras do Storage.** Entram as fotos e a assinatura da OS (`os/{numero}/fotos/`, `os/{numero}/assinatura`):
  - gravam o campo escalado e a coordenação;
  - o comercial lê as fotos da OS de vistoria, e só dela.
- **Índices.** Nenhum índice novo (`firestore.indexes.json` não mudou).
- **Functions da Operação** (codebase `operacao`).
  - São 14 callables. As novas desde `fde9ba0`:
    - `openDirectDemand`, `registerStep`, `registerItem`, `registerOccurrence`, `attachPhoto` e `registerPresence`;
    - `completeServiceOrder`, `reviewServiceOrder` e `reopenServiceOrder`;
    - `sendSurveyToCommercial` e `getRoomBoard`.
  - A primeira function agendada, `runDailyAlerts`. O deploy cria o job do Cloud Scheduler: todo dia às 06:00 de São Paulo.
- **Functions do Comercial.** As mesmas 12 callables, com o que a Operação pede: o aditivo, o orçamento da execução e a vistoria no orçamento.
- **Functions do WMS.** O código não mudou, só os testes de regras.
- **Frontend.**
  - O shell v3 por módulo, com o seletor no topo e os Inícios.
  - A Operação inteira em `/operacao`.
  - O app do campo em `/campo`.
  - A TV em `/tv`.
- **Dados.** Nada é migrado. A OS de antes da parte 3.4 é lida pelo modelo novo, e o teste cobre isso.
- **Papéis.** Nenhum usuário de hoje tem `campo` ou `painel`, então nada muda para quem já entra.
- **Conferência do invoker.** Passa a conferir 106 callables: 80 do WMS, 12 do Comercial e 14 da Operação.

## 3. Antes de publicar (conferir na homologação)

Com o HEAD da `main` verde e publicado no `dute-homolog`, use um owner, um
interno, um login `campo` ligado a um colaborador (Operação › Colaboradores,
e-mail do app) e um login `painel`:

1. **Demanda direta.** Abrir por Nova demanda. Planejar duas OS, uma agendada com equipe e veículo.
2. **No celular.** Com o login `campo`:
   - registrar as etapas, o item e uma inclusão em campo;
   - tirar a foto do final;
   - concluir com a assinatura no dedo.
   - Repetir uma vez sem sinal (modo avião) e conferir que a fila envia ao voltar.
3. **Revisão.** Decidir a divergência. A demanda vai a Execução a orçar, e o Comercial vê o "Orçar a execução".
4. **Demanda do Comercial.** Com o escopo fechado, a OS com item a mais vira aditivo pedido no Comercial.
5. **Vistoria.**
   - Planejar pela demanda em montagem e enviar pelo celular.
   - No orçamento, "Carregar itens no orçamento" põe os itens pela tabela.
6. **TV.** Entrar com o `painel`: abre direto em `/tv`, escura. Ela mostra a agendada, a em execução e a concluída. Esperar 30 segundos e ver o relógio e a leitura andarem.
7. **Alertas.**
   - Pôr a revisão de um veículo para amanhã e ver o item no Início.
   - Tentar escalar o veículo no dia da revisão: não deixa.
   - Rodar a rotina uma vez (passo 5.2, com `dute-homolog`) e conferir os dois eventos em `events`.
8. **Valores.** Com o owner, nenhuma tela da Operação mostra valor.

## 4. Publicar

1. **Base.** HEAD da `main` com CI verde e a homologação publicada nele.
2. **Backup.** PITR de 7 dias e backup diário ligados (`backup-e-recuperacao.md`). Anotar o instante de antes do deploy.
3. **Janela.** Combinar com a contagem de abertura da BTG, que roda no `dute-prod`. O deploy de functions leva de 11 a 15 minutos.
4. **Disparo.** Actions > CI > Run workflow, com `publicar_producao` marcado, do HEAD. O job só vale verde com as conferências do fim:
   - `check_rules_deployed.sh`;
   - o invoker das 106 callables;
   - `check_frontend_deployed.sh`;
   - o smoke.

## 5. Depois de publicar

1. **O job da rotina existe:**

   ```powershell
   cd C:\DEV\Dute
   gcloud scheduler jobs list --project dute-prod --location southamerica-east1
   ```

   Precisa aparecer `firebase-schedule-runDailyAlerts-southamerica-east1`, com `every day 06:00` e `America/Sao_Paulo`.
2. **Rodar a rotina uma vez, se quiser conferir na hora.** Sem colaborador nem veículo cadastrado, o log diz `alertas: 0`:

   ```powershell
   cd C:\DEV\Dute
   gcloud scheduler jobs run firebase-schedule-runDailyAlerts-southamerica-east1 --project dute-prod --location southamerica-east1
   ```

3. **A TV da sala.**
   - Em Configuração › Pessoas, convidar o login da TV com o papel Painel.
   - Na TV, abrir `app.dutelog.com.br` e entrar: cai em `/tv`.
   - O login fica guardado no navegador e se renova sozinho.
   - Para sair, abrir `/configuracoes/conta`.
4. **O campo.**
   - Cada pessoa da equipe com app recebe o papel Campo em Pessoas.
   - O e-mail entra no cadastro do colaborador. É o que deixa a pessoa ver só as OS em que está escalada.
5. **A BTG intacta.** Portal, faturas e contagem de abertura funcionando.

## 6. Como desligar

- **Tudo da Operação.** Tirar `dute-prod` das duas listas `OPERACAO_AMBIENTES_LIBERADOS`, em `artifacts/app/src/lib/liberacao.ts` e em `functions/operacao/src/domain/liberacao.ts`, e publicar de novo.
  - As telas somem e as callables recusam.
  - A rotina confere a liberação e não faz nada.
  - O que foi gravado continua no banco.
- **Só a rotina:**

  ```powershell
  cd C:\DEV\Dute
  gcloud scheduler jobs pause firebase-schedule-runDailyAlerts-southamerica-east1 --project dute-prod --location southamerica-east1
  ```

## 7. O que espera o Leonardo

- O OK para a publicação (marco 3).
- Pergunta 12: o tipo da OS fica derivado dos itens.
- Pergunta 13: a vistoria e a demanda direta nascem só pela coordenação. Enviar a vistoria pelo escritório, para a equipe sem ninguém no app, também está fora.
- Pergunta 14: a TV seguiu a proposta, com `/tv`, o papel `painel` e a sessão do navegador.
