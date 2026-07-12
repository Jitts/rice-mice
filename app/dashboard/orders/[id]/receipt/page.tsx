import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Receipt, type ReceiptOrder } from "@/components/Receipt";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "*, order_items(*), customers(first_name, last_name), campaigns(offer_code)",
    )
    .eq("id", id)
    .single();
  if (!order) notFound();

  return <Receipt order={order as ReceiptOrder} />;
}
