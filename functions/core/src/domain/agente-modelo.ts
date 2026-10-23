import { vertexAI } from "@genkit-ai/google-genai";
import { genkit, tool, type Genkit } from "genkit";

import { FONTE_SEM_MODELO, promptDoResumo, type GerarResposta, type Resumir } from "./agente-conversa.js";

/**
 * O modelo do Agent Dute do núcleo (parte 5.5e): o Gemini pelo Genkit, no
 * Vertex AI, com os modelos do agente do WMS. O primeiro que falha passa ao
 * reserva; a tela descarta o que já tinha recebido. Sem os dois, a resposta
 * de reserva diz para tentar de novo. Modelo aposentado no código reprova em
 * gemini-models.test.ts.
 */

export const MODELO_DO_AGENTE = process.env.AGENT_DUTE_MODEL ?? "gemini-3.5-flash";
export const MODELO_RESERVA = "gemini-3.8-flash";

export const TEXTO_SEM_MODELO =
  "Não consegui consultar os dados agora. Tente de novo em alguns instantes. Se precisar com urgência, as telas do módulo mostram as mesmas informações.";

/** O Genkit do agente, criado na primeira conversa: a rotina da memória não paga essa partida. */
export function genkitDoAgente(projectId: string): () => Genkit {
  let ai: Genkit | null = null;
  return () => (ai ??= genkit({ plugins: [vertexAI({ projectId, location: "global" })] }));
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
