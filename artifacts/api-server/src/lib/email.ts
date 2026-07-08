import type { PeriodResult } from "./billing";
import type { BillingConfig } from "@workspace/db";

export interface EmailAttachment {
  filename: string;
  content: string; // base64
}

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export function invoiceEmailHtml(config: BillingConfig, result: PeriodResult, competencia: string): string {
  const rows = result.grupos
    .filter((g) => g.itens.length)
    .map(
      (g) =>
        `<tr><td style="padding:6px 8px;">${g.label}</td><td style="padding:6px 8px;text-align:right;font-weight:600;">${fmtBRL(
          g.total,
        )}</td></tr>`,
    )
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111;">
    <div style="background:#06284a;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h2 style="margin:0;font-size:18px;">Fatura de Armazenagem e Logística</h2>
      <p style="margin:4px 0 0;color:#b9c7d6;font-size:13px;">Competência: ${competencia}</p>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:0;padding:20px 24px;border-radius:0 0 8px 8px;">
      <p style="font-size:14px;">Prezado(a) <strong>${config.cliente_nome || "Cliente"}</strong>,</p>
      <p style="font-size:14px;">Segue em anexo a fatura referente aos serviços de armazenagem e logística do período. Resumo por grupo:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;">
        ${rows}
        <tr style="background:#06284a;color:#fff;">
          <td style="padding:10px 8px;font-weight:700;">TOTAL GERAL</td>
          <td style="padding:10px 8px;text-align:right;font-weight:700;">${fmtBRL(result.total)}</td>
        </tr>
      </table>
      <p style="font-size:12px;color:#64748b;margin-top:16px;">O detalhamento completo está no PDF em anexo. Em caso de dúvidas, responda a este e-mail.</p>
      <p style="font-size:12px;color:#64748b;">Dutelog — Gestão de Armazenagem</p>
    </div>
  </div>`;
}

// Envia a fatura por e-mail via Resend. Retorna status sem lançar exceção,
// para que a emissão da fatura não seja bloqueada por falha de e-mail.
export async function sendInvoiceEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments: EmailAttachment[];
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM;
  if (!apiKey) return { sent: false, error: "Integração de e-mail (Resend) não configurada." };
  if (!from) return { sent: false, error: "Remetente de e-mail (RESEND_FROM_EMAIL) não configurado." };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content })),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { sent: false, error: `Resend ${res.status}: ${t.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e: any) {
    return { sent: false, error: e?.message || "Falha ao enviar e-mail." };
  }
}
