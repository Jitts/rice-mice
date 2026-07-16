import { createClient } from "@/lib/supabase/server";
import { ReportsManager } from "@/components/ReportsManager";
import { loadFindings } from "@/lib/loadFindings";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";
import { buildCopilotEval, type CopilotLog } from "@/lib/copilotEval";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: businessRow } = await supabase.from("businesses").select("*").maybeSingle();
  const { findings, orders: orderRows, logs, rules } = await loadFindings(supabase, businessRow);

  // Can this caller apply the assistant's proposed tag changes? Same gate as
  // the manual tag editor — the `customers` permission. Self lookup (RLS shows
  // the whole roster, so filter to this user).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membershipRow } = user
    ? await supabase
        .from("memberships")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const perms = (membershipRow as { roles: { permissions: string[] } | null } | null)
    ?.roles?.permissions;
  const canApplyTags = can(perms, "customers");

  const copilotEval = buildCopilotEval({
    logs: logs as CopilotLog[],
    orders: orderRows,
    windowDays: rules.attribution_window_days,
  });

  return (
    <ReportsManager
      initialOrders={orderRows}
      findings={findings}
      copilotEval={copilotEval}
      analystReady={analystKeyPresent()}
      analystKeyName={analystKeyEnvName()}
      canApplyTags={canApplyTags}
    />
  );
}
