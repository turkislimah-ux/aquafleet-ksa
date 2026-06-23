"use client";

// Generic lookup dropdown with an inline "+ Add custom …" row — the generalized
// form of StaffTab's RoleSelect. Fed by lookup items ({key,label}); choosing the
// add row reveals an inline input that calls `onAdd(label)`, then selects the
// returned key. A hidden input carries the chosen key into the surrounding form.
//
// Used by LeaveSection for the leave-type picker (and shareable with roles).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function LookupSelect({
  name,
  items,
  defaultKey,
  onAdd,
  addLabel = "+ Add custom…",
  newPlaceholder = "New name",
}: {
  name: string;
  items: { key: string; label: string }[];
  defaultKey: string;
  onAdd: (label: string) => Promise<{ error: string | null; key?: string }>;
  addLabel?: string;
  newPlaceholder?: string;
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<{ key: string; label: string }[]>([]);
  const [value, setValue] = useState(defaultKey);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Merge fetched items + locally-added + the current value (covers a value the
  // fetch omitted, e.g. an inactive key on edit). Dedup by key.
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) map.set(it.key, it.label);
    for (const e of extra) if (!map.has(e.key)) map.set(e.key, e.label);
    if (value && !map.has(value)) map.set(value, value);
    return Array.from(map, ([key, lbl]) => ({ key, label: lbl }));
  }, [items, extra, value]);

  async function add() {
    const clean = label.trim();
    if (!clean) {
      setErr("Name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await onAdd(clean);
    setBusy(false);
    if (res.error || !res.key) {
      setErr(res.error ?? "Could not add.");
      return;
    }
    setExtra((x) => [...x, { key: res.key!, label: clean }]);
    setValue(res.key);
    setLabel("");
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {!adding ? (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === "__add__") {
              setAdding(true);
              setErr(null);
            } else {
              setValue(e.target.value);
            }
          }}
          className={INPUT}
          style={INPUT_STYLE}
        >
          {options.length === 0 && <option value="">—</option>}
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
          <option value="__add__">{addLabel}</option>
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={newPlaceholder}
            className={INPUT}
            style={INPUT_STYLE}
            autoFocus
          />
          <Btn type="button" variant="primary" onClick={add}>{busy ? "…" : "Add"}</Btn>
          <Btn type="button" variant="outline" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Btn>
        </div>
      )}
      {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
