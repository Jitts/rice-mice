"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brandLine, type BusinessSettings } from "@/lib/business";
import { can, type RoleRow } from "@/lib/permissions";
import {
  RULE_FIELDS,
  validateRules,
  type MarketingRules,
} from "@/lib/marketing";
import type { ProviderView } from "@/lib/providers";
import { ProvidersManager } from "@/components/ProvidersManager";
import { ReceiptSlip, type ReceiptOrder } from "@/components/Receipt";
import { RolesManager } from "@/components/RolesManager";
import type { StaffProfile } from "@/components/StaffContext";

const MIN_PASSWORD_LENGTH = 8;

// Sample order for the receipt preview — includes a discount line so the
// offer presentation is visible too. Never touches the database.
const SAMPLE_ORDER: ReceiptOrder = {
  id: "preview",
  order_no: 42,
  customer_id: null,
  status: "completed",
  payment_method: "card",
  staff_name: "Amy",
  total_cents: 13100,
  discount_cents: 1000,
  campaign_id: null,
  created_at: new Date().toISOString(),
  order_items: [
    {
      id: "p1",
      order_id: "preview",
      item_id: null,
      item_name: "Rice Bowl (Large)",
      unit_price_cents: 8500,
      quantity: 1,
    },
    {
      id: "p2",
      order_id: "preview",
      item_id: null,
      item_name: "Iced Tea",
      unit_price_cents: 2800,
      quantity: 2,
    },
  ],
  customers: null,
  campaigns: { offer_code: "RICE10" },
};

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {blurb && <p className="text-xs text-neutral-500 mt-0.5">{blurb}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  width = "w-72",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-xs text-neutral-500 mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`border border-neutral-300 rounded px-2 py-1.5 text-sm ${width}`}
      />
    </label>
  );
}

export function SettingsManager({
  ownEmail,
  profile,
  permissions,
  roleName,
  initialBusiness,
  initialRules,
  roles,
  memberCounts,
  providers,
}: {
  ownEmail: string | null;
  profile: StaffProfile | null;
  permissions: string[];
  roleName: string | null;
  initialBusiness: BusinessSettings;
  initialRules: MarketingRules;
  roles: RoleRow[];
  memberCounts: Record<string, number>;
  providers: ProviderView[] | null; // null = caller lacks the providers permission
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  // --- my profile ---------------------------------------------------------
  const [name, setName] = useState(profile?.display_name ?? "");
  const [nameState, setNameState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function saveName() {
    const trimmed = name.trim();
    if (!profile || !trimmed || trimmed === profile.display_name) return;
    setNameState("saving");
    const { error } = await supabase
      .from("staff_profiles")
      .update({ display_name: trimmed })
      .eq("id", profile.id);
    setNameState(error ? "error" : "saved");
    if (!error) {
      setTimeout(() => setNameState("idle"), 2000);
      router.refresh(); // sidebar shows the server-provided name
    }
  }

  // --- change password -----------------------------------------------------
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwState, setPwState] = useState<"idle" | "saving" | "saved">("idle");
  const [pwError, setPwError] = useState<string | null>(null);

  async function changePassword() {
    setPwError(null);
    if (pw1.length < MIN_PASSWORD_LENGTH) {
      setPwError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (pw1 !== pw2) {
      setPwError("The two entries don't match.");
      return;
    }
    setPwState("saving");
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    if (error) {
      setPwState("idle");
      setPwError(error.message);
      return;
    }
    setPw1("");
    setPw2("");
    setPwState("saved");
    setTimeout(() => setPwState("idle"), 3000);
  }

  // --- business ------------------------------------------------------------
  const [biz, setBiz] = useState<BusinessSettings>(initialBusiness);
  const [bizState, setBizState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function patchBiz(patch: Partial<BusinessSettings>) {
    setBiz((b) => ({ ...b, ...patch }));
  }

  async function saveBusiness() {
    if (!biz.shop_name.trim()) return;
    setBizState("saving");
    const { error } = await supabase
      .from("business_settings")
      .update({
        shop_name: biz.shop_name.trim(),
        shop_emoji: biz.shop_emoji.trim(),
        tagline: biz.tagline.trim(),
        phone: biz.phone?.trim() || null,
        address: biz.address?.trim() || null,
        receipt_footer: biz.receipt_footer.trim(),
        updated_at: new Date().toISOString(),
        updated_by: profile?.display_name ?? null,
      })
      .eq("id", true);
    setBizState(error ? "error" : "saved");
    if (!error) {
      setTimeout(() => setBizState("idle"), 2000);
      router.refresh(); // shell brand picks up a renamed shop
    }
  }

  // --- marketing rules ------------------------------------------------------
  const [rules, setRules] = useState<MarketingRules>(initialRules);
  const [rulesState, setRulesState] = useState<"idle" | "saving" | "saved">("idle");
  const [rulesError, setRulesError] = useState<string | null>(null);

  async function saveRules() {
    setRulesError(null);
    const invalid = validateRules(rules);
    if (invalid) {
      setRulesError(invalid);
      return;
    }
    setRulesState("saving");
    const { error } = await supabase
      .from("business_settings")
      .update({
        ...rules,
        updated_at: new Date().toISOString(),
        updated_by: profile?.display_name ?? null,
      })
      .eq("id", true);
    if (error) {
      setRulesState("idle");
      setRulesError(error.message);
      return;
    }
    setRulesState("saved");
    setTimeout(() => setRulesState("idle"), 2000);
    router.refresh(); // every engine reads rules from the layout — recompute
  }

  const saveLabel = (s: string) =>
    s === "saving" ? "Saving…" : s === "saved" ? "Saved ✓" : "Save";

  const canBusiness = can(permissions, "settings_business");
  const canRoles = can(permissions, "roles");
  const canTeam = can(permissions, "team");
  const canProviders = can(permissions, "providers");

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Everything about how the platform runs — no Supabase or Vercel needed.
        </p>
      </div>

      <Section
        title="My profile"
        blurb={`Signed in as ${ownEmail ?? "unknown"}${roleName ? ` · role: ${roleName}` : " · no role assigned yet"}. Your display name is stamped on orders you take and messages you send.`}
      >
        <div className="flex items-end gap-2 flex-wrap">
          <Field label="Display name" value={name} onChange={setName} width="w-56" />
          <button
            onClick={saveName}
            disabled={
              nameState === "saving" || !name.trim() || name.trim() === profile?.display_name
            }
            className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
          >
            {saveLabel(nameState)}
          </button>
        </div>
        {nameState === "error" && (
          <p className="text-xs text-red-600">Could not save — try again.</p>
        )}

        <div className="border-t border-neutral-100 pt-3 space-y-2">
          <p className="text-xs text-neutral-500">Change password</p>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="block text-sm">
              <span className="block text-xs text-neutral-500 mb-1">New password</span>
              <input
                type="password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                className="border border-neutral-300 rounded px-2 py-1.5 text-sm w-56"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-neutral-500 mb-1">Repeat it</span>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="border border-neutral-300 rounded px-2 py-1.5 text-sm w-56"
              />
            </label>
            <button
              onClick={changePassword}
              disabled={pwState === "saving" || !pw1 || !pw2}
              className="text-sm border border-neutral-300 rounded px-3 py-1.5 text-neutral-600 hover:border-neutral-500 disabled:opacity-50"
            >
              {pwState === "saving"
                ? "Updating…"
                : pwState === "saved"
                  ? "Password updated ✓"
                  : "Update password"}
            </button>
          </div>
          {pwError && <p className="text-xs text-red-600">{pwError}</p>}
        </div>
      </Section>

      {!canBusiness ? (
        <Section
          title="Business"
          blurb="Shop identity — shown on the public sign-up page, the dashboard, and printed receipts."
        >
          <p className="text-xs text-neutral-400">
            Your role doesn&apos;t include Business settings — ask an owner.
          </p>
        </Section>
      ) : (
      <Section
        title="Business"
        blurb="Shop identity — shown on the public sign-up page, the dashboard, and printed receipts."
      >
        <div className="flex flex-wrap gap-3">
          <Field
            label="Shop name"
            value={biz.shop_name}
            onChange={(v) => patchBiz({ shop_name: v })}
            width="w-56"
          />
          <Field
            label="Emoji / logo mark"
            value={biz.shop_emoji}
            onChange={(v) => patchBiz({ shop_emoji: v })}
            width="w-24"
          />
          <Field
            label="Tagline (on receipts)"
            value={biz.tagline}
            onChange={(v) => patchBiz({ tagline: v })}
            width="w-72"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Field
            label="Phone (optional, printed on receipts)"
            value={biz.phone ?? ""}
            onChange={(v) => patchBiz({ phone: v })}
            width="w-56"
          />
          <Field
            label="Address (optional, printed on receipts)"
            value={biz.address ?? ""}
            onChange={(v) => patchBiz({ address: v })}
            width="w-80"
          />
        </div>
        <Field
          label="Receipt footer"
          value={biz.receipt_footer}
          onChange={(v) => patchBiz({ receipt_footer: v })}
          width="w-80"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={saveBusiness}
            disabled={bizState === "saving" || !biz.shop_name.trim()}
            className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
          >
            {saveLabel(bizState)}
          </button>
          {bizState === "error" && (
            <p className="text-xs text-red-600">Could not save — try again.</p>
          )}
        </div>

        {/* Live preview — renders from the form state, so it updates as you
            type, before saving. The receipt uses the REAL slip component. */}
        <div className="border-t border-neutral-100 pt-3">
          <p className="text-xs text-neutral-500 mb-2">
            Live preview — updates as you type
          </p>
          <div className="grid gap-4 sm:grid-cols-2 items-start">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1.5">
                Public sign-up page
              </p>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-center space-y-3 select-none">
                <div className="space-y-1">
                  <p className="text-xl font-bold tracking-tight">{brandLine(biz)}</p>
                  <p className="text-xs text-neutral-500">
                    Sign up in seconds — we&apos;ll keep you in the loop on WhatsApp.
                  </p>
                </div>
                <div className="mx-auto max-w-[220px] space-y-1.5" aria-hidden>
                  <div className="h-7 rounded border border-neutral-200 bg-white" />
                  <div className="h-7 rounded border border-neutral-200 bg-white" />
                  <div className="h-7 rounded bg-neutral-900 text-white text-xs flex items-center justify-center">
                    Sign up
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1.5">
                Printed receipt (sample order)
              </p>
              <div className="origin-top-left scale-90">
                <ReceiptSlip order={SAMPLE_ORDER} business={biz} />
              </div>
            </div>
          </div>
        </div>
      </Section>
      )}

      {canBusiness && (
        <Section
          title="Marketing rules"
          blurb="The thresholds behind the customer journey stages, the at-risk flags, suggestions and campaign measurement. Change a number and every screen recomputes with it — the glossary quotes your numbers too."
        >
          <div className="flex flex-wrap gap-3">
            {RULE_FIELDS.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="block text-xs text-neutral-500 mb-1">
                  {f.label} ({f.unit})
                </span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={rules[f.key]}
                  onChange={(e) =>
                    setRules((r) => ({ ...r, [f.key]: Number(e.target.value) }))
                  }
                  className="border border-neutral-300 rounded px-2 py-1.5 text-sm w-28"
                />
                <span className="block text-[11px] text-neutral-400 mt-1 max-w-[13rem]">
                  {f.help}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveRules}
              disabled={rulesState === "saving"}
              className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
            >
              {saveLabel(rulesState)}
            </button>
            {rulesError && <p className="text-xs text-red-600">{rulesError}</p>}
          </div>
          <p className="text-xs text-neutral-400">
            Saved segments keep the concrete numbers they were created with —
            changing a rule won&apos;t silently retarget an existing segment.
          </p>
        </Section>
      )}

      {canRoles && (
        <Section
          title="Roles & permissions"
          blurb="Create your own tiers from the permission catalog, then assign them on the Team page. The Owner role is built in and can't be changed; the last Owner can never be demoted."
        >
          <RolesManager roles={roles} memberCounts={memberCounts} />
        </Section>
      )}

      {canTeam && (
        <Section
          title="Team & accounts"
          blurb="Who can sign in, what they're called, and which role they hold."
        >
          <Link
            href="/dashboard/team"
            className="inline-block text-sm border border-neutral-300 rounded-lg px-4 py-2 text-neutral-600 hover:border-neutral-500"
          >
            Manage team →
          </Link>
          <p className="text-xs text-neutral-400">
            Create accounts, change emails, reset passwords and deactivate
            logins there — no Supabase needed.
          </p>
        </Section>
      )}

      {canProviders && providers && (
        <Section
          title="Channel providers"
          blurb="Connect the services that deliver your messages. Everything keeps working without them — sends just stay manual (mail app / wa.me links) until a provider is on."
        >
          <ProvidersManager providers={providers} />
        </Section>
      )}
    </div>
  );
}
