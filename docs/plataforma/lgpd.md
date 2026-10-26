# LGPD: os dados pessoais da plataforma

Inventário técnico para o item LGPD da seção 11 do plano de implantação
(`plano-de-implantacao.md`): "retenção e exclusão de fotos, assinaturas e
dados de campo; CPF só onde o papel precisa; registro de quem acessou o que".
Diz onde cada dado pessoal fica, quem lê, quem grava e quanto tempo fica hoje,
o que falta para o item do plano e o que o Leonardo decide (seção 5). Nada aqui
muda o sistema: cada mudança entra num PR próprio, depois da decisão.

- **Data e base.** 25/10/2026, sobre a `main` daquele dia (`df27e8b`). As
  fontes vão como `caminho:linha` desse commit; as linhas mudam com o código:
  confira cada item antes de agir sobre ele.
- **Fontes.** `firestore.rules`, `firestore-rh.rules`, `storage.rules`,
  `firestore.indexes.json`, `firebase.json`, `functions/{wms,comercial,operacao,financeiro,core,rh}/src`,
  `lib/dominio/src`, `artifacts/app/src`, `tools/`, `deploy/` e os runbooks
  citados. Toda fonte é `caminho:linha`, relativa à raiz do repositório.
- **Escopo.** O que o código grava, quem lê e quanto tempo fica. O que só
  existe na configuração dos projetos (Cloud Audit Logs, retenção do Cloud
  Logging, versionamento dos buckets) não está no repositório e vai em
  "Dúvidas". Nada aqui é parecer jurídico nem diz base legal.
- **Como ler as colunas.**
  - "Quem lê" junta as regras (`firestore.rules`, `firestore-rh.rules`,
    `storage.rules`) e as callables que devolvem o dado. A regra vale para o
    documento inteiro: quem lê um documento pelo navegador recebe todos os
    campos dele, mesmo os que a tela não mostra.
  - "Sem exclusão" quer dizer que nenhum código apaga, expira ou anonimiza o
    dado.
- **Cópias que valem para toda linha do Firestore de produção.**
  - PITR de 7 dias e backup diário de 14 dias, no `(default)` e no `dute-rh`
    (`docs/plataforma/backup-e-recuperacao.md:13-16`, `:23-28`).
  - Não há política de TTL (`docs/plataforma/backup-e-recuperacao.md:86`;
    `firestore.indexes.json:950`, `fieldOverrides` vazio).
  - O Storage não tem backup nem ciclo de vida no repositório (seção 1.10).
- **Papéis** (11, `lib/dominio/src/index.ts:29-41`): owner, admin, interno,
  wms, campo, comercial, financeiro, rh, suporte, painel, cliente. Abaixo,
  **"operação"** é owner, admin, interno, wms e suporte (`canReadOperations`,
  `firestore.rules:80-82`), e **"observabilidade"** é o mesmo grupo
  (`canReadObservability`, `firestore.rules:121-123`).

## 1. Dados pessoais, um por linha

### 1.1 Acesso (logins)

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Nome, e-mail, papel, cliente e convite usado; quem mudou o papel; acesso removido (quando, por quem, motivo) | `(default)` `users/{uid}`: `nome`, `email`, `role`, `customer_code`, `invite_id`, `role_updated_by`, `access_disabled`, `access_changed_at`, `access_changed_by`, `access_change_reason` | A própria pessoa (get) e owner e admin (get e list), pelas regras. As Functions de todas as codebases leem o perfil a cada chamada; `saveCollaborator` procura o login pelo e-mail | O navegador cria no aceite do convite, só com os campos da regra; `mutateManagedEntity` (`set_role`); `setUserAccess`. Alterar ou apagar pelo navegador: negado | Sem exclusão. Remover o acesso só marca `access_disabled`: "o perfil fica (histórico e auditoria)". A zeragem preserva | `firestore.rules:249-261`, `:663-675`; `artifacts/app/src/App.tsx:661-670`; `functions/wms/src/index.ts:4554-4558`, `:6855-6873`; `functions/wms/src/domain/access.ts:4-9`, `:70-78`; `functions/operacao/src/domain/gravacao.ts:187-200`; `tools/full_reset_btg.py:58-61` |
| Conta do Firebase Authentication: e-mail, senha (hash), nome de exibição | Firebase Authentication de cada projeto | As Functions (e-mail e nome do token entram no perfil); quem tem acesso ao console | O navegador cria a conta e grava o nome no aceite do convite; `setUserAccess` desativa a conta e revoga os tokens | Sem exclusão: a conta é desativada, não apagada. A zeragem não toca no Auth. Exports do Auth em `.secrets\fase-1\` (1.10) | `artifacts/app/src/App.tsx:643-649`; `functions/wms/src/index.ts:6862-6864`; `functions/rh/src/domain/profile.ts:34-37`; `tools/full_reset_btg.py:151-152` |
| Convite: nome, e-mail, papel, cliente, quem criou, quem usou, quem revogou | `invites/{token}`: `nome`, `email`, `role`, `customer_code`, `status`, `created_by`, `used_by`, `used_at`, `revoked_by` | owner e admin (get e list); a pessoa convidada (get, pelo e-mail do token). `lookupInvite` devolve e-mail, nome, papel e cliente a quem tiver o token, sem login | `mutateManagedEntity` cria e revoga (`archive`); o navegador marca `used` no aceite | Sem exclusão: o usado e o revogado ficam | `firestore.rules:316-327`, `:677-686`; `functions/wms/src/index.ts:3060-3080`, `:4620-4663`; `artifacts/app/src/App.tsx:671-675` |
| Conta do cliente no portal: e-mail, nome, papel, observações; o id do documento pode ser `<cliente>_<email>` | `customer_accounts/{id}` | operação | `mutateManagedEntity` (`archive` só muda o status) | Sem exclusão. A zeragem preserva | `firestore.rules:1001-1004`; `functions/wms/src/index.ts:3719-3728`, `:4029-4035`, `:4574-4618`; `tools/full_reset_btg.py:58-61` |

### 1.2 Pessoas dos clientes e de terceiros

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Contato do cliente: nome, e-mail, telefone, empresa, papel (gestor, gerenciadora, financeiro, outro), avisos ligados | `customer_contacts/{id}` | owner, admin, comercial (regras); a rotina `runNotifications` lê os contatos para o e-mail | `saveCustomerContact` (Comercial) | Sem exclusão (desativar é `ativo: false`). A zeragem preserva | `firestore.rules:92-97`, `:928-931`; `functions/comercial/src/domain/cadastro.ts:56-57`, `:274-291`, `:897-961`; `functions/comercial/src/index.ts:72`; `functions/operacao/src/domain/avisos-gravacao.ts:91-98`; `tools/full_reset_btg.py:81-93` |
| Contato principal da empresa no cadastro do WMS: nome e e-mail; observações | `customers/{id}`: `primary_contact_name`, `primary_contact_email`, `notes` | operação e comercial (regras). Em `customer_contacts`, o mesmo tipo de dado só abre a owner, admin e comercial | `mutateManagedEntity` (WMS) | Sem exclusão (arquivar). A zeragem preserva sem `--include-setup` | `firestore.rules:912-917`; `functions/wms/src/index.ts:3703-3718`, `:4561-4572`; `functions/wms/src/domain/customer-profile.ts:228-237`, `:259-279`; `tools/full_reset_btg.py:62-74` |
| Contato da cobrança no WMS: nome e e-mail | `billing_config/{id}`: `cliente_nome`, `cliente_email` | owner, admin, financeiro, suporte | `mutateManagedEntity` | Sem exclusão | `firestore.rules:86-90`, `:713-716`; `functions/wms/src/index.ts:3696-3700` |
| Quem pediu a demanda direta: nome e telefone | `demands/{numero}.pedido_por` | owner, admin, comercial, financeiro, interno | `openDirectDemand` (Operação); na demanda aberta de uma solicitação do portal, vai o nome do login que pediu | Sem exclusão. A zeragem preserva | `firestore.rules:99-104`, `:735-738`; `functions/operacao/src/domain/demanda-direta.ts:29`, `:109-123`, `:286`; `functions/operacao/src/domain/demanda-direta-gravacao.ts:154`; `tools/full_reset_btg.py:81-93` |
| Solicitação de OS pelo portal: quem pediu (uid, nome e e-mail do login), origem, destino e o que será feito (textos livres), nome dos anexos; motivo da recusa e quem recusou | `service_requests/{sol_…}` | owner, admin, interno, suporte; o cliente dono, com a Operação no contrato | `requestService` (cliente), `declineServiceRequest`, `openDirectDemand` | Sem exclusão. A zeragem preserva | `firestore.rules:962-970`; `functions/operacao/src/domain/solicitacao.ts:26`, `:85-112`, `:172-209`; `functions/operacao/src/domain/solicitacao-gravacao.ts:77`, `:98`, `:145`; `tools/full_reset_btg.py:100-111` |
| Anexo da solicitação (NF ou documento; PDF, JPG, PNG ou WebP, até 10 MB) | Storage `portal/{customer_code}/solicitacoes/an_<16 hex>.<ext>` | owner, admin, interno, suporte; o cliente com a Operação no contrato, nos do próprio código | O cliente, pelo SDK; `requestService` confere o arquivo | Sem exclusão: as regras proíbem trocar e apagar | `storage.rules:139-169`; `functions/operacao/src/domain/solicitacao.ts:17-20`, `:32-35`, `:156-170`; `artifacts/app/src/lib/portal/enviar-solicitacao.ts:18` |
| Retirada no armazém: quem retira (nome), documento (texto livre até 30 caracteres) e placa. Entrega pela Dutelog: destino e contato (nome, telefone) | `orders/{id}.entrega` | operação. Não vai ao evento | `setOrderDelivery` (owner, admin, interno, wms) | Sem exclusão | `firestore.rules:1016-1019`; `functions/wms/src/domain/order-delivery.ts:9-19`, `:99-131`, `:225`, `:239-246`; `functions/wms/src/index.ts:1402-1409`, `:6403-6407` |
| Motorista e placa da expedição | `shipments`, `shipment_items`, `packages` (`driver_name`, `vehicle_plate`) e a projeção `client_order_tracking` | operação; o cliente dono lê a projeção, com a armazenagem no contrato | `advanceWarehouseTask` (saída) | Sem exclusão no código; a zeragem do WMS apaga essas coleções (não estão nas listas preservadas) | `firestore.rules:1021-1024`, `:1124-1142`; `functions/wms/src/domain/operations.ts:7422-7451`, `:7702-7729`; `functions/wms/src/index.ts:6389-6396`; `tools/full_reset_btg.py:163-178` |
| Pedido do cliente no WMS: quem pediu (uid, e-mail, nome), destino e descrição (textos livres), anexos com link | `customer_requests/{id}` (`requested_by`); projeção `client_request_status` | `customer_requests`: operação. A projeção: operação e o cliente dono (armazenagem) | `createCustomerRequest` | Sem exclusão no código; a zeragem do WMS apaga | `firestore.rules:1006-1014`; `functions/wms/src/domain/operations.ts:4023-4075`; `functions/wms/src/index.ts:6365`; `tools/full_reset_btg.py:163-178` |

### 1.3 Colaboradores e campo

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Cadastro do colaborador: nome, CPF (obrigatório e único em todo vínculo), função, telefone, CNH (categoria e validade; o número da CNH não é guardado), vínculo (próprio, freelancer, terceiro), empresa do terceiro, papéis de campo, e-mail e uid do login do app, ativo | `(default)` `collaborators/{col_…}` | owner, admin, interno (regras). O app lê a coleção inteira no Início, em Hoje, na Agenda, em Planejar e em Colaboradores, e mostra o CPF só em Colaboradores. O RH lê nome, função, vínculo e ativo (`getRhPanel`, `getRhFicha`) e o CPF só na exportação. As rotinas `runDailyAlerts` e `runRhAlerts` leem os ativos | `saveCollaborator` (owner, admin, interno) | Sem exclusão: "Não apaga"; desativar só muda `ativo`. A zeragem preserva | `firestore.rules:933-945`; `functions/operacao/src/domain/cadastro.ts:20-31`, `:47-63`, `:181-196`, `:249-264`, `:425-431`; `functions/operacao/src/domain/gravacao.ts:143-181`; `functions/operacao/src/domain/platform-roles.ts:26-27`; `artifacts/app/src/lib/operacao/use-inicio.ts:46`; `artifacts/app/src/pages/operacao/hoje.tsx:25`; `artifacts/app/src/pages/operacao/agenda.tsx:25`; `artifacts/app/src/pages/operacao/planejar.tsx:63`; `artifacts/app/src/pages/operacao/pagina.tsx:37-38`; `artifacts/app/src/lib/operacao/cadastro.ts:80-120`; `functions/rh/src/domain/ficha-gravacao.ts:45-65`; `docs/plataforma/fase-3-operacao.md:236-248`; `tools/full_reset_btg.py:100-111` |
| Veículo: placa, dono (próprio ou terceiro) e empresa do terceiro | `vehicles/{vei_…}`; cópia em `service_orders.veiculos[]` | owner, admin, interno; a OS (linhas abaixo); a TV recebe as placas | `saveVehicle` | Sem exclusão | `firestore.rules:947-950`; `functions/operacao/src/domain/cadastro.ts:65-79`; `functions/operacao/src/domain/os.ts:101-108`; `functions/operacao/src/domain/tv.ts:43-45` |
| Equipe da OS: nome, papel, vínculo, empresa e uid do login de cada pessoa | `service_orders/{numero}`: `equipe[]`, `equipe_uids` (cópia do cadastro ao planejar ou agendar) | owner, admin, interno, suporte; o campo escalado na OS; o cliente dono, com a Operação no contrato (a regra dá o documento inteiro; o comprovante mostra só o motorista). A TV recebe os nomes por `getRoomBoard` (papel painel, owner, admin, interno). O Agent Dute do núcleo dá nome e papel só à equipe Dutelog | `saveServiceOrder` | Sem exclusão | `firestore.rules:148-158`, `:206-208`, `:952-960`; `functions/operacao/src/domain/os.ts:12-15`, `:89-99`, `:110-133`, `:637-668`; `functions/operacao/src/domain/tv.ts:5-15`, `:158`; `functions/operacao/src/domain/platform-roles.ts:33`; `functions/operacao/src/index.ts:157-161`; `functions/core/src/domain/agente-operacao.ts:16-18`, `:103-107`; `docs/plataforma/fase-4-financeiro.md:362-368` |
| Contato no local da OS (nome, telefone) e locais (nome, endereço, complemento) | `service_orders/{numero}.locais.{origem,destino}` | As mesmas da OS; a TV recebe só o nome dos locais | `saveServiceOrder` (abrir e agendar) | Sem exclusão | `functions/operacao/src/domain/os.ts:76-87`, `:211-228`, `:607-633`; `functions/operacao/src/domain/tv.ts:10-15`, `:94-102` |
| Registros da execução: instante de cada etapa; ocorrência (texto livre até 1000); item feito; inclusão em campo com quem pediu no local (`pedido_por`, nome livre) e o motivo; canal, meio, quem da equipe informou (`informado_por`, id do colaborador), quem registrou (`registrado_por`, uid e papel), quando o servidor gravou; última alteração (`atualizado_por`) | `service_orders/{numero}`: `etapas[]`, `ocorrencias[]`, `itens[].incluidos[]`, `atualizado_por` | As mesmas da OS | `registerStep`, `registerOccurrence`, `registerItem` (coordenação ou campo escalado; o celular manda pela fila) | Sem exclusão | `functions/operacao/src/domain/execucao.ts:6-16`, `:34-69`; `functions/operacao/src/domain/itens-executados.ts:39-45`, `:66-77`; `functions/operacao/src/domain/execucao-gravacao.ts:81`, `:130`, `:175`, `:199`; `functions/operacao/src/domain/os-gravacao.ts:271-273`; `functions/operacao/src/index.ts:85-101` |
| Presença na OS: entrada e saída de cada pessoa da equipe, inclusive freelancer e terceiro sem login ("é o que paga a diária") | `service_orders/{numero}.presencas[]` (`colaborador_id`, `instante`, `canal`, `registrado_por`, `por_colaborador`, `registrado_em`); evento `os.presence_recorded` com o id do colaborador e o instante | A OS: as mesmas acima. O evento: observabilidade | `registerPresence` (o líder marca todos; quem tem o app marca a própria; o escritório também) | Sem exclusão | `functions/operacao/src/domain/presencas.ts:19-39`, `:63-100`; `functions/operacao/src/domain/execucao-gravacao.ts:240`; `functions/operacao/src/domain/events.ts:166-169`; `functions/operacao/src/domain/cadastro.ts:25-31`; `firestore.rules:789-792` |
| Localização do aparelho | Não há. Nenhum código do app nem das Functions lê a posição. O cabeçalho `Permissions-Policy` com `geolocation=()` está só no nginx do site institucional, não no do app. As fotos sobem como foram escolhidas, sem regravar a imagem: o código não remove os metadados do arquivo (EXIF), ver "Dúvidas". O instante da foto sai do `lastModified` do arquivo | — | — | — | Busca por `geolocation`, `getCurrentPosition` e `latitude` sem resultado em `functions/*/src` e `artifacts/app/src`; `deploy/cloud-run/nginx-site.conf:9`; `deploy/cloud-run/nginx.conf:21-25`; `Dockerfile:6`; `artifacts/app/src/lib/operacao/enviar-foto.ts:17-24`, `:34`; `artifacts/app/src/lib/campo/fila-do-campo.tsx:46-53` |
| Responsável do cliente na conclusão: nome, cargo e documento (opcional, "CPF ou RG", texto livre de 3 a 30 caracteres); sem aceite, o nome de quem recebeu | `service_orders/{numero}.conclusao.responsavel`; ao reabrir a OS, a conclusão vai para `revisoes_anteriores[]` | owner, admin, interno, suporte, o campo escalado e o cliente dono (regras). Mostram o documento: o comprovante do portal (com PDF), a ficha da OS e a OS impressa. O Agent Dute (`ver_os`) devolve só o nome, à equipe e ao cliente. Fica fora do evento e da TV | `completeServiceOrder` (o líder no celular ou o escritório) | Sem exclusão | `functions/operacao/src/domain/conclusao.ts:26-40`, `:49-67`, `:83-90`, `:235-242`; `functions/operacao/src/domain/conclusao-gravacao.ts:14-20`, `:47`; `functions/operacao/src/domain/revisao-gravacao.ts:184-200`; `functions/operacao/src/domain/events.ts:171-187`; `artifacts/app/src/lib/portal/comprovante.ts:75`, `:94`; `artifacts/app/src/lib/operacao/ficha-da-os.ts:496-499`; `artifacts/app/src/lib/operacao/os-documento.ts:129`; `functions/core/src/domain/agente-operacao.ts:163`; `functions/operacao/src/domain/tv.ts:13-14`; `docs/plataforma/fase-3-operacao.md:863-864`, `:884` |
| Assinatura do responsável (traço no dedo ou foto da via assinada no papel) | Storage `os/{numero}/assinatura/as_<16 hex>.<jpg,png,webp>`; o caminho em `conclusao.assinatura` | owner, admin, interno, suporte, o campo escalado; o cliente dono, na OS concluída (em revisão ou revisada, fora a vistoria), só a assinatura que a conclusão aponta | Quem coordena ou o campo escalado, com a OS em execução; `completeServiceOrder` confere o arquivo | Sem exclusão: as regras proíbem trocar e apagar, e não há ciclo de vida no bucket | `storage.rules:84-103`, `:121-137`; `functions/operacao/src/domain/conclusao.ts:120-123`, `:218-223`; `artifacts/app/src/lib/operacao/enviar-foto.ts:49-59`; `artifacts/app/src/lib/campo/concluir.ts:162` |
| Fotos da OS (etapas, ocorrências, itens, final e vistoria), com instante, legenda livre (até 60), canal e quem registrou. O código não limita o que aparece na foto | Storage `os/{numero}/fotos/ft_<16 hex>.<jpg,png,webp>`; registros em `service_orders/{numero}.fotos[]`; caminhos da vistoria em `demands/{numero}.vistoria` | owner, admin, interno, suporte, o campo escalado; o comercial, só as da vistoria; o cliente, só as fotos do final listadas na conclusão (`arquivos_do_final`) | Quem coordena ou o campo escalado, com a OS agendada ou em execução; `attachPhoto` confere; `sendSurveyToCommercial` leva a vistoria à demanda | Sem exclusão: as regras proíbem trocar e apagar; `deploy/cloud-storage/` só tem CORS, sem ciclo de vida | `storage.rules:56-119`; `functions/operacao/src/domain/fotos.ts:23-48`, `:77-80`, `:104-117`; `functions/operacao/src/domain/fotos-gravacao.ts:19-61`; `functions/operacao/src/domain/vistoria.ts:28-35`; `functions/operacao/src/domain/vistoria-gravacao.ts:47`; `functions/operacao/src/domain/conclusao.ts:61-66`; `deploy/cloud-storage/cors-dute-prod.json` |
| Fila do campo e rascunho da vistoria no aparelho (registros ainda não enviados, com a foto e a assinatura dentro) | IndexedDB `dute-campo`, por uid; `localStorage` (rascunho da vistoria e as recusas, `dute.campo.falhas.<uid>`) | O próprio aparelho, por login | O app do campo | O registro sai da fila quando chega ou é recusado; a recusa fica até a pessoa dispensar; o rascunho é apagado quando a vistoria é enviada | `artifacts/app/src/lib/campo/fila-guardada.ts:3-19`, `:81-89`; `artifacts/app/src/lib/campo/fila-do-campo.tsx:10-16`, `:86-115`; `artifacts/app/src/lib/campo/use-rascunho-da-vistoria.ts:5-16`; `artifacts/app/src/lib/campo/vistoria.ts:322-334` |
| Perfil da pessoa no aparelho (papel, cliente e nome do último perfil lido), para o app abrir sem sinal | `localStorage` `dute.perfil.<uid>` | O próprio aparelho, por login | O app | Sai no logout e quando o servidor tira o acesso | `artifacts/app/src/lib/perfil-guardado.ts`; `artifacts/app/src/lib/auth.tsx` |

### 1.4 RH (banco `dute-rh`)

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Registro da ficha: categoria (documento, exame, treinamento); tipo (nos documentos, RG, CPF, CTPS, PIS, título de eleitor, reservista, comprovante de residência, contrato); data e vencimento; resultado do exame (apto, apto com restrição, inapto); nome do "outro"; situação; arquivo (caminho, tamanho, geração) e `arquivos_anteriores`; quem criou e alterou (uid, e-mail, nome, papel) | `dute-rh` `registros/{reg_…}`, ligado ao `colaborador_id` | Ninguém pelo navegador: as regras do banco negam tudo. owner, admin e rh pelas callables `getRhPanel` e `getRhFicha`; a ficha traz o resultado do exame e o arquivo sem o caminho | `saveRhRecord`, `archiveRhRecord`, `attachRhFile` (só rh) | Sem exclusão: arquivar só muda `situacao`, e o registro arquivado ainda abre. A zeragem recusa o banco | `firestore-rh.rules:3-11`; `functions/rh/src/domain/ficha.ts:25`, `:31-66`, `:229-234`; `functions/rh/src/domain/ficha-gravacao.ts:198-306`, `:331-416`; `functions/rh/src/domain/platform-roles.ts:27-28`; `functions/rh/src/index.ts:39-61`; `tools/full_reset_btg.py:699-710` |
| Arquivo escaneado do registro (o documento, o ASO, o certificado) | Storage `rh/{colaborador}/{registro}/arq_<16 hex>.<pdf,jpg,png,webp>`; o trocado continua no bucket | Nenhum papel pelo SDK. owner, admin e rh por URL assinada de 5 minutos (`openRhFile`), só da geração conferida; o evento da abertura é gravado antes | rh, por URL assinada de 10 minutos (`requestRhUpload`) e `attachRhFile`; o arquivo recusado é apagado | Sem exclusão: o anterior fica em `arquivos_anteriores`. Segundo o runbook, o bucket não tem versionamento | `storage.rules:171-177`; `functions/rh/src/domain/arquivos.ts:8-20`, `:50-53`; `functions/rh/src/domain/arquivos-gravacao.ts:41-42`, `:95-97`, `:113-123`, `:128-167`, `:176-192`; `docs/plataforma/fase-8-rh.md:286-300`, `:441-446` |
| Datas do vínculo do colaborador próprio: admissão e desligamento; quem criou e alterou (uid, e-mail, nome, papel) | `dute-rh` `vinculos/{col_…}`, com o id do cadastro da Operação | Ninguém pelo navegador: as regras do banco negam tudo. owner, admin e rh pelas callables `getRhPanel` (as datas de cada próprio) e `getRhFicha` (com a edição) | `saveRhVinculo` (só rh), que confere o vínculo próprio no cadastro da Operação e não o altera | Sem exclusão: a data se corrige gravando de novo. A zeragem recusa o banco | `firestore-rh.rules:3-11`; `functions/rh/src/domain/vinculo.ts:24-61`, `:96-106`; `functions/rh/src/domain/vinculo-gravacao.ts:20-54`; `functions/rh/src/domain/ficha-gravacao.ts:331-358`, `:383-414`; `functions/rh/src/index.ts:63-67`; `tools/full_reset_btg.py:704-706` |
| Exportação para a contabilidade: nome, CPF, função, admissão, desligamento e situação no mês dos colaboradores de vínculo próprio; os exames do mês com tipo, data do ASO, resultado e vencimento; quem gerou (uid, e-mail, nome) | `dute-rh` `exportacoes/exp_<AAAA-MM>_v<n>` (`exames[]`, `colaboradores[]`, `gerada_por`); a planilha CSV é montada no download e sai do sistema | owner, admin e rh: `listRhExports` (sem as linhas, com o nome ou o e-mail de quem gerou) e `downloadRhExport` (a planilha com o CPF) | `exportRhMonth` (só rh), que lê o CPF em `collaborators`, no banco padrão, e as datas em `vinculos` | Sem exclusão: cada versão nova mantém as anteriores | `functions/rh/src/domain/exportacao.ts:8-24`, `:65-100`, `:165-245`; `functions/rh/src/domain/exportacao-gravacao.ts:49-57`, `:73-126`, `:143-162`, `:169-194`; `functions/rh/src/index.ts:87-103`; `docs/plataforma/fase-8-rh.md:470-484` |
| Eventos e recibos do RH: ator (uid, e-mail, nome, papel), id do colaborador e do registro, categoria, tipo, datas, as datas do vínculo; aberturas de arquivo e downloads | `dute-rh` `events/{evt_…}` e `rh_operations/{op_…}` | Ninguém pelo navegador; nenhuma callable lista esses eventos | As callables do RH e a rotina `runRhAlerts` | Sem exclusão | `functions/rh/src/domain/events.ts:10-23`, `:28-40`, `:65-87`, `:144-175`; `functions/rh/src/domain/operations.ts:13`, `:63-70`, `:100-116`; `functions/rh/src/domain/rotina-gravacao.ts:19-73` |

### 1.5 Avisos e e-mail

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Fila de e-mail dos avisos: destinatários (e-mails dos contatos que ligaram o modelo), assunto e texto (modelo fixo, sem nome; o da NF leva valor e vencimento), status, tentativas, erro, id do provedor | `email_outbox/mail_<evento>` | owner e admin | `runNotifications` (a cada 5 minutos). Sai pelo Resend quando há `RESEND_API_KEY`; sem ela, fica `audit` | Sem exclusão: o enviado, o auditado e o falho ficam | `firestore.rules:982-987`; `functions/operacao/src/domain/avisos.ts:166-256`, `:274-305`; `functions/operacao/src/domain/avisos-gravacao.ts:20-25`, `:144-159`, `:176-208`, `:222-238`; `functions/operacao/src/index.ts:174-187` |
| Aviso do sino do portal (título, texto do modelo, link) e até quando cada login viu os avisos | `client_notifications/ntf_<evento>`; `client_notification_reads/{uid}` (`uid`, `customer_code`, `lidos_ate`) | Avisos: owner, admin e o cliente dono. Leituras: só o próprio login | `runNotifications`; `markNotificationsRead` | Sem exclusão | `firestore.rules:972-980`, `:994-999`; `functions/operacao/src/domain/avisos.ts:151-160`; `functions/operacao/src/domain/avisos-gravacao.ts:133-143`, `:245-264` |
| Notificação do Agent Dute no WMS: destinatários, assunto, corpo, nota; quem aprovou e quem enviou (uid e e-mail); resposta do provedor | `operational_notifications/{id}` | observabilidade; o cliente dono lê as para o cliente (`audience: "client"`) aprovadas e enviadas, nunca as internas | `syncOperationalNotifications`, `decideOperationalNotification` (envio por webhook configurável ou só registro) | Sem exclusão | `firestore.rules:804-812`; `functions/wms/src/index.ts:1635-1653`, `:1677-1765`, `:1892-1910`, `:6732-6742` |

### 1.6 Eventos e recibos do banco padrão

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Ator de cada evento: uid, e-mail, nome, papel e cliente (no núcleo, uid, papel e nome) | `(default)` `events/{id}`; os de severidade atenção ou crítica do WMS são copiados para `ai_agent_inbox`, com título, descrição e ator | observabilidade lê todos, de todos os módulos; o financeiro, os `billing.*`, `nf.*` e `cobranca.*`. Inbox: observabilidade, e o financeiro nos de fatura | Todas as codebases; o navegador não grava | Sem exclusão. A zeragem do WMS apaga os eventos do WMS e preserva os do Comercial, da Operação e do Financeiro | `firestore.rules:121-123`, `:394-429`, `:789-802`; `functions/wms/src/domain/operations.ts:378-386`, `:483-533`; `functions/operacao/src/domain/operations.ts:63-70`; `functions/operacao/src/domain/events.ts:442`; `functions/comercial/src/domain/operations.ts:74-82`; `functions/financeiro/src/domain/events.ts:275`; `functions/core/src/domain/eventos.ts:127-128`; `tools/full_reset_btg.py:14-19`, `:136-140` |
| Nome ou e-mail no texto do evento, além do ator: `user.access_revoked` e `user.access_restored` (nome ou e-mail da pessoa e o motivo na descrição, e-mail no payload); `access.invite_accepted` (nome na descrição, e-mail e token do convite no payload; a callable recusa esse tipo para o papel cliente); `customer_accounts.*` (o id, que pode ser `<cliente>_<email>`, em `entity_id` e na descrição); `document.*` (nome do arquivo); `recordOperationalEvent` (título, descrição e payload livres de quem tem papel interno) | `events` | observabilidade | `setUserAccess`; o app no aceite do convite, via `recordOperationalEvent`; `mutateManagedEntity`; `createDocumentUploadTarget`, `uploadOperationalDocument` | Sem exclusão | `functions/wms/src/domain/access.ts:79-99`; `artifacts/app/src/App.tsx:677-701`; `artifacts/app/src/lib/functions-api.ts:289-291`; `functions/wms/src/index.ts:338-351`, `:4029-4035`, `:5040-5050`, `:5264-5289`, `:5340-5365`, `:6709-6730` |
| Recibos de idempotência: ator (uid, papel e e-mail; nome na maioria) e resultado com ids | `operational_operations`, `managed_operations`, `comercial_operations`, `operacao_operations`, `financeiro_operations` | Ninguém pelo navegador (sem regra) | As callables | Sem exclusão | `functions/wms/src/index.ts:257-258`, `:5076-5089`; `functions/comercial/src/domain/operations.ts:124`; `functions/operacao/src/domain/operations.ts:13`, `:100-116`; `firestore.rules:1254-1256` |

### 1.7 IA e Agent Dute

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Conversa com o Agent Dute: e-mail e nome de quem conversa; texto livre das perguntas e das respostas; anexos (a NF do cliente, com link de download); a leitura da NF (`context`); ferramentas usadas; resumo da conversa longa | `agent_conversations`, `agent_messages` (as mesmas coleções no WMS e no núcleo) | Cada pessoa só as próprias (regras). O modelo (Gemini no Vertex AI, multirregião `us`) recebe a mensagem e as 20 últimas | `chatWithDute` (núcleo), `chatWithAgentDute` (WMS); pelas regras do WMS, o navegador também cria a conversa e a mensagem da pessoa | Sem exclusão: as regras proíbem apagar | `firestore.rules:431-444`, `:452-457`, `:498-555`, `:889-900`; `functions/core/src/domain/agente-conversa.ts:17-40`, `:223-273`, `:317-320`; `functions/core/src/domain/agente-modelo.ts:23-26`; `functions/wms/src/index.ts:228-233`, `:3082-3110`, `:3172-3173` |
| Uso do agente e rotinas: uid, papel, módulo, modelo, ferramentas usadas, tokens, erro; a rotina guarda o pedido (até 600 caracteres) e o nome de quem criou | `agent_usage`, `agent_routines` | Ninguém pelo navegador (sem regra). O painel do sistema (só owner) lê o uso e as rotinas, com o nome | Os fluxos do agente; `saveDuteRoutine` | Sem exclusão do uso; a rotina sai quando a pessoa a exclui (`deleteDuteRoutine`) | `functions/core/src/domain/agente-conversa.ts:274-314`; `functions/core/src/domain/agente-rotinas.ts:25`, `:86`, `:155-159`, `:188-191`; `functions/wms/src/domain/system-dashboard.ts:5-13`, `:179-207` |
| Anotações e playbooks do agente: texto livre (até 300) por cliente; quem sugeriu e quem decidiu (uid, nome, papel) | `ai_agent_notes`, `ai_agent_playbooks` | A coordenação, pelas callables; o texto aprovado entra no prompt do agente do cliente | `suggestDuteNote`, `decideDuteNote`, `saveDutePlaybook`, `decideDutePlaybook` | Sem exclusão (arquivar é status) | `functions/wms/src/domain/agent-notes.ts:10-26`; `functions/core/src/domain/agente-revisao.ts:30-31`, `:51`, `:192`, `:340`; `functions/core/src/index.ts:112-152` |
| Memória e base de conhecimento do agente no WMS: resumos por cliente; o texto extraído dos documentos (OCR que "transcreve fielmente todo texto visível"); arquivos enviados à base, guardados em base64 no Firestore | `ai_agent_memory`, `ai_agent_knowledge`, `ai_agent_knowledge_chunks`, `ai_agent_knowledge_files`, `ai_agent_knowledge_file_chunks`; trecho de até 4000 caracteres em `documents.content_excerpt` | owner, admin, interno, suporte | owner, admin e interno, direto pelo navegador (regras); `extractOperationalDocumentContent` | Sem exclusão pelo app: a regra deixa owner, admin e interno apagarem, a tela não apaga | `firestore.rules:864-887`; `artifacts/app/src/pages/agent-knowledge.tsx:65-68`, `:380-470`; `functions/wms/src/index.ts:1165-1176`, `:5608-5626`, `:5686`, `:5722-5762` |
| Lembranças da memória: por demanda fechada, nome da empresa, título da demanda (texto livre), itens, valor orçado e realizado, OS e tempos. O código não grava nome de pessoa | `ai_case_memory/{demanda}` | Ninguém pelo navegador; `findSimilarQuotes` devolve a quem orça | `runMeasures` | Refeita a cada rodada e apagada quando a demanda deixa de estar fechada; fora isso, sem exclusão | `firestore.rules:829-835`; `functions/core/src/domain/lembrancas.ts:3-10`, `:58-81`, `:171-203`; `functions/core/src/domain/lembrancas-gravacao.ts:85-97` |
| Sugestões: quem pediu (uid, papel), o sugerido, a decisão e o real | `ai_suggestions` | owner e admin, todas; quem pediu, as próprias | `answerSuggestion` | Sem exclusão | `firestore.rules:837-844`; `functions/core/src/domain/sugestao-gravacao.ts:114`, `:137` |
| Medidas, dias parado e alerta de estoque: sem dado pessoal pelo código (medidas por item e por tamanho da equipe; o alerta guarda quem decidiu, uid e papel) | `ai_measures`, `ai_stock_age`, `ai_stock_alerts` | Ver as regras citadas | `runMeasures`, `answerStockAlert` | `ai_measures` é recalculada (sai o que não vale mais); o resto, sem exclusão | `firestore.rules:814-862`; `functions/core/src/domain/medidas.ts:29-35`, `:79-103`; `functions/core/src/domain/medidas-gravacao.ts:94`; `functions/core/src/domain/alertas-parados-gravacao.ts:185-187` |
| Leitura da NF pela IA (no chat e em Envios): o arquivo inteiro vai ao Gemini; a extração guarda emitente, número, data, volumes, transporte e itens, "nunca o destinatário" | O arquivo em `operational-documents/{cliente}/…` (1.8); a extração em `agent_messages.context` | Ver as linhas da conversa e dos documentos | `chatWithDute`, `readShipmentInvoice` | O arquivo: sem exclusão | `functions/core/src/domain/agente-nota.ts:11-21`, `:26-42`, `:52-56`, `:79-103`; `functions/core/src/domain/invoice-reading.ts:26-34`, `:161-171`; `functions/wms/src/index.ts:7141`, `:7178-7190` |

### 1.8 Documentos e fotos de produto

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Documentos operacionais e anexos de envio e de recebimento (NF, comprovante, planilha; o aviso de recebimento do cliente): o arquivo, o nome, o resumo e os campos extraídos pela IA, o trecho do texto | Storage `operational-documents/{cliente}/{AAAA-MM}/{ts}-{nome}`; metadados e link em `documents` e na projeção `client_documents`; também em `customer_requests.attachments` | Pelo SDK do Storage, ninguém. O download é pelo link com token gravado em `file_url`, que abre o arquivo para quem tiver o link, sem prazo. `documents`: operação (e o financeiro, os de faturamento). `client_documents`: os mesmos e o cliente dono, se publicado | `uploadOperationalDocument`, `uploadShipmentAttachment`, `createDocumentUploadTarget`, `mutateManagedEntity`, `extractOperationalDocumentContent` | Sem exclusão do arquivo. Arquivar tira o link da projeção do cliente; o documento interno (com o link) e o arquivo ficam | `storage.rules:41-46`, `:175-177`; `functions/wms/src/index.ts:4379-4400`, `:4666-4758`, `:4953-4997`, `:5208-5292`, `:5310-5374`, `:6945-7005`; `firestore.rules:631-661`, `:1193-1211` |
| Fotos de produto | Storage `product-photos/…` | owner, admin, interno, wms, financeiro, suporte | owner, admin, interno, wms (imagem até 15 MB). A foto refeita pela IA pede produto sem pessoa; o prompt admite que a foto de origem pode ter uma pessoa | Sem exclusão: as regras proíbem trocar e apagar | `storage.rules:24-39`, `:47-54`; `functions/wms/src/index.ts:5094-5132`; `functions/wms/src/domain/product-photo.ts:117`, `:122-125` |

### 1.9 Empresas, faturamento e NF

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Documento da empresa cliente: CNPJ esperado. O WMS grava o texto sem validar (CPF não é recusado); o Comercial só aceita CNPJ ("o cadastro é de pessoa jurídica") | `customers/{id}.document` | operação e comercial | `mutateManagedEntity` (WMS), `saveCommercialCustomer` (Comercial) | Sem exclusão | `firestore.rules:912-917`; `functions/wms/src/domain/customer-profile.ts:210-280`, `:421-431`; `functions/comercial/src/domain/customer-identity.ts:237-246` |
| CNPJ ou CPF do cliente na emissão da NFS-e (aceita 11 ou 14 dígitos), enviado à Omie para achar o cadastro | `nf_emissoes/{id}.cnpj` | Ninguém pelo navegador (sem regra); `listNfEmissions` (Financeiro) | `emitNfOmie`, `runOmieSync` | Sem exclusão | `functions/financeiro/src/domain/emissao-gravacao.ts:65-76`, `:97`, `:109-118`; `functions/financeiro/src/domain/emissao-omie.ts:17`, `:305-310`, `:347-352`; `functions/financeiro/src/index.ts:49-90`; `firestore.rules:1254-1256` |
| Faturas, pagamentos e projeção do portal: valores e NF da empresa; o dado pessoal é só o ator | `faturas`, `pagamentos`, `client_faturas` | owner, admin, comercial, financeiro; o cliente dono, a projeção | `registerNf`, `advanceFatura`, rotina da Omie | Sem exclusão | `firestore.rules:757-779`; `functions/financeiro/src/domain/fatura-gravacao.ts:72` |

### 1.10 Cópias: backup, export e máquinas

| Dado | Onde fica | Quem lê | Quem grava | Quanto tempo fica hoje | Fonte |
|---|---|---|---|---|---|
| Firestore inteiro, qualquer minuto (PITR) | `(default)` e `dute-rh` do `dute-prod` | Quem tem acesso ao projeto pelo gcloud; restaurar é sempre para um banco novo, com o OK do Leonardo | O Firestore | 7 dias | `docs/plataforma/backup-e-recuperacao.md:13-15`, `:23-25`, `:45-54`; `CLAUDE.md:109-111` |
| Firestore inteiro, um backup por dia | Agendas do `dute-prod` (uma por banco). A homologação não tem backup; o `dute-rh` de lá tem PITR | Idem | O Firestore | 14 dias | `docs/plataforma/backup-e-recuperacao.md:16`, `:23-32` |
| Export do corte (o banco padrão de 20/10/2026, 03:17 UTC, 476 documentos) e exports do ensaio | `gs://dute-prod-migracao/corte-20261020/`; `gs://dute-homolog-migracao` | Quem tem acesso aos buckets | `gcloud firestore export` (roteiro manual) | Sem prazo: "apagar quando não forem mais necessários (decisão do Leonardo)" | `docs/plataforma/backup-e-recuperacao.md:18`; `docs/plataforma/fase-1-corte.md:398-400`, `:442` |
| Exports de uma recuperação (o banco antes e as coleções restauradas) | `gs://dute-prod-migracao/antes-da-recuperacao-*` e `recuperacao-*` | Idem | Roteiro manual | Sem prazo: o roteiro manda apagar só o banco de recuperação | `docs/plataforma/backup-e-recuperacao.md:114-129` |
| Zeragem de 16/10/2026: o banco inteiro (export) e os documentos apagados (JSON local) | `gs://dute-btg-firestore-backups/full-reset/full-reset-20261016T115746Z`; `.backups/full-reset-20261016T115746Z.json` na máquina de quem rodou | Quem tem acesso ao bucket; quem usa a máquina | `tools/full_reset_btg.py` | Sem prazo | `docs/novo-go-live-zeragem-total.md:118-121`, `:204`, `:224`; `tools/full_reset_btg.py:21-23`, `:840-847`; `tools/reset_btg_inventory.py:23`; `.gitignore:39` |
| Produção anterior inteira (Firestore, Storage e Auth) | Projeto `dute-btg`, congelado | Quem tem acesso ao projeto | — (congelado) | Até o Leonardo apagar; a volta pelo DNS vale até 02/12/2026 | `CLAUDE.md:117-120`; `docs/plataforma/fase-1-corte.md:392-397` |
| Fotos, anexos e documentos copiados no corte | `gs://dute-btg.firebasestorage.app`, copiado para `gs://dute-prod.firebasestorage.app` | Idem | `gcloud storage rsync` no corte | As duas cópias sem prazo | `docs/plataforma/fase-1-corte.md:244-246` |
| Saídas de trabalho na máquina do Leonardo: manifestos (por documento, caminho, hash dos campos e `update_time`; o caminho de `customer_accounts` pode ter e-mail); exports do Auth com hash de senha; documento baixado inteiro pelo `curl` do passo "ler o passado" | `tmp\fase-1\`, `tmp\backup\`, `.secrets\fase-1\` (fora do git) | Quem usa a máquina | `tools/migracao_firestore.py`, `firebase auth:export`, `curl` | Sem prazo. A única instrução de apagar é a dos manifestos do `dute-rh`, depois de comparar | `CLAUDE.md:384-390`; `.gitignore:5`, `:38`; `tools/migracao_firestore.py:5-9`, `:21-22`, `:196-201`; `docs/plataforma/fase-1-corte.md:24-26`, `:193-196`; `docs/plataforma/backup-e-recuperacao.md:75-81`, `:212-214` |
| Storage em geral (fotos, assinaturas, anexos, RH) | Buckets do Firebase de cada projeto | — | — | Sem backup e sem ciclo de vida no repositório: o backup descrito é do Firestore, e o runbook do RH diz que o bucket não tem versionamento. Apagar no Storage seria definitivo | `docs/plataforma/backup-e-recuperacao.md:1-6`; `docs/plataforma/fase-8-rh.md:441-446`; `deploy/cloud-storage/cors-dute-prod.json` |

### 1.11 Dados que saem para outros serviços (pelo código)

| Serviço | O que vai | Quando | Fonte |
|---|---|---|---|
| Resend (e-mail) | Destinatários, assunto e texto dos avisos | `runNotifications`, com `RESEND_API_KEY` | `functions/operacao/src/domain/avisos-gravacao.ts:222-238`; `functions/operacao/src/index.ts:184-185` |
| Provedor por webhook (Agent Dute do WMS) | Destinatários, assunto, corpo, e-mail de quem aprovou e de quem enviou | `decideOperationalNotification`, com `AGENT_DUTE_EMAIL_MODE=webhook` | `functions/wms/src/index.ts:1677-1726` |
| Omie | CNPJ ou CPF do cliente para achar o cadastro; a OS e a NF | `runOmieSync` | `functions/financeiro/src/domain/emissao-omie.ts:344-354` |
| Vertex AI (Gemini), multirregião `us`; a geração da foto de catálogo no `global` | Mensagens e histórico do chat, resultado das ferramentas, arquivos de NF e de documentos para leitura, fotos de produto | Chat, leitura de NF e de documento, foto de catálogo | `functions/core/src/domain/agente-modelo.ts:23-26`, `:39-53`; `functions/wms/src/index.ts:228-233`, `:1165-1176`, `:7178-7190`; `.env.example:20-21` |

## 2. CPF: onde aparece e quem vê

1. **`collaborators.cpf`** (banco padrão), obrigatório e único em todo vínculo,
   inclusive freelancer e terceiro.
   - Veem: owner, admin e interno, pelas regras. Não veem: campo, suporte,
     comercial, wms, financeiro, rh, painel e cliente
     (`firestore.rules:933-945`; `docs/plataforma/fase-3-operacao.md:246-248`).
   - O app baixa o CPF de todos os colaboradores no Início, em Hoje, na Agenda,
     em Planejar e em Colaboradores, e só mostra em Colaboradores
     (`artifacts/app/src/lib/operacao/use-inicio.ts:46`;
     `artifacts/app/src/pages/operacao/hoje.tsx:25`, `agenda.tsx:25`,
     `planejar.tsx:63`; `artifacts/app/src/lib/operacao/cadastro.ts:115-120`).
   - Fonte: `functions/operacao/src/domain/cadastro.ts:192-196`, `:249-264`;
     `functions/operacao/src/domain/gravacao.ts:159-163`.
2. **Exportação do RH** (`dute-rh` `exportacoes` e a planilha CSV), só vínculo
   próprio. Veem: owner, admin e rh, pela callable, com evento no download
   (`functions/rh/src/domain/exportacao-gravacao.ts:44-53`, `:158-181`). A ficha
   e o painel do RH não trazem o CPF (`functions/rh/src/domain/ficha-gravacao.ts:45-46`;
   `docs/plataforma/fase-8-rh.md:473-474`).
3. **Arquivo do tipo `cpf`** (e RG, CTPS) na ficha do RH, em `rh/**`. Veem:
   owner, admin e rh, por URL assinada, com evento
   (`functions/rh/src/domain/ficha.ts:36`; `functions/rh/src/domain/arquivos-gravacao.ts:176-192`).
4. **Documento do responsável do cliente** na conclusão da OS ("CPF ou RG",
   texto livre e opcional). Veem: owner, admin, interno, suporte, o campo escalado na OS e
   todo login do cliente dono com a Operação; sai impresso na OS e no PDF do
   comprovante (`functions/operacao/src/domain/conclusao.ts:83-90`;
   `firestore.rules:957-959`; `artifacts/app/src/lib/portal/comprovante.ts:94`;
   `artifacts/app/src/lib/operacao/os-documento.ts:129`;
   `docs/plataforma/fase-3-operacao.md:863-864`). Fica fora do evento, da TV e
   do Agent Dute.
5. **Documento de quem retira no armazém** (`orders.entrega.documento`, texto
   livre). Veem: owner, admin, interno, wms, suporte
   (`functions/wms/src/domain/order-delivery.ts:122-131`; `firestore.rules:1016-1019`).
6. **Documento da empresa** (`customers.document`) quando um cliente pessoa
   física for cadastrado pelo WMS, que não valida; e a cópia em
   `nf_emissoes.cnpj`, que vai à Omie (`functions/wms/src/domain/customer-profile.ts:259-279`;
   `functions/financeiro/src/domain/emissao-gravacao.ts:65-76`). A carga de
   clientes da Omie deixa a pessoa física de fora
   (`functions/comercial/src/cargas/clientes-omie.ts:259-264`, `:391-393`).
7. **Arquivos que podem ter CPF sem o sistema saber**: NFs e documentos
   anexados no portal, em Envios, em Documentos e no chat; fotos da OS. O código
   não inspeciona o conteúdo; o OCR dos documentos transcreve todo texto
   visível para `documents.content_excerpt` e para a base de conhecimento
   (`functions/wms/src/index.ts:1165-1176`, `:5686`, `:5722-5762`).

**Papel que vê CPF que não usa, comparando com `lib/dominio` e
`docs/modulos-e-permissoes.md`:**

- **suporte.** Trabalha em wms e operação (`lib/dominio/src/index.ts:72`);
  o papel é diagnóstico, "preferencialmente em modo leitura" e "com menor
  acesso a dados comerciais sensíveis quando possível"
  (`docs/modulos-e-permissoes.md:83`, `:92-93`, `:174-176`). Lê o documento do
  responsável e a assinatura de toda OS (`firestore.rules:149-151`;
  `storage.rules:126`) e o documento de quem retira (`firestore.rules:80-82`,
  `:1016-1019`). O próprio cadastro da Operação já tira o suporte por causa do
  CPF (`artifacts/app/src/lib/operacao/navegacao.ts:14`).
- **campo.** Digita o documento do responsável na conclusão e continua lendo a
  OS inteira, com ele, enquanto estiver em `equipe_uids`, sem limite de status
  (`firestore.rules:156-158`; `storage.rules:69-73`, `:127`).
- **cliente.** Todo login do cliente dono lê o documento do responsável na OS e
  no comprovante, inclusive quem não esteve na OS (`firestore.rules:206-208`,
  `:958`; `artifacts/app/src/lib/portal/comprovante.ts:94`).
- **interno.** O cadastro é dele (`functions/operacao/src/domain/platform-roles.ts:26-27`),
  mas o navegador dele recebe o CPF e o telefone de todos também nas telas de
  planejamento, que não os mostram (as regras não filtram campo).
- **CPF de freelancer e terceiro.** É obrigatório, e o único consumidor do CPF,
  a exportação do RH, só usa o vínculo próprio
  (`functions/rh/src/domain/exportacao.ts:17-21`;
  `functions/rh/src/domain/exportacao-gravacao.ts:44-48`). Fora dela, o CPF
  serve só à checagem de duplicidade (`functions/operacao/src/domain/gravacao.ts:159-163`).
- **owner e admin** leem o RH por decisão (pergunta 23,
  `docs/plataforma/fase-8-rh.md:31`); o rh não vê CPF na ficha. Sem
  divergência.

## 3. Registro de quem acessou o quê

**Já registrado como evento:**

- **Abertura do arquivo do RH** (`rh.file_opened`): quem abriu (uid, e-mail,
  nome, papel), o registro e o colaborador, gravado antes de a URL sair
  (`functions/rh/src/domain/arquivos-gravacao.ts:171-192`;
  `functions/rh/src/domain/events.ts:44-45`, `:78`).
- **Download da exportação do RH** (`rh.export_downloaded`): quem baixou, a
  versão e a planilha (`functions/rh/src/domain/exportacao-gravacao.ts:158-181`;
  `functions/rh/src/domain/events.ts:80`).
- **Toda gravação** das codebases (invariante 2), com o ator: presença, foto,
  conclusão, cadastro, ficha do RH, remoção de acesso, aceite de convite
  interno (`CLAUDE.md:354-355`; linhas da seção 1.6).
- **Agent Dute:** cada resposta guarda as ferramentas usadas, por pessoa
  (`agent_messages.tools_used`, `agent_usage.tools_used`), não os registros que
  a ferramenta leu (`functions/core/src/domain/agente-conversa.ts:258-296`).
- **Sino do portal:** até quando cada login viu os avisos
  (`functions/operacao/src/domain/avisos-gravacao.ts:245-264`). Não é registro
  de leitura de dado.

**Limites do que já existe:**

- Os eventos do RH ficam no `events` do `dute-rh`, que nenhuma tela nem
  callable lê; só quem tem acesso ao banco pelo console
  (`firestore-rh.rules:9-11`; `functions/rh/src/index.ts:39-103`).
- A URL assinada do arquivo do RH vale 5 minutos e pode ser aberta mais de
  uma vez, ou por outra pessoa, nesse tempo; só a emissão é registrada
  (`functions/rh/src/domain/arquivos-gravacao.ts:42`, `:176-192`).
- A planilha baixada, com CPF, sai do sistema; o que acontece depois não é
  registrado.

**Leituras sensíveis sem registro:**

- A ficha do RH com o resultado dos exames (`getRhFicha`) e o painel do RH
  (`functions/rh/src/domain/ficha-gravacao.ts:331-416`).
- O CPF, o telefone e a CNH em `collaborators`, lidos direto do Firestore por
  owner, admin e interno (`firestore.rules:942-945`).
- A OS (documento e nome do responsável, contatos no local, presenças), lida
  direto por owner, admin, interno, suporte, campo escalado e cliente; o
  comprovante e a OS impressa (`firestore.rules:957-960`).
- As fotos e as assinaturas da OS, os anexos do portal e as fotos de produto,
  lidos pelo SDK do Storage (`storage.rules:47-54`, `:105-169`).
- Os documentos operacionais, abertos pelo link com token permanente de
  `file_url` (`functions/wms/src/index.ts:5325-5333`, `:5369`, `:6960-6968`, `:7004`).
- `customer_contacts`, `customer_accounts`, `users`, `invites`, `email_outbox`
  e `events`, lidos direto pelos papéis das regras.
- `lookupInvite`, que devolve e-mail e nome a quem tiver o token, sem login
  (`functions/wms/src/index.ts:3060-3080`).
- A leitura pela plataforma (Cloud Audit Logs de acesso a dados) não está
  configurada no repositório; ver "Dúvidas".

## 4. O que falta para o item do plano

### 4.1 Retenção e exclusão de fotos, assinaturas e dados de campo

1. **Fotos e assinaturas da OS não têm prazo nem rotina de exclusão.** As
   regras proíbem apagar (`storage.rules:118`, `:136`), não há ciclo de vida
   no bucket e o Storage não tem backup. Mudariam:
   - uma rotina nova em `functions/operacao/src/index.ts`, com o domínio e a
     gravação em `functions/operacao/src/domain/` e o tipo de evento em
     `functions/operacao/src/domain/events.ts`; ou um arquivo de ciclo de vida
     em `deploy/cloud-storage/`, aplicado à mão como o CORS;
   - a leitura da foto ou da assinatura que não existe mais:
     `functions/operacao/src/domain/fotos.ts`, `conclusao.ts`,
     `artifacts/app/src/lib/portal/comprovante.ts`,
     `artifacts/app/src/lib/operacao/ficha-da-os.ts`,
     `artifacts/app/src/lib/operacao/os-documento.ts`,
     `artifacts/app/src/lib/comercial/vistoria-da-operacao.ts`;
   - `docs/plataforma/fase-3-operacao.md`, `docs/plataforma/backup-e-recuperacao.md`.
   - `storage.rules` não precisa mudar se a exclusão for pelo Admin SDK.
2. **Os dados de campo identificáveis ficam na OS sem prazo**: presenças,
   `informado_por` e `registrado_por`, ocorrências e legendas em texto livre,
   `pedido_por`, contato no local, nome e documento do responsável, também em
   `revisoes_anteriores`. Mudariam: a rotina acima;
   `functions/operacao/src/domain/presencas.ts`, `execucao.ts`,
   `itens-executados.ts`, `conclusao.ts`, `revisao-gravacao.ts` (ler o
   registro anonimizado); conferir `functions/core/src/domain/medidas.ts` e
   `lembrancas.ts`, que usam contagens e instantes, não nomes.
3. **Os eventos de campo em `events`** (id do colaborador com o instante de
   presença e de etapa) não expiram. Mudariam: `functions/operacao/src/domain/events.ts`
   (um campo de expiração) e a política de TTL do banco, hoje inexistente
   (`firestore.indexes.json:950`; `docs/plataforma/backup-e-recuperacao.md:86`).
4. **Os metadados das fotos (EXIF) não são removidos** antes de subir.
   Mudariam: `artifacts/app/src/lib/operacao/enviar-foto.ts:17-34`,
   `artifacts/app/src/lib/campo/os-no-campo.ts:326-343`,
   `artifacts/app/src/lib/campo/fila-do-campo.tsx:46-53`. O app já regrava
   imagem no navegador em `artifacts/app/src/lib/attachment-compact.ts:195-223`,
   hoje só para anexos grandes de Envios.

### 4.2 CPF só onde o papel precisa

1. **CPF obrigatório para freelancer e terceiro.** Mudariam:
   `functions/operacao/src/domain/cadastro.ts:192-196`, `:249-283`;
   `functions/operacao/src/domain/gravacao.ts:159-163`;
   `artifacts/app/src/pages/operacao/cadastro-view.tsx:241-242`;
   `artifacts/app/src/lib/operacao/cadastro.ts:84`, que hoje descarta da lista
   quem não tem CPF.
2. **O navegador do interno recebe CPF e telefone de todos nas telas de
   planejamento.** A regra vale para o documento inteiro, então a saída é uma
   projeção sem CPF gravada por `saveCollaborator`
   (`functions/operacao/src/domain/gravacao.ts`, `firestore.rules:938-945` com
   uma coleção nova) ou levar o CPF ao `dute-rh`
   (`functions/rh/src/domain/exportacao-gravacao.ts:45-52` passaria a ler de
   lá). Telas: `artifacts/app/src/pages/operacao/hoje.tsx:25`, `agenda.tsx:25`,
   `planejar.tsx:63`, `artifacts/app/src/lib/operacao/use-inicio.ts:46`.
3. **O documento do responsável na OS** é lido por suporte, campo e todo login
   do cliente, e sai impresso e no PDF. Mudariam:
   `functions/operacao/src/domain/conclusao.ts:83-90`;
   `artifacts/app/src/lib/campo/concluir.ts:146-157`;
   `artifacts/app/src/lib/operacao/andamento.ts:203-212`;
   `artifacts/app/src/lib/portal/comprovante.ts:94`;
   `artifacts/app/src/lib/operacao/ficha-da-os.ts:499`;
   `artifacts/app/src/lib/operacao/os-documento.ts:129`. Para restringir quem
   lê, o campo teria de ir para um documento à parte, com regra própria em
   `firestore.rules:957-960`; a assinatura, em `storage.rules:124-137`.
4. **O documento de quem retira** é lido por wms e suporte, sem prazo:
   `functions/wms/src/domain/order-delivery.ts:122-131`, `firestore.rules:1016-1019`.
5. **O WMS aceita CPF em `customers.document`** e a emissão aceita 11 dígitos:
   `functions/wms/src/domain/customer-profile.ts:210-280`,
   `functions/financeiro/src/domain/emissao-gravacao.ts:65-76`.
6. **O contato principal em `customers`** é lido por interno, wms e suporte,
   enquanto `customer_contacts` só abre a owner, admin e comercial:
   `functions/wms/src/index.ts:3703-3718`, `firestore.rules:912-917`.

### 4.3 Registro de quem acessou o quê

1. **Não há registro das leituras de CPF, do documento e da assinatura do
   responsável, das fotos da OS nem da ficha do RH.** O molde existe no RH:
   leitura por callable que grava o evento antes de entregar.
   - RH: `functions/rh/src/domain/ficha-gravacao.ts:331-416` e um tipo novo em
     `functions/rh/src/domain/events.ts:27-45`.
   - Operação: callables novas em `functions/operacao/src/index.ts`; fechar o
     SDK em `storage.rules:105-137` e abrir por URL assinada; ajustar
     `artifacts/app/src/lib/portal/comprovante.ts` e
     `artifacts/app/src/lib/operacao/ficha-da-os.ts`.
   - CPF do colaborador: só por callable (depende de 4.2.2).
2. **Nenhuma tela lê o registro do RH.** Mudariam: `functions/rh/src/index.ts`
   (uma callable de listagem) e `artifacts/app/src/pages/rh/`.
3. **Os documentos operacionais abrem por link com token permanente.**
   Mudariam: `functions/wms/src/index.ts:5325-5333`, `:5369`, `:6960-6968`,
   `:7004` (URL assinada curta) e quem lê `file_url` no app.
4. **A URL assinada do RH pode ser reaberta em 5 minutos.** Mudaria:
   `functions/rh/src/domain/arquivos-gravacao.ts:42`.
5. **Eventos com nome e e-mail abertos a wms e suporte.** Mudariam:
   `functions/wms/src/domain/access.ts:79-99`; `artifacts/app/src/App.tsx:677-701`;
   `functions/wms/src/index.ts:4029-4035`, `:5040-5075`;
   `firestore.rules:121-123`, `:789-792`.
6. **O registro de leitura da plataforma** (Cloud Audit Logs) é configuração
   do projeto, fora do repositório.

### 4.4 Demais retenções e cópias

1. **RH depois do desligamento.** O colaborador só é desativado
   (`functions/operacao/src/domain/cadastro.ts:425-431`); os registros, os
   arquivos (com os anteriores) e as exportações com CPF ficam. Mudariam:
   `functions/rh/src/index.ts` (rotina), `functions/rh/src/domain/ficha-gravacao.ts`,
   `arquivos-gravacao.ts`, `exportacao-gravacao.ts`, e o cadastro da Operação.
2. **Coleções sem prazo**: `email_outbox`, `client_notifications`,
   `client_notification_reads`, `service_requests` e anexos,
   `operational_notifications`, `agent_conversations`, `agent_messages`,
   `agent_usage`, `ai_agent_knowledge_file_chunks`, `customer_accounts`, e
   `users`, `invites` e contas do Auth de quem saiu. Mudariam:
   `functions/operacao/src/domain/avisos-gravacao.ts`,
   `functions/core/src/domain/agente-conversa.ts`,
   `functions/wms/src/domain/access.ts`, `functions/wms/src/index.ts:6855-6873`,
   e a política de TTL do banco.
3. **Cópias sem prazo**: os exports do corte, do ensaio, das recuperações e da
   zeragem, `.backups/`, `.secrets\fase-1\`, `tmp\` e o projeto `dute-btg`.
   Mudariam: `docs/plataforma/backup-e-recuperacao.md`,
   `docs/plataforma/fase-1-corte.md`, `docs/novo-go-live-zeragem-total.md`, e
   `tools/full_reset_btg.py:840-847` com `tools/reset_btg_inventory.py:23`
   (backup local). Uma exclusão na produção continua no PITR por até 7 dias e
   no backup por até 14 (`docs/plataforma/backup-e-recuperacao.md:15-16`).

## 5. Perguntas para o Leonardo

1. **Fotos do final e assinatura da OS** (o aceite e a prova do faturamento):
   por quanto tempo guardar?
   Recomendação: guardar enquanto a demanda não estiver paga e, depois, pelo
   prazo em que a contabilidade guarda a NF dessa demanda (confirmar com ela);
   vencido o prazo, apagar o arquivo e deixar na OS só a marca de que existiu.
2. **Fotos das etapas, das ocorrências e da vistoria**, que não vão ao
   cliente: o mesmo prazo ou menor?
   Recomendação: menor, por exemplo 12 meses depois de a OS ficar revisada,
   salvo a foto ligada a divergência cobrada ou a aditivo, que segue a
   pergunta 1.
3. **Documento (CPF ou RG) do responsável do cliente** na conclusão, e o de
   quem retira no armazém: continuar pedindo?
   Recomendação: deixar de pedir o número (nome, cargo e assinatura no aceite;
   nome e placa na retirada); se precisar, guardar e mostrar mascarado, e tirar
   o suporte da leitura.
4. **Dados de campo identificáveis** (presença, quem informou cada etapa, quem
   pediu no local, contato no local): até quando com o nome?
   Recomendação: identificáveis até fechar o pagamento das diárias e a revisão
   da OS, mais um prazo curto (por exemplo 12 meses); depois, só as contagens e
   os tempos, que é o que a memória usa.
5. **RH depois que a pessoa sai**: por quanto tempo guardar registros, exames
   com resultado, arquivos e exportações com CPF, e quem dispara a exclusão?
   Recomendação: fixar com a contabilidade e com quem cuida da saúde e
   segurança o prazo de cada tipo de registro; vencido, apagar arquivos e
   registros e reduzir o cadastro a nome e id; quem dispara é o rh, com evento.
6. **CPF de freelancer e terceiro**: continuar obrigatório?
   Recomendação: não pedir (ou deixar opcional), porque a exportação só usa o
   vínculo próprio; e levar o CPF do próprio para o banco `dute-rh`, onde a
   exportação já roda.
7. **Versões da exportação do RH**: guardar todas, com CPF?
   Recomendação: guardar a última de cada competência; das substituídas,
   manter só o hash e as contagens depois de um prazo curto.
8. **Avisos, fila de e-mail, solicitações do portal com anexos, conversas e
   uso do Agent Dute, contas e convites de quem saiu**: que prazo?
   Recomendação: e-mail e aviso, 90 dias depois do envio (fica a contagem);
   conversa e uso do agente, 12 meses; solicitação e anexo seguem a demanda;
   conta removida há mais de 12 meses: apagar a conta do Auth e anonimizar o
   perfil.
9. **Quais leituras registrar e quem confere o registro?**
   Recomendação: registrar, como já é feito no arquivo do RH, a abertura da
   ficha do RH, o CPF do colaborador, o documento e a assinatura do
   responsável e as fotos da OS, servindo-os por callable; uma tela só para o
   owner com esse registro; decidir à parte se liga o Cloud Audit Logs de
   leitura no `dute-rh` e no Storage.
10. **Cópias**: quando apagar o `dute-btg`, os exports do corte, do ensaio e da
    zeragem, os backups locais (`.backups/`) e os exports do Auth
    (`.secrets\fase-1\`)?
    Recomendação: o `dute-btg` e os exports dele até 02/12/2026, fim da volta
    pelo DNS; os exports do Auth e os manifestos da Fase 1 quando o corte não
    precisar mais de volta; ciclo de vida nos buckets de export.
11. **Contato principal em `customers`**, lido por interno, wms e suporte:
    manter?
    Recomendação: passar para `customer_contacts`, que só owner, admin e
    comercial leem.
12. **Processamento do Agent Dute, da leitura de NF e das fotos de produto no
    Vertex AI em `global`**: manter ou fixar uma região?
    Recomendação: se a região importa para a Dutelog, fixar uma onde os
    modelos usados existam e registrar a decisão no runbook da Fase 5.

### Decisões do Leonardo (26/10/2026)

1. **Fotos do final e assinatura da OS:** não apagar depois do pagamento.
   O cliente pode pedir uma consulta meses depois, então ficam guardadas
   por um prazo maior, que o Leonardo ainda fixa. A sugestão é 5 anos, o
   prazo de guarda dos documentos fiscais da NF.
2. **Fotos das etapas, das ocorrências e da vistoria:** como recomendado,
   12 meses depois de a OS ficar revisada. A foto ligada a divergência
   cobrada ou a aditivo segue o item 1.
3. **Documento do responsável e de quem retira:** como recomendado. Deixa
   de pedir o número: na conclusão, nome, cargo e assinatura; na retirada,
   nome e placa. A mudança no formulário vem com o alinhamento da tela.
4. **Dados de campo identificáveis:** ficam como estão, com o nome.
5. **RH depois que a pessoa sai:** 2 anos depois do desligamento, com todo
   o histórico do colaborador nesse tempo. Depois, apagar os arquivos e os
   registros e deixar o nome e o id, com o rh disparando e o evento. Antes
   de apagar exame, confirmar com a medicina do trabalho: a NR-7 pede um
   prazo maior para o prontuário médico.
6. **CPF de freelancer e terceiro:** continua obrigatório.
7. **Versões da exportação do RH:** como recomendado, a última de cada
   competência; das substituídas, só o hash e as contagens depois de um
   prazo curto.
8. **Avisos, fila de e-mail, solicitações, conversas e contas de quem
   saiu:** como recomendado. E-mail e aviso, 90 dias; conversa e uso do
   agente, 12 meses; solicitação e anexo seguem a demanda; conta removida
   há mais de 12 meses: apagar a conta do Auth e anonimizar o perfil.
   **Os avisos e os e-mails entraram em 26/10/2026** (seção 6, parte 8a),
   **a conversa e o uso do agente** (parte 8b) e **as contas removidas**
   (parte 8c), também, ligados só na homologação.
9. **Registro de leitura:** como recomendado, com a tela só para o owner.
   O Cloud Audit Logs de leitura fica para decidir à parte.
10. **Cópias:** como recomendado. O `dute-btg` e os exports dele até
    02/12/2026, os exports do Auth e os manifestos da Fase 1 quando o corte
    não precisar mais de volta, e ciclo de vida nos buckets de export.
11. **Contato principal do cliente:** fica onde está. A equipe de campo
    precisa ver o contato do responsável por acompanhar a atividade: o app
    do campo passa a mostrar o contato do local da OS (nome e telefone),
    com o alinhamento da tela.
12. **Região do Vertex AI:** como recomendado, fixar uma região onde os
    modelos usados existam e registrar no runbook da Fase 5.
    **Feito em 26/10/2026:** nenhum dos modelos existe no Brasil. Os de texto
    foram para a multirregião `us`, que processa nos Estados Unidos; a
    geração da foto do catálogo fica no `global`, o único local do modelo,
    sem dado de pessoa (`fase-5-memoria.md`, "LGPD, decisão 12").

## 6. A retenção no código

Cada codebase apaga o que é dela, numa rotina diária com a liberação própria
da retenção: liga primeiro na homologação, e a produção só com o OK do
Leonardo, num PR que põe o `dute-prod` na lista. O evento de cada rodada
guarda só as contagens.

| Parte | O que sai | Prazo | Rotina | Ligada em |
|---|---|---|---|---|
| 8a | Aviso do sino (`client_notifications`) e e-mail que já saiu da fila (`email_outbox`: enviado, auditado ou desistido) | 90 dias depois de criados | `runOperacaoRetention` (Operação, 03:20) | homologação |
| 8b | Mensagem e registro de uso do Agent Dute (`agent_messages`, `agent_usage`) e conversa parada (`agent_conversations`); da conversa em uso, o título e o resumo das mensagens que saíram | 12 meses depois de criados; a conversa, 12 meses depois da última mensagem | `runAgentRetention` (núcleo, 03:40) | homologação |
| 8c | Conta do Firebase Auth de quem teve o acesso removido; do perfil (`users`), o nome, o e-mail e o motivo; do convite usado, o nome e o e-mail; as rotinas do Agent Dute da pessoa | 12 meses depois de o acesso sair | `runAccountRetention` (WMS, 03:50) | homologação |

### Parte 8a: os avisos e os e-mails (decisão 8)

Feita em 26/10/2026.

- **O que sai:** o aviso do sino e o e-mail da fila com mais de 90 dias,
  pelo `created_at`.
  - O e-mail pendente fica: a fila o tenta até enviar ou desistir.
  - O evento que deu o aviso continua em `events`, sem dado pessoal.
- **O que fica:** o evento `retention.applied`, da Operação, com quantos
  avisos e e-mails saíram, de antes de qual dia e por cliente.
  - Fica sem destinatário, assunto nem texto, e sem `customer_code`, porque
    a contagem é de todos os clientes.
  - A zeragem o preserva, como os outros eventos da Operação.
- **Apagar não refaz o aviso:** a rotina dos avisos anda só para a frente,
  pelo cursor. O sino do portal lista os mais recentes, e o
  `client_notification_reads` (até quando cada login leu) não muda.
- **A rotina:**
  - `runOperacaoRetention`, todo dia às 03:20 de São Paulo, uma instância por
    vez;
  - lê até 400 de cada coleção por vez, até 10 vezes por rodada, e o resto
    fica para o dia seguinte;
  - a leitura dos e-mails segue depois do último lido, para o pendente antigo
    não segurar os outros.
- **A liberação:** `RETENCAO_AMBIENTES_LIBERADOS` em
  `functions/operacao/src/domain/liberacao.ts`, só o `dute-homolog`.
  - A trava das rotinas agendadas (`callables.test.ts`) exige que esta
    confira a liberação dela antes de tudo.
- **Testes:**
  - `retencao.test.ts`: o prazo, o status que sai, o id da rodada e a
    contagem por cliente; o payload recusa e-mail, texto e contagem negativa.
  - `retencao.integration.test.ts`, no emulador:
    - sai o velho, ficam o recente e o pendente;
    - o evento tem as contagens por cliente e nenhum e-mail;
    - rodar de novo não apaga nem grava mais nada;
    - o pendente no começo da fila não segura os outros;
    - o que não coube na rodada fica para a próxima.
  - `events.test.ts` e `liberacao.test.ts`, com o tipo e a lista novos.
- **Para desligar:** tirar o projeto da lista e publicar. O que já saiu volta
  só pelo backup (PITR de 7 dias e backup diário de 14), para um banco novo
  (`backup-e-recuperacao.md`).

### Parte 8b: o Agent Dute (decisão 8)

Feita em 26/10/2026. As coleções são as mesmas para o agente do núcleo e o
do WMS, então a rotina do núcleo cuida das duas conversas.

- **O que sai:**
  - a mensagem (`agent_messages`) e o registro de uso (`agent_usage`) com
    mais de 12 meses, pelo `created_at`;
  - a conversa (`agent_conversations`) parada há mais de 12 meses, pelo
    `updated_at`, que os dois agentes mudam a cada mensagem.
- **A conversa que continua em uso** perde o que guardava das mensagens que
  saíram:
  - o título, que é a primeira pergunta (o app mostra "Conversa" no lugar);
  - o resumo das mensagens antigas, que o agente refaz com as que ficaram.
  - O título da conversa da rotina é o nome dela e fica.
  - A limpeza vem antes de apagar as mensagens: a rodada que parar no meio
    limpa de novo no dia seguinte.
- **O que fica:** o evento `agente.retencao_aplicada`, do núcleo, um por
  cliente, com quantas mensagens, conversas e registros de uso saíram, de
  antes de qual dia, e quantas conversas em uso foram limpas.
  - Fica sem texto, título nem e-mail.
  - Quem grava é a rotina (autor `sistema`), e ela não grava nenhum outro
    evento do núcleo.
  - O registro sem `customer_code` sai, mas fica só na contagem do log.
- **O anexo do chat não sai com a mensagem:** o arquivo sobe na pasta dos
  anexos das solicitações do cliente e pode ir junto no aviso de envio, então
  segue a solicitação ("solicitação e anexo seguem a demanda", ainda sem
  parte).
- **A rotina:**
  - `runAgentRetention`, todo dia às 03:40 de São Paulo, uma instância por
    vez;
  - lê até 400 de cada coleção por vez, até 10 vezes por rodada, e o resto
    fica para o dia seguinte.
- **A liberação:** `RETENCAO_AMBIENTES_LIBERADOS` em
  `functions/core/src/domain/liberacao.ts`, só o `dute-homolog`, separada da
  liberação do agente.
  - A trava das rotinas agendadas (`callables.test.ts`) exige que esta
    confira a liberação dela antes de tudo.
- **Testes:**
  - `retencao-do-agente.test.ts`: o prazo, o id da rodada, a contagem por
    cliente, o payload só com contagens e o autor do evento (só a rotina).
  - `retencao-do-agente.integration.test.ts`, no emulador:
    - sai o velho e fica o recente;
    - a conversa em uso perde o título e o resumo, e o resto dela fica;
    - a conversa da rotina fica com o título, e a sem mensagem velha não
      muda;
    - o evento de cada cliente tem as contagens, sem texto nem e-mail;
    - rodar de novo não apaga nem grava mais nada;
    - o que não coube na rodada fica para a próxima.
- **Para desligar:** tirar o projeto da lista e publicar. O que já saiu volta
  só pelo backup, para um banco novo.

### Parte 8c: as contas removidas (decisão 8)

Feita em 26/10/2026. O WMS é dono do acesso (`setUserAccess`), então a rotina
fica nele.

- **Quando:** 12 meses depois de o acesso sair, pelo `access_changed_at` que o
  `setUserAccess` grava. O acesso que voltou fica, mesmo com a data antiga; o
  perfil removido sem a data fica e entra na contagem `sem_data` do log.
- **O que sai:**
  - a conta do Firebase Auth (o login);
  - do perfil (`users/{uid}`), o nome, o e-mail e o motivo da remoção;
  - do convite que a conta usou (`invites`, com `used_by` igual ao uid), o
    nome e o e-mail;
  - as rotinas do Agent Dute da pessoa (`agent_routines`), paradas desde que o
    acesso saiu. A conversa delas sai pela parte 8b.
- **O que fica no perfil:** o papel, o cliente, o convite, as datas e quem
  removeu o acesso, com `anonymized_at`. Os eventos e os registros dos
  módulos apontam para o uid.
  - Sem e-mail, o perfil sai da lista de Pessoas e acessos, que ordena pelo
    e-mail.
  - O "devolver acesso" do perfil anonimizado é recusado: a pessoa volta só
    por convite novo, com outro login.
- **O que fica fora do perfil:**
  - os eventos ficam como foram gravados. O `user.access_revoked` guarda o
    nome ou o e-mail e o motivo; os eventos e os recibos do que a pessoa fez
    guardam o nome e o e-mail dela como autor. São a trilha de quem fez o quê
    (invariante 2);
  - os registros dos módulos com o nome de quem fez cada coisa (decisão 4);
  - `customer_accounts`, o cadastro das contas do cliente, que tem o próprio
    arquivamento.
- **O evento:** `user.account_anonymized`, um por conta, com o papel, o dia em
  que o acesso saiu, se o convite foi limpo e quantas rotinas saíram. Fica
  sem nome, e-mail nem motivo, e quem grava é a rotina (autor `sistema`).
- **A ordem:** o login sai primeiro, e o perfil, o convite, as rotinas e o
  evento, depois, numa transação que relê o perfil.
  - A falha no Auth deixa a conta para o dia seguinte.
  - A conta que já não está no Auth conta como apagada.
  - A conta já anonimizada não volta à rotina.
- **A rotina:** `runAccountRetention`, todo dia às 03:50 de São Paulo, uma
  instância por vez, até 100 contas por rodada.
- **A permissão:** quem apaga o login é a conta de runtime das Functions. O
  `setUserAccess` já atualiza e revoga com ela, mas o repositório não
  registra se o papel dela no Auth também apaga. Sem a permissão, o log
  mostra "login não apagado", a contagem `falhas` sobe e o perfil fica como
  está.
- **A liberação:** `ACCOUNT_RETENTION_PROJECTS` em
  `functions/wms/src/domain/account-retention.ts`, só o `dute-homolog`.
- **Testes:**
  - `account-retention.test.ts`: o prazo, a data da remoção (texto ou data do
    Firestore), quem sai e quem fica, a liberação e a trava da rotina (todo
    dia, uma instância, a liberação antes de tudo).
  - `account-retention.integration.test.ts`, no emulador:
    - o login sai, o perfil e o convite ficam sem nome e e-mail, as rotinas
      da pessoa saem e o evento não leva nada dela;
    - o evento da remoção fica como foi gravado;
    - o removido há menos de 12 meses, o devolvido e o sem data ficam;
    - a conta fora do Auth também fica anônima, e a falha no Auth deixa o
      perfil para o dia seguinte;
    - rodar de novo não apaga nem grava mais nada;
    - o convite usado por outra conta fica, e o que não coube na rodada fica
      para a próxima;
    - o "devolver acesso" da conta anonimizada é recusado.
- **Para desligar:** tirar o projeto da lista e publicar. O login apagado não
  volta: a pessoa entra de novo por convite.

## Dúvidas

- **EXIF das fotos.** O app sobe o arquivo escolhido sem regravar
  (`artifacts/app/src/lib/operacao/enviar-foto.ts:34`). Se a foto da câmera
  traz GPS nos metadados depende do aparelho e do navegador; não dá para saber
  pelo código.
- **Registros da plataforma.** O repositório não configura o Cloud Audit Logs
  de acesso a dados do Firestore e do Storage nem a retenção do Cloud Logging e
  dos logs do Load Balancer e do Cloud Run (endereço IP). Nos logs das
  Functions, o que se viu de pessoal foi o nome do arquivo em alguns logs de
  falha (`functions/core/src/domain/agente-nota.ts:105`;
  `functions/wms/src/index.ts:5336`, `:6971`).
- **Versionamento e exclusão temporária nos buckets.** O runbook do RH diz que
  o bucket não tem versionamento (`docs/plataforma/fase-8-rh.md:444-446`); a
  configuração de exclusão temporária do Cloud Storage não está no
  repositório.
- **Manifestos do RH.** O roteiro de backup dizia que os manifestos do
  `dute-rh` "têm CPF e exames", mas a ferramenta grava só o caminho, o hash dos
  campos e o `update_time` (`tools/migracao_firestore.py:5-9`, `:196-201`): a
  frase foi corrigida junto com este inventário. O passo "ler o passado"
  baixa o documento inteiro com `curl` (`docs/plataforma/backup-e-recuperacao.md:75-81`).
- **CPF em `customers.document` hoje.** O código permite pelo WMS; se algum
  cadastro de produção tem CPF, só lendo o banco.
- **TTL.** A política de TTL do Firestore precisa de um campo de data em cada
  documento e da política no banco; não conferi se a versão do firebase-tools
  da publicação aceita declará-la no `firestore.indexes.json` ou se exige
  `gcloud`.
- **DELETE genérico no app.** `artifacts/app/src/lib/cloud-api.ts:4121-4139`
  tem rota de DELETE para `users`; as regras recusam (`firestore.rules:674`),
  então não é caminho de exclusão.
- **Homologação.** O runbook diz que os dados da homologação são de teste
  (`docs/plataforma/backup-e-recuperacao.md:30-32`); não conferi o banco.
- **Possíveis dados reais no repositório** (só os arquivos, sem copiar):
  - `functions/wms/src/index.ts:1525`: um primeiro nome de pessoa num texto
    fixo, aparentemente contato do cliente legado.
  - Testes com CPF formatado e e-mails de domínio corporativo, presumivelmente
    fictícios e não conferidos, por exemplo
    `functions/operacao/src/domain/cadastro.test.ts`,
    `functions/rh/src/domain/exportacao.test.ts`,
    `functions/comercial/src/cargas/clientes-omie.test.ts`,
    `artifacts/app/src/pages/operacao/cadastro-view.test.tsx`.
  - `docs/plataforma/fase-3-operacao.md:890` usa um nome completo de exemplo,
    aparentemente fictício.
  - `attached_assets/` (duas planilhas e quatro imagens) não foi aberto.
