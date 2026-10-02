import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecideNoteSchema } from "./domain/agent-notes.js";

describe("entrada de decideAgentNote", () => {
  it("aceita null nos campos opcionais, como o SDK do Firebase envia", () => {
    assert.deepEqual(DecideNoteSchema.parse({ id: "note_1", action: "approve", text: null, visibility: "todos" }), {
      id: "note_1",
      action: "approve",
      text: undefined,
      visibility: "todos",
    });
    assert.deepEqual(DecideNoteSchema.parse({ id: "note_1", action: "reject", text: null, visibility: null }), {
      id: "note_1",
      action: "reject",
      text: undefined,
      visibility: undefined,
    });
  });

  it("texto editado segue; ação ou visibilidade inválida não passa", () => {
    assert.equal(DecideNoteSchema.parse({ id: "n", action: "approve", text: " Só de manhã, até 11h " }).text, "Só de manhã, até 11h");
    assert.equal(DecideNoteSchema.safeParse({ id: "n", action: "apagar" }).success, false);
    assert.equal(DecideNoteSchema.safeParse({ id: "n", action: "approve", visibility: "todo mundo" }).success, false);
  });
});
