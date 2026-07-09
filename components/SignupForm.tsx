"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Status = "idle" | "loading" | "success" | "error";

export function SignupForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(true);
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
      first_name: firstName,
      last_name: lastName,
      phone,
      email: email || null,
      whatsapp_opt_in: optIn,
    });

    if (customerError) {
      setStatus("error");
      return;
    }

    const { error: eventError } = await supabase.from("signup_events").insert({
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
      window.open(buildWhatsAppLink(firstName), "_blank");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center space-y-2 max-w-sm">
        <p className="text-2xl font-semibold">You&apos;re in! Check WhatsApp.</p>
        <p className="text-neutral-500 text-sm">
          Thanks for signing up, {firstName}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <div className="grid grid-cols-2 gap-3">
        <input
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          className="border rounded px-3 py-2"
        />
        <input
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          className="border rounded px-3 py-2"
        />
      </div>
      <div>
        <input
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (phoneError) setPhoneError(null);
          }}
          placeholder="Phone (+27...)"
          className="border rounded px-3 py-2 w-full"
        />
        {phoneError && (
          <p className="text-red-600 text-sm mt-1">{phoneError}</p>
        )}
      </div>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (optional)"
        className="border rounded px-3 py-2 w-full"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
        />
        Send me updates on WhatsApp
      </label>
      {status === "error" && (
        <p className="text-red-600 text-sm">
          Something went wrong — please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
      >
        {status === "loading" ? "Signing you up…" : "Sign up"}
      </button>
    </form>
  );
}
