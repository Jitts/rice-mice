import { createClient } from "@/lib/supabase/server";
import { buildGlossary, GLOSSARY_GROUPS } from "@/lib/glossary";
import { withRuleDefaults } from "@/lib/marketing";
import { withLoyaltyDefaults } from "@/lib/loyalty";

// Was static; now renders from the live marketing rules and loyalty config so
// the quoted numbers always match what the engines compute with.
export const dynamic = "force-dynamic";

export default async function GlossaryPage() {
  const supabase = await createClient();
  const { data: businessRow } = await supabase
    .from("businesses")
    .select("*")
    .maybeSingle();
  const glossary = buildGlossary(
    withRuleDefaults(businessRow),
    withLoyaltyDefaults(businessRow),
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Glossary</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What every metric and term in rice-mice means, and exactly how it&apos;s
          computed. These definitions come from the same code that calculates the
          numbers — including your own marketing rules — so they&apos;re always
          current.
        </p>
      </div>

      {GLOSSARY_GROUPS.map((group) => (
        <section key={group}>
          <h2 className="text-lg font-semibold mb-3">{group}</h2>
          <div className="space-y-3">
            {glossary.filter((e) => e.group === group).map((e) => (
              <div
                key={e.id}
                id={e.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <h3 className="text-sm font-semibold">{e.term}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{e.short}</p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {e.how}
                </p>
                {e.where && (
                  <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                    Shown in: {e.where}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
