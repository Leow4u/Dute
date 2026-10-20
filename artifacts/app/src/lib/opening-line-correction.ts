import type { WarehouseBox } from "@/lib/warehouse-boxes";
import type { OpeningInventoryLine } from "@/features/warehouse-ops/opening-inventory-status";

/** Only existing boxes from this opening can receive a corrected line. */
export function openingLineTargets(
  boxes: WarehouseBox[],
  line: OpeningInventoryLine,
  customerCode: string,
  sessionId: string,
  lines: OpeningInventoryLine[],
) {
  return boxes
    .filter((box) =>
      box.customer_code === customerCode &&
      box.session_id === sessionId &&
      box.status === "stored" &&
      box.code !== line.box_code,
    )
    .map((box) => ({
      box,
      duplicateSku: lines.some((other) =>
        other.id !== line.id &&
        other.box_code === box.code &&
        Boolean(line.sku_code) &&
        other.sku_code === line.sku_code,
      ),
    }));
}
