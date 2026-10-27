/** CORS permite o frontend do próprio ambiente; autenticação continua obrigatória. */
export function apiBrowserOrigins(project: string): string[] {
  if (project === "dute-prod") return ["https://app.dutelog.com.br"];
  if (project === "dute-homolog") return [
    "https://dute-app-368642218894.southamerica-east1.run.app",
    "https://dute-app-u2iwz5xjyq-rj.a.run.app",
  ];
  if (project.startsWith("demo-")) return ["http://localhost:5173", "http://127.0.0.1:5173"];
  return [];
}
