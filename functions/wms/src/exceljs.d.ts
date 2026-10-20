declare module "exceljs";

declare function fetch(
  input: string | URL,
  init?: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;
