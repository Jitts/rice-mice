import { formatCents } from "@/lib/format";
import { JOURNEY_LABELS, stageOf, type CustomerProfile } from "@/lib/segments";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";

function csvCell(value: string): string {
  // Quote if the value contains a comma, quote, or newline; double embedded quotes.
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function profilesToCsv(
  profiles: CustomerProfile[],
  rules: MarketingRules = DEFAULT_RULES,
): string {
  const header = [
    "first_name",
    "last_name",
    "phone",
    "email",
    "whatsapp_opt_in",
    "email_opt_in",
    "total_spent",
    "order_count",
    "last_visit",
    "tags",
    "stage",
  ];
  const rows = profiles.map((p) =>
    [
      p.firstName,
      p.lastName,
      p.phone ?? "",
      p.email ?? "",
      p.whatsappOptIn ? "yes" : "no",
      p.emailOptIn ? "yes" : "no",
      formatCents(p.totalSpentCents),
      String(p.orderCount),
      p.lastVisit ? new Date(p.lastVisit).toISOString().slice(0, 10) : "",
      p.tags.join(" | "),
      JOURNEY_LABELS[stageOf(p, rules)],
    ]
      .map((c) => csvCell(c))
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

// Client-only: trigger a browser download of text as a file, no network hop.
export function downloadText(filename: string, text: string, mime = "text/csv") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
