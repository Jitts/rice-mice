"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Status = "idle" | "loading" | "success" | "error";

export function SignupForm({
  businessId,
  shopName,
  waPhone,
  dialCode,
}: {
  businessId: string;
  shopName?: string;
  waPhone?: string | null;
  // Sprint 56: this shop's dialing prefix, or null for no hint. Was hard-coded
  // "+27" for every tenant on the platform.
  dialCode?: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(true);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!phone.trim()) {
      setPhoneError("Phone number is required");
      return;
    }
    setPhoneError(null);
    setStatus("loading");

    const supabase = createClient();
    const customerId = crypto.randomUUID();

    const { error: customerError } = await supabase.from("customers").insert({
      id: customerId,
      business_id: businessId,
      first_name: firstName,
      last_name: lastName,
      phone,
      email: email || null,
      whatsapp_opt_in: optIn,
      email_opt_in: email ? emailOptIn : false,
      sms_opt_in: smsOptIn,
    });

    if (customerError) {
      setStatus("error");
      return;
    }

    const { error: eventError } = await supabase.from("signup_events").insert({
      business_id: businessId,
      customer_id: customerId,
      source: "in-store QR",
      whatsapp_link_opened: optIn,
    });

    if (eventError) {
      setStatus("error");
      return;
    }

    setStatus("success");

    if (optIn) {
      window.open(buildWhatsAppLink(firstName, shopName, waPhone), "_blank");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center space-y-2 max-w-sm">
        <p className="text-2xl font-semibold">You&apos;re in! Check WhatsApp.</p>
        <p className="text-muted-foreground text-sm">
          Thanks for signing up, {firstName}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      {/* Sprint 56: every field carries a persistent label tied by htmlFor.
          These were placeholder-only, so the field's name disappeared the
          moment someone typed — worst exactly when correcting a typo, on a
          phone, at a counter (WCAG 3.3.2). */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="signup-first" className="block text-sm font-medium">
            First name
          </label>
          <input
            id="signup-first"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="signup-last" className="block text-sm font-medium">
            Last name
          </label>
          <input
            id="signup-last"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="signup-phone" className="block text-sm font-medium">
          Phone number
        </label>
        <input
          id="signup-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (phoneError) setPhoneError(null);
          }}
          placeholder={dialCode ? `${dialCode} ...` : undefined}
          aria-describedby={phoneError ? "signup-phone-error" : undefined}
          aria-invalid={phoneError ? true : undefined}
          className="border rounded px-3 py-2 w-full"
        />
        {phoneError && (
          <p id="signup-phone-error" role="alert" className="text-destructive text-sm">
            {phoneError}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="signup-email" className="block text-sm font-medium">
          Email <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      </div>
      {/* Sprint 56: the consent rows were the smallest targets on the page —
          13x13px boxes in 20px rows, on the controls that grant marketing
          permission. Now 24px boxes in 44px rows (WCAG 2.5.8). */}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium mb-1">Keep me posted</legend>
        <label className="flex items-center gap-3 text-sm min-h-11 py-1 cursor-pointer">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="size-6 shrink-0 accent-primary"
          />
          Send me updates on WhatsApp
        </label>
        <label className="flex items-center gap-3 text-sm min-h-11 py-1 cursor-pointer">
          <input
            type="checkbox"
            checked={emailOptIn}
            onChange={(e) => setEmailOptIn(e.target.checked)}
            disabled={!email}
            className="size-6 shrink-0 accent-primary"
          />
          <span className={email ? "" : "text-muted-foreground/70"}>
            Email me offers {!email && "(add an email above)"}
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm min-h-11 py-1 cursor-pointer">
          <input
            type="checkbox"
            checked={smsOptIn}
            onChange={(e) => setSmsOptIn(e.target.checked)}
            disabled={!phone.trim()}
            className="size-6 shrink-0 accent-primary"
          />
          <span className={phone.trim() ? "" : "text-muted-foreground/70"}>
            Text me offers (SMS)
          </span>
        </label>
      </fieldset>
      {status === "error" && (
        <p className="text-destructive text-sm">
          Something went wrong — please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full bg-primary text-primary-foreground rounded px-3 py-2 disabled:opacity-50"
      >
        {status === "loading" ? "Signing you up…" : "Sign up"}
      </button>
    </form>
  );
}
