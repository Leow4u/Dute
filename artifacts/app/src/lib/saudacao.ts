/** Saudação pela hora do dia, como no Início e na tela de entrada. */
export function greeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

// "terça-feira, 29 de setembro" → só a primeira letra em maiúscula.
export function formatToday(date: Date) {
  const text = date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
