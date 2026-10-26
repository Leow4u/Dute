import { vertexAI } from "@genkit-ai/google-genai";
import { genkit, tool, type Genkit } from "genkit";

import { FONTE_SEM_MODELO, promptDoResumo, type GerarResposta, type Resumir } from "./agente-conversa.js";
import { InvoiceExtractionSchema, type LerNota } from "./agente-nota.js";
import { INVOICE_PROMPT } from "./invoice-reading.js";

/**
 * O modelo do Agent Dute do núcleo (parte 5.5e): o Gemini pelo Genkit, no
 * Vertex AI, com os modelos do agente do WMS. O primeiro que falha passa ao
 * reserva; a tela descarta o que já tinha recebido. Sem os dois, a resposta
 * de reserva diz para tentar de novo. Modelo aposentado no código reprova em
 * gemini-models.test.ts.
 */

export const MODELO_DO_AGENTE = process.env.AGENT_DUTE_MODEL ?? "gemini-3.5-flash";
export const MODELO_RESERVA = "gemini-3.8-flash";

/**
 * Onde o Vertex AI processa as conversas, os resumos e a leitura da nota
 * (LGPD, decisão 12 do Leonardo, 26/10/2026): a multirregião `us`, onde os
 * dois modelos existem e o processamento fica nos Estados Unidos. O Brasil
 * não tem nenhum dos dois; o `global` não diz onde processa. É o mesmo local
 * do WMS (`VERTEX_LOCATION`), travado em agente-modelo.test.ts.
 */
export const LOCAL_DO_VERTEX = "us";

export const TEXTO_SEM_MODELO =
  "Não consegui consultar os dados agora. Tente de novo em alguns instantes. Se precisar com urgência, as telas do módulo mostram as mesmas informações.";

/** O Genkit do agente, criado na primeira conversa: a rotina da memória não paga essa partida. */
export function genkitDoAgente(projectId: string): () => Genkit {
  let ai: Genkit | null = null;
  return () => (ai ??= genkit({ plugins: [vertexAI({ projectId, location: LOCAL_DO_VERTEX })] }));
}

export function gerarComGenkit(ai: () => Genkit): GerarResposta {
  return async (pedido) => {
    const ferramentas = pedido.ferramentas.map((ferramenta) =>
      // A entrada é o esquema zod da ferramenta; o executar confere de novo e anota a chamada.
      tool({ name: ferramenta.nome, description: ferramenta.descricao, inputSchema: ferramenta.entrada as never }, async (entrada: unknown) => ferramenta.executar(entrada)),
    );
    const erros: string[] = [];
    for (const modelo of [MODELO_DO_AGENTE, MODELO_RESERVA]) {
      const inicio = Date.now();
      if (erros.length) pedido.aoPedaco?.({ type: "reset" });
      try {
        const resposta = await ai().generate({
          onChunk: (pedaco) => {
            if (!pedido.aoPedaco) return;
            for (const chamada of pedaco.toolRequests) pedido.aoPedaco({ type: "tool", name: chamada.toolRequest.name });
            if (pedaco.role === "model" && pedaco.text) pedido.aoPedaco({ type: "text", index: pedaco.index, text: pedaco.text });
          },
          model: vertexAI.model(modelo),
          system: pedido.sistema,
          messages: pedido.historico.map((mensagem) => ({ role: mensagem.papel, content: [{ text: mensagem.texto }] })),
          prompt: pedido.mensagem,
          tools: ferramentas,
          maxTurns: 8,
          // O Gemini 3.x conta o raciocínio no limite: 2048 cortava respostas.
          config: { temperature: 0.2, maxOutputTokens: 8192 },
        });
        let texto = resposta.text.trim();
        if (!texto) throw new Error("Resposta vazia do modelo.");
        if (resposta.finishReason === "length") texto += "\n\n(A resposta ficou longa e foi cortada. Peça um recorte menor, por exemplo um item ou um mês.)";
        return {
          texto,
          fonte: `genkit_${modelo}`,
          modelo,
          tokens_entrada: resposta.usage?.inputTokens,
          tokens_saida: resposta.usage?.outputTokens,
          latencia_ms: Date.now() - inicio,
          erro: erros.length ? erros.join(" | ") : undefined,
        };
      } catch (erro) {
        erros.push(`${modelo}: ${erro instanceof Error ? erro.message : String(erro)}`.slice(0, 500));
      }
    }
    return { texto: TEXTO_SEM_MODELO, fonte: FONTE_SEM_MODELO, erro: erros.join(" | ") };
  };
}

/** O resumidor da conversa longa: o reserva primeiro, que é o mais barato. */
export function resumirComGenkit(ai: () => Genkit): Resumir {
  return async (anterior, mensagens) => {
    for (const modelo of [MODELO_RESERVA, MODELO_DO_AGENTE]) {
      try {
        const resposta = await ai().generate({ model: vertexAI.model(modelo), prompt: promptDoResumo(anterior, mensagens), config: { temperature: 0.1, maxOutputTokens: 2048 } });
        const texto = resposta.text.trim();
        if (texto) return texto;
      } catch {
        // tenta o próximo modelo
      }
    }
    return "";
  };
}

/** A leitura da nota anexada (parte 5.5h): o pedido e o esquema do WMS, com os mesmos modelos. Sem os dois, falha. */
export function extrairNotaComGenkit(ai: () => Genkit): LerNota["extrair"] {
  return async ({ bytes, contentType }) => {
    const erros: string[] = [];
    for (const modelo of [MODELO_DO_AGENTE, MODELO_RESERVA]) {
      const inicio = Date.now();
      try {
        const resposta = await ai().generate({
          model: vertexAI.model(modelo),
          messages: [{ role: "user", content: [{ text: INVOICE_PROMPT }, { media: { url: `data:${contentType};base64,${bytes.toString("base64")}`, contentType } }] }],
          output: { schema: InvoiceExtractionSchema },
          config: { temperature: 0, maxOutputTokens: 8192 },
        });
        return {
          saida: resposta.output,
          modelo,
          tokens_entrada: resposta.usage?.inputTokens,
          tokens_saida: resposta.usage?.outputTokens,
          latencia_ms: Date.now() - inicio,
          erro: erros.length ? erros.join(" | ") : undefined,
        };
      } catch (erro) {
        erros.push(`${modelo}: ${erro instanceof Error ? erro.message : String(erro)}`.slice(0, 500));
      }
    }
    throw new Error(erros.join(" | "));
  };
}
