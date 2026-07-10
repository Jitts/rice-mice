import { createClient } from "@/lib/supabase/server";
import { ItemsManager } from "@/components/ItemsManager";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("items")
    .select("*")
    .order("sort_order")
    .order("created_at");

  return <ItemsManager initialItems={items ?? []} />;
}
