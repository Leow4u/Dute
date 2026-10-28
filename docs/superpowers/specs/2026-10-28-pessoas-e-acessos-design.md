# Pessoas e acessos

Aprovado por Leonardo em 28/10/2026: primeira imagem apresentada no chat, com os fluxos de reenvio e remoção das demais.

- Tabela com toda a largura, sem painel fixo de perfis. Ajuda em diálogo sob demanda.
- Abas Pessoas (ativos e convites pendentes) e Arquivados (acesso removido), com contadores, busca por nome/e-mail e filtro de situação.
- Reenviar convite visível na linha, com confirmação do destinatário e feedback de agendamento. Preservar limites, falhas, link e acompanhamento do aceite existentes.
- Revogar acesso de ativos, cancelar convites e remover pessoas da lista são ações distintas.
- Remover da lista só vale para perfis desativados, com confirmação, autorização no servidor e evento. Ocultar o perfil sem apagar identidade, credenciais ou histórico.
- Convidar novamente abre o formulário preenchido, permitindo escolher o perfil. Novo convite para o mesmo e-mail também funciona após remover da lista. O perfil continua bloqueado até o aceite de um convite novo, vinculado pelo servidor ao perfil removido; o aceite preserva o UID e o histórico.
- Manter proteção do próprio usuário e de administradores, confirmação do e-mail, isolamento do cliente e idempotência. Não publicar nem enviar convites reais nesta implementação.

Abordagens consideradas: tabela ampla com ajuda sob demanda (escolhida), abas separadas por situação, lista agrupada recolhível. A tabela ampla mantém pessoas e convites visíveis e exige menos navegação.

Detalhe de implementação: o login desativado do Firebase precisa ser habilitado para aceitar o novo convite, mas o perfil segue com `access_disabled: true`. Somente o aceite verificado restaura o acesso ao sistema. Uma referência privada ao convite mais recente impede aceitar convites antigos.
