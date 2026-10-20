# Plano: Plataforma Dute (IA native)

Aprovado pelo Leonardo em 19/10/2026. O andamento das fases fica no `CLAUDE.md` da raiz; as telas, em `docs/mockups/`.

## Contexto

A Dutelog terá um sistema só, chamado **Dute**, para a empresa inteira: armazenagem (WMS), operação (ordens de serviço), comercial, financeiro e RH. Hoje o WMS está em produção no projeto GCP `dute-btg` (`app.dutelog.com.br`, novo go-live depois da zeragem de 16/10/2026) e o projeto `operacional-dutelog` está vazio. Os dois estão na organização 78767240464 (`leonardo-org`).

Em 19/10/2026 o Leonardo decidiu:

- **Projeto novo, sem "btg".** O ID de um projeto GCP não pode ser trocado, então a plataforma nasce em projetos novos e o WMS é migrado para eles. O `operacional-dutelog` é apagado já; o `dute-btg`, depois da migração e de um período de segurança.
- **Uma plataforma, não um projeto por área.** Um login, um cadastro de clientes e colaboradores, um portal do cliente e um Agent Dute que enxerga a empresa toda.
- **IA native.** O sistema guarda o que foi feito, quanto demorou e quanto custou, e sugere com base nisso: orçamentos parecidos no comercial, tempo por item da LPU na operação, itens parados no WMS com alerta ao cliente.
- **Personalização por cliente.** Cada cliente vê só os módulos, telas, alertas e informações do que contratou, ajustado cliente a cliente.

O módulo Operação, especificado em detalhe neste plano, é o primeiro módulo novo. As 14 telas v3 do canvas https://claude.ai/artifact/KzkB7KUsJFB1fKAVsMPWse definem a identidade visual da plataforma inteira.

## Decisões

| Tema | Decisão |
|---|---|
| Projetos GCP | `dute-prod` (produção) e `dute-homolog` (testes), nomes de exibição "Dute" e "Dute Homologação", na organização atual. IDs confirmados na criação (precisam estar livres) |
| Repositório | O atual `Leow4u/Dute` em `C:\DEV\Dute`, reorganizado por módulos, mantendo o histórico do WMS |
| App | Um app só em `app.dutelog.com.br`, menu por papel e por perfil do cliente; TV em `/tv`, portal em `/portal`, campo em `/campo` |
| Identidade | v3: menu preto, vermelho da marca nas ações e alertas, conteúdo claro, Manrope, cores por status, Agent Dute em violeta. O WMS adota a v3 no lançamento da Operação |
| Stack | A do WMS: React + Vite + Tailwind, Firebase Auth, Firestore, Cloud Functions v2 (Node 22), Cloud Run com nginx atrás de Load Balancer, GitHub Actions |
| IA | Genkit + Gemini no Vertex AI (`global`); embeddings do Vertex AI com busca vetorial do Firestore; BigQuery para medidas e relatórios longos. A IA recomenda, uma pessoa decide |
| Cliente | Perfil de operação do WMS (modelo + pacote do cliente + `client_profiles`) ampliado: módulos contratados, telas do portal, regras de alerta, etiquetas e o que o Agent Dute pode contar |
| Valores | Só `owner`, `admin`, `financeiro` e `comercial` veem preço; o cliente vê os das próprias OS e faturas; operação e campo nunca veem |
| Login | Firebase Auth com e-mail e senha, contas por convite; os usuários do WMS migram com a mesma senha |
| Status da OS | aberta, agendada, em execução, concluída, faturada, paga; cancelada a qualquer momento |
| Notificações | E-mail (Resend) e sino; automáticas por modelo; mensagens escritas pela IA só saem com aprovação |
| RH | Banco Firestore separado; folha e eSocial por sistema especializado integrado |

## Arquitetura

```
app.dutelog.com.br  (um app; PWA no celular; /tv na sala de operações; /portal para clientes)
        │
Load Balancer HTTPS ── Cloud Run "dute-app" (nginx + build React)
        │
Firebase Auth   um login para equipe, motoristas, clientes e TV
Firestore       banco da plataforma (núcleo + módulos) · banco "rh" à parte
Functions       uma codebase por módulo: core · wms · operacao · comercial · financeiro
Storage         anexos, fotos, assinaturas, PDFs, documentos
Vertex AI       Gemini (Agent Dute) + embeddings (memória)
BigQuery        cópia dos eventos para medidas e relatórios
Resend          e-mails
```

`dute-prod` e `dute-homolog` têm a mesma estrutura. A homologação não tem Load Balancer: usa a URL do Cloud Run, para não pagar o custo fixo duas vezes.

**Invariantes** (do WMS, valem para todos os módulos):

1. Nenhuma escrita crítica depende do frontend: transições passam por Functions com papel, status atual, transação e idempotência.
2. Todo passo grava evento em `events`, com ator, cliente e item da LPU quando houver.
3. A IA recomenda; pessoa autorizada decide.
4. `customer_code` isola cada cliente, inclusive na memória da IA.
5. Permissão vale nas regras do Firestore e no backend, nunca só na tela.

## Dute IA native

### Memória em três camadas

| Camada | O que guarda | Onde |
|---|---|---|
| Fatos | Cada passo: orçamento enviado e aprovado, OS agendada, iniciada e concluída, itens da LPU executados com quantidade e tempo, entrada e saída de estoque | `events` (já existe no WMS) |
| Medidas | O que o histórico revela: tempo real por item da LPU, orçado x realizado, dias parado por item, giro por cliente, prazo de aprovação de orçamento | `ai_measures`, recalculadas pelas Functions a cada conclusão; séries longas no BigQuery |
| Lembranças | Cada caso fechado (orçamento + execução + resultado) com resumo em texto e vetor de semelhança | `ai_case_memory`, com busca vetorial do Firestore |

### O que a IA faz em cada módulo

- **Comercial.** Ao montar um orçamento, o Agent Dute traz os orçamentos mais parecidos que foram aprovados e executados e sugere itens da LPU, quantidades, prazo e preço, mostrando o orçado x realizado de cada um.
- **Operação.** No planejamento da OS, sugere a duração de cada item da LPU, a equipe e o veículo, com base nas execuções reais, e avisa quando o plano está otimista demais. Exemplo: "montagem de estação de trabalho: 25 min por unidade com 2 pessoas, em 31 execuções".
- **WMS.** Cada item, caixa ou peça tem "dias parado". As regras do perfil do cliente aplicam etiquetas como "Parado 90+ dias" e "Sem giro" e geram alertas no portal e por e-mail; o agente sugere devolução, descarte ou revisão de cobrança.
- **Financeiro e RH, depois.** Previsão de recebimento e margem real por cliente e serviço; vencimento de CNH, exames e treinamentos.

### Como ela aprende

- Toda sugestão fica em `ai_suggestions` com o que a pessoa aceitou, mudou ou recusou e, depois, com o valor real.
- O painel do Agent Dute mostra a taxa de acerto, como o erro médio da previsão de duração.
- Não há treino de modelo: a melhora vem de mais histórico, medidas mais precisas e busca por casos parecidos. Com pouco histórico, o agente diz que ainda não tem base.
- A captura começa no primeiro dia de cada módulo. Sem tempo real por item, não há o que aprender.

### Regras da IA

- Toda sugestão mostra de onde veio: quais casos e quantas execuções.
- Dado de um cliente nunca aparece para outro. Medidas agregadas de vários clientes servem só à equipe interna.
- O cliente vê só os alertas e insights que o perfil dele libera.

## Personalização por cliente

- **O que já existe no WMS.** O modelo de operação (uniformes, mobiliário, insumos) define portal, controle por peça ou volume, etiqueta e cobrança. O pacote por cliente, como o do BTG, acrescenta o que é dele. `client_profiles` monta o menu do portal.
- **O que muda.** O perfil passa a valer para a plataforma: módulos contratados (armazenagem, operação, financeiro), telas do portal, regras de alerta e de dias parado por categoria, etiquetas, relatórios, canais de aviso e o que o Agent Dute pode contar ao cliente.
- **Regra.** Personalizar por configuração, não por cópia de código. O que for único de um cliente vira pacote ligado só para ele.
- **Tela.** Clientes › Perfil, para a equipe ligar módulos e ajustar regras sem programar.

## Módulos

| Módulo | Escopo | Estado |
|---|---|---|
| Núcleo | Login e convites, pessoas e acessos, clientes e perfis, colaboradores, veículos, catálogo da LPU, eventos, memória da IA, Agent Dute, notificações | Parte existe no WMS; generalizar |
| WMS | Recebimento, endereçamento, separação, expedição, estoque, faturamento de armazenagem e portal; depois dias parado, etiquetas e alertas | Em produção; migra como está |
| Operação | Ordens de serviço (especificação abaixo) | Novo |
| Comercial | Orçamentos com itens da LPU, envio, aprovação, conversão em OS ou contrato, memória de orçamentos | Novo |
| Financeiro | Faturamento unificado de armazenagem e OS, a receber, vencidos; NF-e e contabilidade por integração | Novo, parte vem do WMS |
| RH | Colaboradores, documentos, CNH, exames, treinamentos; folha e eSocial por integração | Novo, banco separado |

## Migração para o projeto novo

1. Criar `dute-homolog` e `dute-prod` com Firebase, faturamento ligado e nome "Dute".
2. Ensaiar na homologação: exportar do `dute-btg` os usuários do Auth com o hash das senhas, o Firestore (export gerenciado) e o Storage; importar; publicar functions, regras e índices; conferir contagens e logins.
3. Preparar a produção: Cloud Run `dute-app`, Load Balancer com IP novo, certificado emitido antes da troca (Certificate Manager com autorização por DNS) e credenciais de deploy no GitHub.
4. Janela de corte, num fim de semana depois da contagem de abertura do inventário: congelar escrita no `dute-btg`, desligar as rotinas agendadas e os e-mails dele, exportar, importar no `dute-prod`, apontar `app.dutelog.com.br` para o IP novo e conferir.
5. Volta, se preciso: o DNS retorna ao IP antigo, que continua intacto.
6. O `dute-btg` fica parado como cópia de segurança por 30 a 60 dias e então o Leonardo o apaga no console.

## Repositório

```
C:\DEV\Dute  (GitHub Leow4u/Dute)
├── CLAUDE.md               contrato de trabalho da plataforma
├── artifacts/app           o app único (hoje btg-inventory); src/modules/{wms,operacao,comercial,financeiro,rh}
├── artifacts/site          site institucional (hoje dutelog-site)
├── functions/core          acesso, clientes e perfis, LPU, eventos, memória da IA, Agent Dute
├── functions/wms           o functions/ atual, movido sem refatorar
├── functions/operacao      ordens de serviço
├── functions/comercial     depois
├── functions/financeiro    depois
├── lib/dominio             tipos, papéis, contrato de eventos, perfis de cliente
├── firestore.rules (+ testes), firestore-rh.rules, storage.rules, firebase.json com uma codebase por pasta de functions
└── agents/, tools/, docs/  com docs/plataforma/ (este plano) e docs/mockups/ (telas v3)
```

- Cada pasta de functions é publicada à parte (`firebase deploy --only functions:operacao`).
- O WMS não é refatorado, só muda de pasta (regra do CLAUDE.md do Dute sobre os arquivos grandes). O Agent Dute sai do WMS para o núcleo numa fase própria, com os testes que já existem.
- As rotas atuais do WMS continuam; o menu da plataforma agrupa por módulo.
- A implementação roda em sessões abertas em `C:\DEV\Dute`.

## Fases

Cada fase termina com CI verde, deploy verificado e o critério de pronto atendido. Um runbook por fase em `docs/`.

### Fase 0 — Projetos e repositório
Criar `dute-homolog` e `dute-prod`; reorganizar o repositório (app, site, functions por pasta, `lib/dominio`); `firebase.json` com codebases; CI publicando na homologação a cada push na `main` e na produção por disparo manual com verificação da URL; CLAUDE.md da plataforma; plano e mockups em `docs/`.
**Pronto quando:** o WMS atual roda na homologação a partir do repositório reorganizado, com os testes verdes.

### Fase 1 — Migração do WMS
Ensaio na homologação, preparação da produção, janela de corte e período de segurança, conforme a seção Migração.
**Pronto quando:** `app.dutelog.com.br` é servido pelo `dute-prod`, os usuários entram com a senha de antes, as contagens batem e o `dute-btg` está congelado.

### Fase 2 — Núcleo e app único
Papéis da plataforma; perfil do cliente com módulos contratados; catálogo da LPU no núcleo; shell v3 com menu por papel e por perfil; Início "Precisa de você"; TV; colaboradores e veículos. Tudo preparado na homologação; o WMS ganha a v3 em produção junto com a Operação.
**Pronto quando:** na homologação, um cliente com perfil "só armazenagem" não vê nada de OS e um usuário interno vê WMS e Operação no mesmo menu.

### Fase 3 — Operação
OS (núcleo), kanban do dia, nova OS, OS em execução, impressão, campo no celular com fotos e assinatura, captura do tempo real por etapa e por item da LPU.
**Pronto quando:** os quatro tipos de OS percorrem todos os status, o motorista conclui pelo celular com assinatura e cada OS concluída grava o tempo real de cada item.

### Fase 4 — Financeiro da operação, portal e lançamento
Precificação, faturamento, a receber e via comercial das OS; OS no portal do cliente junto com o estoque; sino e e-mails. Lançamento da Operação e da v3 em produção.
**Pronto quando:** o ciclo concluída, faturada e paga funciona, o cliente vê estoque e OS no mesmo portal e a operação não lê preços (teste de regras).

### Fase 5 — Memória da Dute
`ai_measures`, `ai_case_memory` com busca por semelhança e `ai_suggestions` com taxa de acerto; duração sugerida por item da LPU na Operação; dias parado, etiquetas e alertas por perfil no WMS; Agent Dute no núcleo com ferramentas de todos os módulos.
**Pronto quando:** uma OS nova recebe duração sugerida com a origem mostrada, um item parado além do limite do cliente gera etiqueta e alerta aprovado, e o painel mostra o erro médio das previsões.

### Fase 6 — Comercial
Orçamentos com itens da LPU, envio e aprovação, conversão em OS, sugestão a partir de orçamentos parecidos com orçado x realizado.
**Pronto quando:** um orçamento novo recebe itens e prazo sugeridos de casos parecidos, é aprovado e vira OS sem redigitar.

### Fase 7 — Financeiro unificado
Faturamento de armazenagem e de OS no mesmo lugar, a receber único, LPU de cobrança do WMS unificada ao catálogo do núcleo (com testes nas trilhas de dinheiro antes), integração de NF-e e contabilidade.

### Fase 8 — RH
Colaboradores, documentos, CNH, exames e treinamentos no banco `rh`, com acesso só de `rh` e `admin`; folha e eSocial por integração.

### Contínuo
Backups do Firestore com teste de restauração, monitoramento e alertas, LGPD (retenção e exclusão), manual do usuário e treinamento.

## Módulo Operação — especificação

### Tipos de OS
Transporte/frete, armazenagem/movimentação, serviço em campo e mudança/transporte dedicado, cada um com seus campos.

### Dados (Firestore, banco da plataforma)
- **Núcleo, já no WMS e generalizado:** `users` (papel, `access_disabled`, `customer_code` só para cliente, `collaborator_id` só para campo), `invites`, `customers` e `client_profiles` (perfil com módulos contratados), `company_settings`, `events`, `notifications`, `operational_notifications` e as coleções do Agent Dute.
- **Núcleo, novo:** `collaborators` (nome, CPF, função, telefone, CNH com categoria e validade), `vehicles` (placa, tipo, modelo, capacidade kg e m³), `lpu_items` (catálogo: código, descrição, unidade, tipos de serviço), `lpu_prices` (preço por cliente ou contrato, leitura só de `owner`, `admin`, `financeiro`, `comercial`), `ai_measures`, `ai_case_memory`, `ai_suggestions`, `counters`.
- **`service_orders`:** `number` sequencial por contador em transação (exibido "OS 000123"), `type`, `status`, `customer_code`, solicitante, `origin` (`internal` ou `portal`), prioridade, datas (abertura, agendada, início, conclusão), responsável, motorista, veículo, equipe, `details` com os campos do tipo, observações internas, cancelamento.
  - `items`: itens da LPU da OS (`lpu_item_id`, quantidade e duração planejadas), sem preço.
  - `execution`: tempos reais por etapa (saída, coleta, entrega) e, por item da LPU, quantidade e duração reais. É a matéria-prima da memória.
  - `attachments`: categoria (foto, comprovante, assinatura, documento, PDF), caminho no Storage, visível ao cliente, enviado por.
  - `private/pricing`: itens com valor, desconto, total, forma de pagamento, NF, faturamento, vencimento e pagamento. Leitura só de `owner`, `admin`, `financeiro` e, nas próprias OS, `cliente`.

### Papéis da plataforma

| Papel | Pode |
|---|---|
| `owner` / `admin` | Tudo, inclusive pessoas, acessos e perfis de cliente |
| `interno` | Operação e cadastros, sem preços |
| `wms` | WMS, como hoje |
| `campo` | Só as OS em que está escalado, pelo celular: iniciar, concluir, fotos, assinatura |
| `comercial` | Orçamentos, clientes e preços de venda; não fatura |
| `financeiro` | Precificar, faturar, receber, relatórios de receita |
| `rh` | Módulo RH; só ele e `admin` leem o banco `rh` |
| `suporte` | Leitura e diagnóstico |
| `painel` | TV: leitura das OS do dia, sem valores e sem ações |
| `cliente` | Só o próprio `customer_code` e só o que o perfil libera |

### Fluxo de status (`functions/operacao`)
```
aberta → agendada → em_execucao → concluida → faturada → paga
aberta → em_execucao (sem agendamento)
concluida → em_execucao (reabrir: owner/admin)
qualquer status exceto paga → cancelada (motivo obrigatório)
```
Cada transição confere papel e status atual na transação, grava evento e notifica quando aplicável.

### Eventos
`service_order.created`, `.scheduled`, `.team_assigned`, `.started`, `.item_executed`, `.completed`, `.priced`, `.invoiced`, `.paid`, `.cancelled`, `.reopened`; `attachment.uploaded`, `delivery.signed`, `portal.request_created`, `collaborator.cnh_expiring`, `vehicle.maintenance_due`, `notification.drafted/approved/sent`, `ai.suggestion_shown/accepted/changed/rejected`. Mesmos campos e regras do contrato de eventos do WMS.

### Telas e funções (mockups v3)
- **Início:** "Precisa de você" (OS atrasadas, pedidos do portal, OS sem veículo ou motorista, sugestões do Agent Dute, cada um com sua ação), números do dia e equipe agora; faturamento e a receber só para quem vê valores.
- **TV (`/tv`):** kanban do dia em tela cheia e modo escuro, indicadores, atrasos em destaque, próxima saída e relógio; atualiza sozinha; usuário `painel` com sessão longa.
- **Operação:** kanban do dia (Para agendar, Agendadas, Em execução, Concluídas), Semana e Todas em lista, filtros em chips e busca; nova OS em etapas (tipo, dados gerais, dados do tipo, revisão) sem valores; OS em três passos (Agendar, Executar, Concluir) com trajeto, carga, equipe, fotos e histórico; duplicar, cancelar, imprimir via operacional.
- **Campo (PWA):** OS do dia, OS em execução com Maps, ligação, carga, instruções e fotos; concluir com fotos, recebedor e assinatura; registro de tempo por etapa.
- **Financeiro:** fila "A precificar", faturar, a receber, vencidos, receita por cliente, exportação XLSX; via comercial do PDF.
- **Relatórios:** OS por período, tipo, cliente e equipe, produtividade, uso de veículos, receita; Excel e PDF.
- **Clientes:** lista, ficha com dados, OS e portal, e o perfil do cliente.
- **Portal do cliente:** andamento das OS, comprovantes, PDF, faturas e solicitação de OS, junto com o estoque do WMS quando o perfil tiver armazenagem.
- **Notificações:** sino e e-mail automáticos (OS criada, atribuída, status, concluída com PDF e comprovantes, pedido do portal); mensagens do agente só com aprovação.
- **Agent Dute:** chat com ferramentas de leitura, radar, briefing diário, rascunhos com aprovação, notas, rotinas, playbooks, conhecimento e OCR de anexos, como no WMS.

## Infraestrutura

Região `southamerica-east1`; Vertex AI em `global`.

| Recurso | Configuração |
|---|---|
| Projetos | `dute-prod` e `dute-homolog` com Firebase; `.firebaserc` com os dois aliases |
| APIs | run, artifactregistry, cloudbuild, cloudfunctions, firestore, identitytoolkit, storage, secretmanager, aiplatform, bigquery, certificatemanager, compute, iam |
| Firebase Auth | e-mail e senha; SMTP pelo Resend; link dos e-mails em `app.dutelog.com.br`; nome público "Dute" |
| Firestore | banco da plataforma e banco `rh`; regras e índices versionados, inclusive índices vetoriais; export gerenciado agendado |
| Storage | bucket privado de anexos com `storage.rules` |
| Functions | uma codebase por módulo; `tools/check_functions_invoker.ps1` após todo deploy |
| BigQuery | eventos copiados pela extensão Stream Firestore to BigQuery, para medidas e relatórios |
| Cloud Run | `dute-app` (nginx), mínimo 0 instâncias |
| Load Balancer | só na produção: IP global, NEG serverless, certificado do Certificate Manager para `app.dutelog.com.br` |
| GitHub Actions | homologação a cada push na `main`; produção manual com `check_frontend_deployed.sh` e volta por revisão |

**Custo mensal estimado** (aproximado; conferir na calculadora):

| Item | Estimativa |
|---|---|
| Load Balancer da produção | US$ 18–25 |
| Cloud Run e Artifact Registry | US$ 0–5 |
| Firestore, Functions, Storage e Auth | US$ 0–15 |
| Vertex AI (Gemini e embeddings) | US$ 5–20 |
| BigQuery | US$ 0–5 |
| Homologação | US$ 0–5 |
| **Total** | **cerca de US$ 25–75 (R$ 140–420)** |

## O que preciso do Leonardo

1. Confirmar os IDs `dute-prod` e `dute-homolog` e a conta de faturamento; a disponibilidade dos IDs é verificada na criação.
2. Escolher a janela de corte do WMS e avisar a equipe e o BTG.
3. Na migração: criar no DNS os registros de validação do certificado e, na janela, trocar o registro de `app.dutelog.com.br` para o IP novo, preservando MX, SPF, DKIM e DMARC.
4. Apagar o `operacional-dutelog` no console agora, e o `dute-btg` depois do período de segurança.
5. Resend (chave e domínio), logo e dados da empresa.
6. Java instalado para os testes com o emulador do Firestore, como no WMS.

## Fora do escopo agora

NF-e e CT-e próprios (vêm por integração), WhatsApp, app nativo, GPS em tempo real, múltiplas empresas, execução automática de ações pela IA.

## Verificação

- **Migração:** contagem de documentos por coleção igual entre `dute-btg` e `dute-prod`; amostra de usuários entrando com a senha antiga; anexos abrindo; rotinas agendadas rodando só no projeto novo.
- **Testes:** `test:critical` de cada codebase de functions; testes de regras (cliente só vê o próprio, operação não lê preço, perfil sem o módulo não acessa, banco `rh` fechado); typecheck e testes do app.
- **Deploy:** homologação a cada push; produção manual com verificação da URL e do invoker; regras e índices em deploy próprio.
- **IA:** sugestão de duração mostra a origem; alerta de item parado respeita o limite do perfil; dado do cliente A nunca aparece para o cliente B (teste); taxa de acerto aparece no painel.
- **Celular e TV:** PWA instalado conclui OS com assinatura; TV atualiza sozinha com o usuário `painel`.

## Riscos e cuidados

- **Corte da migração:** ensaio completo na homologação, janela curta, volta pelo DNS, rotinas do projeto antigo desligadas para não duplicar e-mails.
- **Certificado:** emitido antes da troca do DNS, para o HTTPS não cair.
- **Lições do WMS:** CI verde não prova deploy; callables precisam do invoker; regras e índices não sobem com as functions; numeração da OS em transação; preços isolados por regras e testados.
- **Memória vazia no começo:** sugestões só com histórico mínimo; até lá o agente diz que não há base.
- **Personalização virar código por cliente:** tudo por perfil; pacote só para o que for realmente único.
- **Regras num banco só:** testes de regras por módulo no CI; RH em banco à parte com o papel no token.
