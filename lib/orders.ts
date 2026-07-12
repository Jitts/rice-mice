export type OrderLine = {
  id: string;
  order_id: string;
  item_id: string | null;
  item_name: string;
  unit_price_cents: number;
  quantity: number;
};

export type Order = {
  id: string;
  order_no: number;
  customer_id: string | null;
  status: OrderStatus;
  payment_method: string | null;
  staff_name: string | null;
  total_cents: number; // final charged amount, after any discount
  discount_cents: number;
  campaign_id: string | null; // set when an offer code was redeemed
  created_at: string;
  order_items: OrderLine[];
};

export type OrderStatus =
  | "open"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export const STATUS_STYLES: Record<OrderStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  preparing: "bg-amber-100 text-amber-700",
  ready: "bg-green-100 text-green-700",
  completed: "bg-neutral-100 text-neutral-600",
  cancelled: "bg-red-100 text-red-700",
};

// The linear kitchen flow. `completed` and `cancelled` are terminal.
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  open: "preparing",
  preparing: "ready",
  ready: "completed",
};

const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  open: "Start preparing",
  preparing: "Mark ready",
  ready: "Complete",
};

export function nextStatus(status: OrderStatus): OrderStatus | null {
  return NEXT_STATUS[status] ?? null;
}

export function advanceLabel(status: OrderStatus): string | null {
  return ADVANCE_LABEL[status] ?? null;
}

export function isActiveStatus(status: OrderStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export function orderSummary(order: Order): string {
  return order.order_items
    .map((l) => (l.quantity > 1 ? `${l.quantity}× ${l.item_name}` : l.item_name))
    .join(", ");
}
