"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";

export type Item = {
  id: string;
  name: string;
  price_cents: number;
  category: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

function NewItemForm({ onAdded }: { onAdded: (item: Item) => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !price) return;

    setStatus("loading");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("items")
      .insert({
        name,
        price_cents: Math.round(parseFloat(price) * 100),
        category: category || null,
      })
      .select()
      .single();

    if (error || !data) {
      setStatus("error");
      return;
    }

    setStatus("idle");
    setName("");
    setPrice("");
    setCategory("");
    onAdded(data as Item);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap gap-2 items-end border rounded p-4 mb-6"
    >
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">Item name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rice Bowl (Large)"
          className="border rounded px-3 py-2.5"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">Price ($)</label>
        <input
          required
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="85.00"
          className="border rounded px-3 py-2.5 w-28"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">Category</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Bowls"
          className="border rounded px-3 py-2.5 w-32"
        />
      </div>
      <button
        type="submit"
        disabled={status === "loading"}
        className="bg-primary text-primary-foreground rounded px-5 py-2.5 disabled:opacity-50"
      >
        {status === "loading" ? "Adding…" : "Add item"}
      </button>
      {status === "error" && (
        <p className="text-destructive text-sm w-full">
          Something went wrong — please try again.
        </p>
      )}
    </form>
  );
}

function ItemRow({
  item,
  onUpdated,
}: {
  item: Item;
  onUpdated: (item: Item) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((item.price_cents / 100).toFixed(2));
  const [category, setCategory] = useState(item.category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save(fields: Partial<Item>) {
    setSaving(true);
    setError(false);
    const supabase = createClient();
    const { data, error: updateError } = await supabase
      .from("items")
      .update(fields)
      .eq("id", item.id)
      .select()
      .single();

    setSaving(false);
    if (updateError || !data) {
      setError(true);
      return false;
    }
    onUpdated(data as Item);
    return true;
  }

  async function handleSave() {
    if (!name || !price) return;
    const ok = await save({
      name,
      price_cents: Math.round(parseFloat(price) * 100),
      category: category || null,
    });
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <tr className="border-b bg-muted">
        <td className="py-2 pr-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded px-2 py-2 w-full"
          />
        </td>
        <td className="py-2 pr-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="border rounded px-2 py-2 w-24"
          />
        </td>
        <td className="py-2 pr-2">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border rounded px-2 py-2 w-28"
          />
        </td>
        <td className="py-2" colSpan={2}>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setName(item.name);
                setPrice((item.price_cents / 100).toFixed(2));
                setCategory(item.category ?? "");
              }}
              className="border rounded px-4 py-2 text-sm"
            >
              Cancel
            </button>
            {error && <span className="text-destructive text-sm">Save failed</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b ${item.is_active ? "" : "opacity-50"}`}>
      <td className="py-3">{item.name}</td>
      <td className="py-3">{formatCents(item.price_cents)}</td>
      <td className="py-3">{item.category ?? "-"}</td>
      <td className="py-3">
        <button
          onClick={() => save({ is_active: !item.is_active })}
          disabled={saving}
          className={`rounded px-3 py-1.5 text-sm border disabled:opacity-50 ${
            item.is_active
              ? "border-green-300 bg-green-50 text-green-700"
              : "border-input bg-muted text-muted-foreground"
          }`}
        >
          {item.is_active ? "Active" : "Inactive"}
        </button>
      </td>
      <td className="py-3">
        <button
          onClick={() => setEditing(true)}
          className="text-sm underline text-muted-foreground"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

export function ItemsManager({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);

  function handleAdded(item: Item) {
    setItems((prev) => [...prev, item]);
  }

  function handleUpdated(item: Item) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Menu items</h1>

      <section>
        <NewItemForm onAdded={handleAdded} />
        {items.length === 0 ? (
          <p className="text-muted-foreground">No items yet. Add your first one above.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Name</th>
                <th className="py-2">Price</th>
                <th className="py-2">Category</th>
                <th className="py-2">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} onUpdated={handleUpdated} />
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground/70 mt-3">
          Inactive items are hidden from the order pad but kept for order history.
        </p>
      </section>
    </div>
  );
}
