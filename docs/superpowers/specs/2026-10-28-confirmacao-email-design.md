# Confirmação de e-mail com a identidade Dutelog

Pedido: substituir a aparência genérica do e-mail de confirmação do Firebase
pelo mesmo padrão do convite: logotipo oficial, cores do brandbook e ação clara.

O link continua sendo gerado e validado pelo Firebase Auth. A callable
`sendInviteEmailVerification`, na codebase `operacao`, envia imediatamente pelo
Resend o HTML e a alternativa em texto. Reutiliza o remetente existente
`Dutelog <avisos@dutelog.com.br>` e o Secret Manager; não depende da fila de cinco
minutos dos avisos. Assunto: “Confirme seu e-mail · Dutelog”.

A pessoa ainda não tem perfil. Essa é a única callable da codebase que dispensa
`requireOperacaoCaller`: exige ambiente liberado, sessão, conta atual ativa no
Auth e convite pendente correspondente. Destinatário e retorno ao app são
escolhidos no servidor. Reconvite exige os vínculos atuais do perfil desativado;
cliente precisa continuar disponível. O aceite existente segue exigindo
`email_verified` e mantém todas as permissões anteriores.

O envio reserva em transação os metadados `email_verification_*` no convite:
intervalo de um minuto e até cinco tentativas por hora, contando falhas. Não
grava links, códigos de confirmação, HTML ou erros do provedor no Firestore.
Somente o resultado da requisição atual atualiza o status. Erros inesperados
também são sanitizados na entrada da callable. Na homologação só são enviados
e-mails para `@dutelog.com.br`; sem chave ou envio efetivo, a tela recebe erro.

A tela chama apenas `{token}` e não usa mais `sendEmailVerification`. Se falhar
depois de criar a conta, permanece na etapa de confirmação com reenvio
disponível, sem afirmar que enviou e sem recriar a conta. Após confirmar, renova
o ID token e usa o mesmo `acceptInvite` de antes.

Validação: testes de template, fluxo montado da tela e integração no Firestore
cobrem autorização, concorrência, limites e falhas. Um smoke com os emuladores
Auth e Firestore gera o link real, comprova a recusa do aceite antes da
confirmação, resgata o código, renova o token e só então cria o perfil. Nenhum
e-mail real é enviado nos testes. O HTML anterior do convite foi comparado
byte a byte após extrair o esqueleto compartilhado e permanece idêntico.

Publicação segue o fluxo normal: functions antes do frontend, homologação e
depois produção. Conferir `sendInviteEmailVerification` no verificador de IAM.
Não é preciso editar o template padrão ou alterar o domínio do Firebase Auth.

Referência: [links de ação pelo Firebase Admin](https://firebase.google.com/docs/auth/admin/email-action-links).
