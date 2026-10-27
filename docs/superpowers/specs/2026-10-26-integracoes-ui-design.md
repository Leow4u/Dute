# Integrações na Configuração

Leonardo aprovou a primeira imagem exibida no chat: criação em página, com formulário à esquerda e orientação à direita. Preservar o menu e a identidade do Dute; a marca e as permissões genéricas da imagem são substituídas pelo produto e pelo contrato reais, conforme explicado no chat.

Owner/admin acessa Configuração → Integrações, consulta integrações e abre Nova integração. O formulário pede nome, clientes autorizados, as quatro permissões da API de Operação e validade (30 dias por padrão, máximo de 90). Recursos compartilhados e escritas têm rótulos explícitos. Escritas continuam exigindo aprovação humana por ação.

Depois de criar, a chave aparece uma vez, com copiar e confirmação para concluir. Não guardar em cache, storage, URL, logs ou histórico. Recarregar não recupera a chave. Revogar exige confirmação. Mostrar erros e estado pendente, inclusive se a cópia falhar, sem reenviar a criação automaticamente.

## Abordagens

Foram apresentados formulário em página, painel lateral e formulário na lista. Aprovado formulário em página. Usar componentes React e tokens existentes, sem dependências novas. API atual cria e revoga; acrescentar listagem paginada com projeção explícita de metadados e CORS limitado aos endereços do próprio ambiente.

Não gerar credenciais reais durante testes, não alterar os escopos existentes e não publicar em produção nesta implementação.
