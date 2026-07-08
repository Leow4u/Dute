import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, desc, ne, and } from "drizzle-orm";
import {
  db,
  billingPriceListTable,
  billingConfigTable,
  billingPeriodsTable,
  billingManualTable,
} from "@workspace/db";
import { getUserRole, invalidateRole } from "../lib/roles";
import {
  computePeriod,
  getConfig,
  getPeriodByCompetencia,
  freezeInvoiceItems,
  isValidCompetencia,
  AUTO_SOURCES,
  GRUPOS,
} from "../lib/billing";
import { generateInvoicePdf } from "../lib/pdf";
import { sendInvoiceEmail, invoiceEmailHtml } from "../lib/email";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

const requireInterno = async (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  let role;
  try {
    role = await getUserRole(auth.userId);
  } catch (err) {
    // Fail-closed: se não conseguimos determinar o papel, negamos o acesso.
    req.log?.error(err, "falha ao resolver papel do usuário");
    return res.status(503).json({ error: "Não foi possível verificar as permissões. Tente novamente." });
  }
  if (role !== "interno") return res.status(403).json({ error: "Forbidden" });
  req.role = role;
  next();
};

function currentCompetencia(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Drizzle retorna numeric como string; serializa para número na resposta.
function serializePrice(p: any) {
  return { ...p, valor_unit: Number(p.valor_unit) };
}
function serializeConfig(c: any) {
  return { ...c, ad_valorem_rate: Number(c.ad_valorem_rate) };
}

// ─────────────── Perfil do usuário atual ───────────────
router.get("/me", requireAuth, async (req: any, res: any) => {
  const auth = getAuth(req);
  const role = await getUserRole(auth!.userId!);
  res.json({ role });
});

// ─────────────── Tabela de Preços (LPU) — interno ───────────────
router.get("/price-list", requireInterno, async (_req: any, res: any) => {
  try {
    const items = await db.select().from(billingPriceListTable).orderBy(billingPriceListTable.ordem);
    res.json({ items: items.map(serializePrice) });
  } catch (err) {
    _req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/price-list", requireInterno, async (req: any, res: any) => {
  try {
    const { grupo, item, unidade, valor_unit, auto_source, ordem, ativo } = req.body;
    if (!grupo || !GRUPOS[grupo]) return res.status(400).json({ error: "grupo inválido" });
    if (!item) return res.status(400).json({ error: "item é obrigatório" });
    if (auto_source && !AUTO_SOURCES.includes(auto_source)) return res.status(400).json({ error: "auto_source inválido" });
    const [created] = await db
      .insert(billingPriceListTable)
      .values({
        grupo,
        item,
        unidade: unidade || null,
        valor_unit: valor_unit != null ? String(valor_unit) : "0",
        auto_source: auto_source || null,
        ordem: ordem != null ? Number(ordem) : 0,
        ativo: ativo != null ? Boolean(ativo) : true,
      })
      .returning();
    res.status(201).json(serializePrice(created));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/price-list/:id", requireInterno, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const { grupo, item, unidade, valor_unit, auto_source, ordem, ativo } = req.body;
    const updates: any = {};
    if (grupo !== undefined) {
      if (!GRUPOS[grupo]) return res.status(400).json({ error: "grupo inválido" });
      updates.grupo = grupo;
    }
    if (item !== undefined) updates.item = item;
    if (unidade !== undefined) updates.unidade = unidade || null;
    if (valor_unit !== undefined) updates.valor_unit = valor_unit != null ? String(valor_unit) : "0";
    if (auto_source !== undefined) {
      if (auto_source && !AUTO_SOURCES.includes(auto_source)) return res.status(400).json({ error: "auto_source inválido" });
      updates.auto_source = auto_source || null;
    }
    if (ordem !== undefined) updates.ordem = Number(ordem);
    if (ativo !== undefined) updates.ativo = Boolean(ativo);
    const [updated] = await db.update(billingPriceListTable).set(updates).where(eq(billingPriceListTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(serializePrice(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/price-list/:id", requireInterno, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    await db.delete(billingManualTable).where(eq(billingManualTable.price_list_id, id));
    await db.delete(billingPriceListTable).where(eq(billingPriceListTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────── Configuração — interno ───────────────
router.get("/config", requireInterno, async (_req: any, res: any) => {
  try {
    const cfg = await getConfig();
    res.json(serializeConfig(cfg));
  } catch (err) {
    _req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/config", requireInterno, async (req: any, res: any) => {
  try {
    await getConfig();
    const { ad_valorem_rate, cliente_nome, cliente_email } = req.body;
    const updates: any = {};
    if (ad_valorem_rate !== undefined) updates.ad_valorem_rate = String(ad_valorem_rate);
    if (cliente_nome !== undefined) updates.cliente_nome = cliente_nome;
    if (cliente_email !== undefined) updates.cliente_email = cliente_email || null;
    const [updated] = await db.update(billingConfigTable).set(updates).where(eq(billingConfigTable.id, 1)).returning();
    res.json(serializeConfig(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────── Competências — interno ───────────────
router.get("/periods", requireInterno, async (_req: any, res: any) => {
  try {
    const periods = await db.select().from(billingPeriodsTable).orderBy(desc(billingPeriodsTable.competencia));
    const items = await Promise.all(
      periods.map(async (p) => {
        const r = await computePeriod(p.competencia);
        return {
          competencia: p.competencia,
          status: p.status,
          total: r.total,
          emitido_em: r.emitido_em,
          email_enviado_em: r.email_enviado_em,
          pago_em: r.pago_em,
        };
      }),
    );
    res.json({ items });
  } catch (err) {
    _req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/periods/:competencia", requireInterno, async (req: any, res: any) => {
  try {
    const competencia = req.params.competencia;
    if (!isValidCompetencia(competencia)) return res.status(400).json({ error: "competência inválida (use YYYY-MM)" });
    const result = await computePeriod(competencia);
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Salva quantidades manuais da competência (upsert). Cria o período se necessário.
router.put("/periods/:competencia/manual", requireInterno, async (req: any, res: any) => {
  try {
    const competencia = req.params.competencia;
    if (!isValidCompetencia(competencia)) return res.status(400).json({ error: "competência inválida (use YYYY-MM)" });
    const items: Array<{ price_list_id: number; qtde: number; observacao?: string | null }> = req.body?.items ?? [];

    let period = await getPeriodByCompetencia(competencia);
    if (period && period.status !== "aberto") return res.status(409).json({ error: "Competência já emitida; não é editável." });
    if (!period) [period] = await db.insert(billingPeriodsTable).values({ competencia }).returning();

    for (const it of items) {
      if (it.price_list_id == null) continue;
      await db
        .insert(billingManualTable)
        .values({
          period_id: period.id,
          price_list_id: Number(it.price_list_id),
          qtde: String(it.qtde ?? 0),
          observacao: it.observacao ?? null,
        })
        .onConflictDoUpdate({
          target: [billingManualTable.period_id, billingManualTable.price_list_id],
          set: { qtde: String(it.qtde ?? 0), observacao: it.observacao ?? null },
        });
    }

    const result = await computePeriod(competencia);
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Emite a fatura: congela valores, marca emitido, gera PDF e envia por e-mail.
router.post("/periods/:competencia/emit", requireInterno, async (req: any, res: any) => {
  try {
    const competencia = req.params.competencia;
    if (!isValidCompetencia(competencia)) return res.status(400).json({ error: "competência inválida (use YYYY-MM)" });

    let period = await getPeriodByCompetencia(competencia);
    if (period && period.status !== "aberto") return res.status(409).json({ error: "Competência já emitida." });
    if (!period) [period] = await db.insert(billingPeriodsTable).values({ competencia }).returning();

    const live = await computePeriod(competencia); // status aberto (ao vivo)
    const auth = getAuth(req);

    // Congela os itens e faz a transição de status de forma atômica. O UPDATE é
    // condicionado a status='aberto' para que emissões concorrentes não
    // dupliquem o processo — apenas uma requisição consegue "reivindicar" a
    // emissão; as demais recebem 409.
    let claimed = true;
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(billingPeriodsTable)
        .set({
          status: "emitido",
          ad_valorem_rate: String(live.ad_valorem_rate),
          custo_estoque: String(live.custo_estoque),
          total: String(live.total),
          emitido_em: new Date(),
          emitido_por: auth?.userId || null,
        })
        .where(and(eq(billingPeriodsTable.id, period!.id), eq(billingPeriodsTable.status, "aberto")))
        .returning({ id: billingPeriodsTable.id });
      if (rows.length === 0) {
        claimed = false;
        return;
      }
      await freezeInvoiceItems(period!.id, live, tx);
    });
    if (!claimed) return res.status(409).json({ error: "Competência já emitida." });

    const cfg = await getConfig();
    const frozen = await computePeriod(competencia);
    const pdf = await generateInvoicePdf({ result: frozen, config: cfg, competencia });

    let email: { sent: boolean; error?: string };
    if (cfg.cliente_email) {
      email = await sendInvoiceEmail({
        to: cfg.cliente_email,
        subject: `Fatura de Armazenagem — ${competencia}`,
        html: invoiceEmailHtml(cfg, frozen, competencia),
        attachments: [{ filename: `fatura-${competencia}.pdf`, content: Buffer.from(pdf).toString("base64") }],
      });
      if (email.sent) {
        await db.update(billingPeriodsTable).set({ email_enviado_em: new Date() }).where(eq(billingPeriodsTable.id, period.id));
      }
    } else {
      email = { sent: false, error: "E-mail do cliente não configurado nas Configurações." };
    }

    const result = await computePeriod(competencia);
    res.json({ period: result, email });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/periods/:competencia/pay", requireInterno, async (req: any, res: any) => {
  try {
    const competencia = req.params.competencia;
    const period = await getPeriodByCompetencia(competencia);
    if (!period) return res.status(404).json({ error: "Competência não encontrada" });
    if (period.status === "aberto") return res.status(409).json({ error: "Emita a fatura antes de marcar como paga." });
    await db.update(billingPeriodsTable).set({ status: "pago", pago_em: new Date() }).where(eq(billingPeriodsTable.id, period.id));
    res.json(await computePeriod(competencia));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PDF (prévia para competências abertas; fatura congelada para emitidas) — interno.
router.get("/periods/:competencia/pdf", requireInterno, async (req: any, res: any) => {
  try {
    const competencia = req.params.competencia;
    if (!isValidCompetencia(competencia)) return res.status(400).json({ error: "competência inválida (use YYYY-MM)" });
    const cfg = await getConfig();
    const result = await computePeriod(competencia);
    const pdf = await generateInvoicePdf({ result, config: cfg, competencia });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="fatura-${competencia}.pdf"`);
    res.end(Buffer.from(pdf));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────── Portal do cliente — qualquer usuário autenticado ───────────────
router.get("/me/current", requireAuth, async (_req: any, res: any) => {
  try {
    const competencia = currentCompetencia();
    const result = await computePeriod(competencia);
    res.json(result);
  } catch (err) {
    _req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me/invoices", requireAuth, async (_req: any, res: any) => {
  try {
    const periods = await db
      .select()
      .from(billingPeriodsTable)
      .where(ne(billingPeriodsTable.status, "aberto"))
      .orderBy(desc(billingPeriodsTable.competencia));
    const items = periods.map((p) => ({
      competencia: p.competencia,
      status: p.status,
      total: p.total != null ? Number(p.total) : 0,
      emitido_em: p.emitido_em ? p.emitido_em.toISOString() : null,
      pago_em: p.pago_em ? p.pago_em.toISOString() : null,
    }));
    res.json({ items });
  } catch (err) {
    _req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me/invoices/:competencia/pdf", requireAuth, async (req: any, res: any) => {
  try {
    const competencia = req.params.competencia;
    if (!isValidCompetencia(competencia)) return res.status(400).json({ error: "competência inválida" });
    const period = await getPeriodByCompetencia(competencia);
    if (!period || period.status === "aberto") return res.status(404).json({ error: "Fatura não emitida" });
    const cfg = await getConfig();
    const result = await computePeriod(competencia);
    const pdf = await generateInvoicePdf({ result, config: cfg, competencia });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="fatura-${competencia}.pdf"`);
    res.end(Buffer.from(pdf));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────── Gestão de usuários / papéis — interno ───────────────
router.get("/users", requireInterno, async (_req: any, res: any) => {
  try {
    const list = await clerkClient.users.getUserList({ limit: 100 });
    const items = list.data.map((u: any) => ({
      id: u.id,
      nome: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "—",
      email: u.emailAddresses?.[0]?.emailAddress || null,
      role: (u.publicMetadata as any)?.role === "cliente" ? "cliente" : "interno",
    }));
    res.json({ items });
  } catch (err) {
    _req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:id/role", requireInterno, async (req: any, res: any) => {
  try {
    const id = req.params.id;
    const role = req.body?.role;
    if (role !== "interno" && role !== "cliente") return res.status(400).json({ error: "role inválido" });
    await clerkClient.users.updateUserMetadata(id, { publicMetadata: { role } });
    invalidateRole(id);
    res.json({ id, role });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
