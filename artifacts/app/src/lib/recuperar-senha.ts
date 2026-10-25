/**
 * "Esqueci minha senha" na tela de entrada. Sem e-mail no campo, o botão
 * dizia nada; o envio que falhava (endereço inválido) ficava sem aviso. A
 * tela pinta de vermelho a mensagem que não fala de "recuperação".
 */

export const MENSAGEM_DA_RECUPERACAO = {
  enviada: "E-mail de recuperação enviado.",
  falhou: "Não foi possível enviar o e-mail para trocar a senha. Confira o endereço.",
} as const;

/** O que falta para pedir a troca de senha, ou null. */
export function problemaDaRecuperacao(email: string): string | null {
  return email.trim() ? null : "Informe o e-mail para trocar a senha.";
}
