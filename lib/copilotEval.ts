import { attributeCampaign } from "@/lib/attribution";
import type { Order } from "@/lib/orders";

// Copilot performance, computed the same honest way findings are: entirely from
// stored facts, no model in the loop. A send is tagged message_draft_source
// "ai" when its copy came from the copilot, and message_draft_review_status
// "edited" when the human changed the draft before sending — so we can show
// how often drafts were trusted as-is and what revenue AI-drafted campaigns
// brought in (via the SAME attribution engine campaigns already use).
//
// Read from engagement_logs (member-readable) rather than audit_log (which is
// team-permission-gated), so any Reports user sees it. The fuller "drafts
// generated vs used" acceptance rate lives in audit_log — see BACKLOG.

export type CopilotLog = {
  campaign_id: string | null;
  customer_id: string;
  sent_at: string | null;
  message_draft_source?: string | null;
  message_draft_review_status?: string | null;
};

export type CopilotEval = {
  aiCampaigns: number; // distinct campaigns whose copy came from the copilot
  aiRecipients: number; // people reached with AI-drafted copy
  keptAsIs: number; // AI campaigns sent without edits
  edited: number; // AI campaigns the human edited first
  attributedCents: number; // revenue attributed to AI-drafted campaigns
};

export function buildCopilotEval({
  logs,
  orders,
  windowDays,
}: {
  logs: CopilotLog[];
  orders: Order[];
  windowDays: number;
}): CopilotEval | null {
  const byCampaign = new Map<string, CopilotLog[]>();
  for (const l of logs) {
    if (!l.campaign_id) continue;
    const rows = byCampaign.get(l.campaign_id);
    if (rows) rows.push(l);
    else byCampaign.set(l.campaign_id, [l]);
  }

  let aiCampaigns = 0;
  let aiRecipients = 0;
  let keptAsIs = 0;
  let edited = 0;
  let attributedCents = 0;

  for (const [campaignId, rows] of byCampaign) {
    if (!rows.some((r) => r.message_draft_source === "ai")) continue;
    aiCampaigns += 1;
    aiRecipients += rows.length;
    if (rows.some((r) => r.message_draft_review_status === "edited")) edited += 1;
    else keptAsIs += 1;
    attributedCents += attributeCampaign(rows, orders, windowDays, campaignId).attributedCents;
  }

  if (aiRecipients === 0) return null;
  return { aiCampaigns, aiRecipients, keptAsIs, edited, attributedCents };
}
