"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BusinessSettings } from "@/lib/business";
import type { StaffProfile } from "@/components/StaffContext";

const MIN_PASSWORD_LENGTH = 8;

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
  initialBusiness,
}: {
  ownEmail: string | null;
  profile: StaffProfile | null;
  initialBusiness: BusinessSettings;
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

  const saveLabel = (s: string) =>
    s === "saving" ? "Saving…" : s === "saved" ? "Saved ✓" : "Save";

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
        blurb={`Signed in as ${ownEmail ?? "unknown"}. Your display name is stamped on orders you take and messages you send.`}
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
      </Section>

      <Section
        title="Team & accounts"
        blurb="Who can sign in, and what they're called."
      >
        <Link
          href="/dashboard/team"
          className="inline-block text-sm border border-neutral-300 rounded-lg px-4 py-2 text-neutral-600 hover:border-neutral-500"
        >
          Manage team →
        </Link>
        <p className="text-xs text-neutral-400">
          Coming next here: create staff accounts and reset passwords without
          Supabase, owner-defined roles &amp; permissions, channel providers
          (WhatsApp / EDM / SMS), and editable marketing rules.
        </p>
      </Section>
    </div>
  );
}
