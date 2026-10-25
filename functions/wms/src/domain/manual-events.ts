/**
 * Os eventos que as telas da equipe registram à mão, pela
 * recordOperationalEvent (a rota manual de docs/contrato-eventos-ai-native.md).
 * Toda transição grava o próprio evento, no mesmo fluxo da alteração
 * (invariante 2); à mão entra só o que nenhum fluxo grava. Um tipo de
 * transição registrado à mão seria um evento de sistema forjado, e a
 * timeline, a memória do Agent Dute e os rascunhos de aviso ao cliente
 * (syncOperationalNotifications) o leriam como verdadeiro.
 */
export const MANUAL_EVENT_TYPES = [
  // artifacts/app/src/App.tsx: quem acaba de aceitar o convite.
  "access.invite_accepted",
  // artifacts/app/src/pages/agent-knowledge.tsx: o arquivo anexado à base.
  "knowledge.uploaded",
  // artifacts/app/src/pages/ai-control.tsx: a anotação operacional.
  "operator.note",
  // artifacts/app/src/pages/settings-system.tsx: o incidente do sistema.
  "support.incident",
] as const;

export function isManualEventType(type: string): boolean {
  return (MANUAL_EVENT_TYPES as readonly string[]).includes(type);
}
