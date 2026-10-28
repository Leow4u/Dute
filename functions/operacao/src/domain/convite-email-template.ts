/**
 * HTML de e-mail com tabelas e estilos inline para Outlook, sem fontes externas.
 * Logo oficial: artifacts/app/public/dutelog-logo.png, servido pelo domínio do app.
 * Cores da marca: MIV_Dutelog_v2.pdf, pp. 13–14
 * https://drive.google.com/file/d/1JZ1s_MSFK-isP18Uzm3ud_wD5eac0brg/view
 * Neutros de superfície: docs/mockups/README.md (identidade v3).
 */
function escapar(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function conviteHtml(input: { nome: string; email: string; link: string }): string {
  const nome = escapar(input.nome);
  const email = escapar(input.email);
  const link = escapar(input.link);
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seu convite para o Dute App</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f3;color:#161616;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Seu acesso ao Dute App começa aqui. Aceite o convite para concluir seu cadastro.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f5f3;"><tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e5e5e1;border-radius:12px;">
<tr><td style="padding:28px 32px;border-bottom:1px solid #e5e5e1;"><img src="https://app.dutelog.com.br/dutelog-logo.png" width="200" alt="Dutelog Soluções Logísticas" style="display:block;width:200px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 20px;font-size:16px;line-height:24px;">${nome ? `Olá, ${nome}.` : "Olá."}</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:36px;font-weight:bold;letter-spacing:-0.5px;">Você foi convidado para o Dute App</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:26px;color:#515454;">Aceite o convite para concluir seu cadastro e acessar o sistema da Dutelog.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:16px 20px;background-color:#f5f5f3;border-radius:8px;"><p style="margin:0 0 6px;font-size:12px;line-height:18px;font-weight:bold;color:#515454;">E-MAIL DO SEU ACESSO</p><p style="margin:0;font-size:16px;line-height:24px;overflow-wrap:anywhere;word-break:break-word;">${email}</p></td></tr></table>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;"><tr><td align="center" bgcolor="#e71c23" style="border-radius:6px;mso-padding-alt:15px 28px;"><a href="${link}" style="display:inline-block;padding:15px 28px;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Aceitar convite</a></td></tr></table>
<p style="margin:0 0 28px;font-size:14px;line-height:23px;color:#515454;">Ao abrir o convite, siga as instruções para definir sua senha e confirmar seu e-mail. Se você já tem uma conta, use sua senha atual.</p>
<p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#515454;">O botão não abriu? Copie e cole este link no navegador:</p>
<p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="${link}" style="color:#0054ce;text-decoration:underline;word-break:break-all;">${link}</a></p>
</td></tr>
<tr><td style="padding:24px 32px;border-top:1px solid #e5e5e1;"><p style="margin:0 0 12px;font-size:12px;line-height:20px;color:#515454;">Este convite é pessoal. Não compartilhe o link.<br>Se você não esperava este convite, pode ignorar esta mensagem.</p><p style="margin:0;font-size:12px;line-height:20px;color:#515454;">Dutelog Soluções Logísticas</p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
