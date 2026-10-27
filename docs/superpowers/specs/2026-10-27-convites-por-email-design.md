# Convites de acesso por e-mail

Pedido do usuário: implementar o envio por e-mail do convite já existente no Dute App. O convite continua vinculado ao e-mail, papel e cliente; o aceite ainda exige confirmação do endereço pelo Firebase.

## Abordagem

Reutilizar `email_outbox` e `runNotifications` (Resend), em vez de introduzir outro provedor ou enviar dentro da transação. A criação e o agendamento são atômicos; o envio ocorre na próxima rodada, normalmente em até cinco minutos. Falhas seguem as cinco tentativas existentes. Nenhum envio real integra a validação.

Cada envio tem ID independente do token e chave de idempotência estável. O worker relê o convite antes de enviar, deriva o destinatário dele, usa a origem confiável do ambiente e descarta convites indisponíveis. Tokens ficam somente nas coleções privadas, nunca em eventos ou mensagens de erro. A homologação mantém a restrição a endereços Dutelog. Não se altera a validade dos convites: hoje não há expiração automática.

## Comportamento

Criar agenda o e-mail e mantém o link para compartilhamento. A interface distingue agendado, enviado ao provedor, não enviado por configuração e falha. O administrador pode reenviar um convite ainda pendente, preservando o link e os destinatários; não se agenda outro enquanto houver envio pendente, e reenvios têm intervalo mínimo de um minuto. Revogação e aceite continuam independentes do e-mail.

Implementação e testes locais estão autorizados; produção requer publicação separada. Não criar contas nem enviar convite real, alterar segredos ou IAM.
