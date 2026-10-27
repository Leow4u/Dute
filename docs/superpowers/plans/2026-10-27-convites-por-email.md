# Plano de implementação

1. WMS: testar primeiro criação/fila atômicas, idempotência, autorização e reenvio. Enfileirar junto do convite; validar reenvio sem permitir alteração de destinatário, papel ou cliente.
2. Operação: estender o worker existente para convites, com revalidação, origem por ambiente, tentativas e erros sem token. Atualizar estado somente da geração corrente; incluir cancelados na retenção. Testar no emulador sem provedor real.
3. App: criação/reenvio com texto de agendamento, situação do e-mail e cópia como alternativa; rota para reenvio. Testar sucesso, falha e permissões existentes.
4. Executar suites relevantes, typecheck/build e revisão independente. Documentar limites reais e abrir PR draft se disponível, sem merge/deploy.

## Foco da revisão

- Repetir a mesma mutação não duplica o envio; reenvio explícito usa nova chave.
- Dados do reenvio não podem trocar o acesso nem o endereço do convite.
- Convite revogado/usado/portal desligado não deve gerar envio posterior.
- Falhas nunca expõem link/token, nem são apresentadas como entrega confirmada.
- Homologação usa sua origem e só envia a endereços internos.

## Validação executada

- App: suíte completa, 248 arquivos / 2.863 testes; teste final das telas de convite e rota, 41 testes. Typecheck das bibliotecas, app e site e build do app passaram.
- WMS: 288 unitários, 28 integrações de acessos/convite/aceite e 111 integrações da porta de autenticação/papéis passaram. Build de produção passou.
- Operação: 261 unitários e a lista completa de integrações (167 testes) passaram; typecheck/build passaram.
- Smoke entre as duas codebases no emulador: criar duas vezes agenda uma vez, envio simulado uma vez, aceite rejeitado sem e-mail confirmado e permitido após confirmação, preservando o cliente.
- Revisão independente: corrigida atualização da lista de pessoas após aceite observado pelo polling, com regressão; nenhuma pendência acionável restante.
- Nenhum convite real, conta real, alteração de segredo/IAM, merge ou deploy. O envio depende da publicação de WMS + Operação + app; reutiliza o segredo e a rotina já configurados. Os convites antigos não são enviados retroativamente: usar a ação de reenvio.

Os primeiros checks detectaram dependências locais ausentes e um teste estático preso ao nome antigo de variável; as dependências foram restauradas e o teste manteve a verificação de autorização antes da escrita. As execuções finais acima passaram.
