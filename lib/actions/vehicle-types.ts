"use server";

// `vehicle_types` (0201) — the managed bilingual lookup behind an operation
// vehicle's "what kind of thing is this". Add, rename, retire. No delete.
//
// WHY IT LIVES IN lib/actions/ RATHER THAN app/fleet/actions.ts
// -----------------------------------------------------------------------------
// Same reason lib/actions/operation-stations.ts does: the control that calls
// these (components/VehicleTypeField.tsx) is a reusable field, not a page, and a
// field that imports a `app/<route>/actions` module has quietly decided which
// route is allowed to render it. app/fleet/actions.ts stays what its header
// says it is — the VEHICLE write surface.
//
// THE THREE RULES THIS TABLE INHERITS (CLAUDE.md §6, and the table comment 0201
// wrote onto the table itself):
//
//   1. THE KEY IS IMMUTABLE. `key` is slugified from the English name ONCE, at
//      creation, and a rename never touches it. Every vehicle points at the
//      row's `id`, so a rename is invisible to them — which is the point. A
//      "rename" that re-slugged would either orphan the FK or silently change
//      what a saved vehicle means.
//   2. BOTH LABELS LIVE ON THE ROW, never in lib/i18n.ts.
//      scripts/i18n-lookup-single-source-check.mjs fails the test gate if a
//      lookup label is copied into the dictionary, and the dictionary holds
//      only the CHROME around these names (`fleet.vtype.*`).
//   3. RETIRE, DO NOT DELETE. `active = false` hides a type from every picker
//      while vehicles already pointing at it keep resolving. The FK is
//      `on delete restrict`, so a delete would be refused by the database
//      anyway the moment one vehicle used it — and would succeed, destructively,
//      on the day none did.
//
// NEVER HARDCODE A KEY FROM THIS TABLE. The seeds ('pickup', 'diesel_truck',
// 'tractor', 'crane', 'other') are data the operator may rename or retire. No
// code in this file or any caller branches on one, and none may.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slugifyKey, isValidSlug } from "@/lib/slug";

export type ActionResult = { error: string | null };

// The list page and the vehicle form both read the type names. There is no
// concrete detail path to revalidate here — this action knows about a TYPE, not
// about any vehicle wearing it — so the open form's own router.refresh() is what
// re-reads the list in place. Same arrangement as operation-stations.
function revalidateFleet() {
  revalidatePath("/fleet");
}

function validateNames(label: string, labelAr: string): { clean: string; cleanAr: string } | { error: string } {
  const clean = label.trim();
  const cleanAr = labelAr.trim();
  // Both are NOT NULL with a `btrim(x) <> ''` CHECK in 0201, and both are read
  // on screen — the Arabic one on the Arabic screen. Copying the English across
  // to satisfy the column (as commission_types does) would put English text on
  // an Arabic page, which is the thing the second column exists to prevent.
  if (!clean) return { error: "English name is required." };
  if (!cleanAr) return { error: "Arabic name is required." };
  return { clean, cleanAr };
}

/**
 * Add a type. Returns the row's ID.
 *
 * THE ID, NOT THE KEY, AND THE DIFFERENCE IS LOAD-BEARING. The equivalent
 * violation-type action returns a key, and its caller shows a provisional row
 * keyed by the slug until a refresh lands. That trick is safe there because the
 * driver form lifts the selection into a draft. It is NOT safe here: this
 * control's value is posted straight into `trucks.vehicle_type_id`, a uuid FK,
 * so a slug sitting in it for the second before the refresh arrives is a vehicle
 * saved against `22P02 invalid input syntax for type uuid`. The database already
 * knows the id; returning it costs one `.select()` and removes the window.
 *
 * RE-ADDING A RETIRED NAME REVIVES IT rather than colliding on
 * `vehicle_types_key_unique`. An operator who retires "Crane" and later types
 * "Crane" again means the same thing, and a unique-violation error would be a
 * dead end with no way out of it from the UI. The labels are refreshed on the
 * way back, so a revived row carries the words just typed rather than the ones
 * it was retired with.
 */
export async function addVehicleType(
  label: string,
  labelAr: string,
): Promise<{ error: string | null; id?: string }> {
  const names = validateNames(label, labelAr);
  if ("error" in names) return { error: names.error };

  const key = slugifyKey(names.clean);
  if (!key) return { error: "The English name needs letters or numbers." };
  if (!isValidSlug(key)) return { error: "The English name must start with a letter." };

  const supabase = createClient();
  const { data: existing, error: lookupErr } = await supabase
    .from("vehicle_types")
    .select("id, active")
    .eq("key", key)
    .maybeSingle();
  if (lookupErr) return { error: lookupErr.message };

  if (existing) {
    // Already live under this key: nothing to do but hand the caller the id so
    // it can select it. Silently OVERWRITING an active row's labels here would
    // make "add" a disguised rename of a type other vehicles already use.
    if (existing.active) {
      revalidateFleet();
      return { error: null, id: existing.id };
    }
    const { error } = await supabase
      .from("vehicle_types")
      .update({ active: true, label: names.clean, label_ar: names.cleanAr })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    revalidateFleet();
    return { error: null, id: existing.id };
  }

  // NEW ROWS GO TO THE END. 0201 defaults sort_order to 0, which would put every
  // operator-added type ABOVE the five seeded ones — the list would reorder
  // itself the first time anyone added anything. Reading the max and adding one
  // is a read-then-write and two simultaneous adds can tie; a tie is harmless
  // here because the picker breaks it on the label, and the alternative (a
  // sequence, or a locking RPC) is machinery this table does not warrant.
  const { data: last, error: maxErr } = await supabase
    .from("vehicle_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) return { error: maxErr.message };
  const sortOrder = (last?.sort_order ?? 0) + 1;

  const { data: created, error } = await supabase
    .from("vehicle_types")
    .insert({ key, label: names.clean, label_ar: names.cleanAr, sort_order: sortOrder, active: true })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateFleet();
  return { error: null, id: (created as { id: string }).id };
}

/**
 * Rename — LABELS ONLY, in both languages.
 *
 * `key` is deliberately absent from the update. It is what a rename must not
 * touch: vehicles reference the row's id, reports and any future export
 * reference the key, and re-slugging "Pickup" to "Pick-up truck" would rewrite
 * an identifier to match a display name. The control says so on screen
 * (`fleet.vtype.keyUnchanged`) rather than leaving it as a surprise.
 *
 * `active` is absent for the same kind of reason: renaming a retired type is a
 * legitimate act of tidying and must not quietly bring it back into every
 * picker.
 */
export async function renameVehicleType(
  id: string,
  label: string,
  labelAr: string,
): Promise<ActionResult> {
  if (!id) return { error: "Missing vehicle type." };
  const names = validateNames(label, labelAr);
  if ("error" in names) return { error: names.error };

  const supabase = createClient();
  const { error } = await supabase
    .from("vehicle_types")
    .update({ label: names.clean, label_ar: names.cleanAr })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateFleet();
  return { error: null };
}

/**
 * Retire. Hides the type from the picker; every vehicle already wearing it keeps
 * resolving, and the field still renders it (marked retired) when it is the
 * current value — otherwise editing such a vehicle would show a select with no
 * matching option and Save would silently re-file it as whatever sat first.
 *
 * There is no un-retire action, and that is not an omission: typing the same
 * name into Add brings it back, labels and all. One door in, one door out.
 */
export async function retireVehicleType(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing vehicle type." };

  const supabase = createClient();
  const { error } = await supabase.from("vehicle_types").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };

  revalidateFleet();
  return { error: null };
}
