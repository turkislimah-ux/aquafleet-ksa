"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null };

function str(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null) {
  const s = str(v);
  return s === "" ? null : s;
}

// LIFECYCLE FIELDS ONLY — no money. rate_per_trip_sar, commission_mode and
// commission_value used to be parsed here and written straight into `projects`
// by updateProject below. That was the last direct-write path to the commission
// columns, and it was a real hazard rather than a tidiness complaint:
//
//   - It carried NO effective date. 0148 made commission effective-dated, so an
//     undated write lands as "today" through 0147's trigger — meaning a save on
//     this form could republish a superseded figure as today's terms and
//     silently supersede a change scheduled for next month.
//   - It never carried commission_bump_pct at all, so every save through this
//     form zeroed the bump on a scalable project.
//
// Both columns are `not null default` (0001), so leaving them out of the INSERT
// below is safe: a project created here opens on 0 SAR fixed, which is exactly
// what the removed inputs defaulted to anyway. 0147's INSERT trigger writes the
// matching opening history row either way.
//
// To change a commission figure, use ProjectModal on /trips — it goes through
// set_project_commission, which is the single writer.
function parse(formData: FormData) {
  return {
    customer_id: str(formData.get("customer_id")),
    name: str(formData.get("name")),
    start_date: nullable(formData.get("start_date")),
    end_date: nullable(formData.get("end_date")),
    status: str(formData.get("status")) || "active",
  };
}

export async function createProject(formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.customer_id) return { error: "Customer is required." };

  const supabase = createClient();
  const { error } = await supabase.from("projects").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/projects");
  return { error: null };
}

export async function updateProject(id: string, formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.customer_id) return { error: "Customer is required." };

  const supabase = createClient();
  const { error } = await supabase.from("projects").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/projects");
  return { error: null };
}

// Replace-all the drivers staffing a project (project_drivers join). Mirrors the
// demo's "Manage drivers" Save: whatever is selected becomes the full set.
export async function setProjectDrivers(
  projectId: string,
  driverIds: string[]
): Promise<ActionResult> {
  if (!projectId) return { error: "Missing project." };

  const supabase = createClient();
  // Clear the project's current assignments, then insert the chosen set.
  const { error: delErr } = await supabase
    .from("project_drivers")
    .delete()
    .eq("project_id", projectId);
  if (delErr) return { error: delErr.message };

  const rows = Array.from(new Set(driverIds.filter(Boolean))).map((driver_id) => ({
    project_id: projectId,
    driver_id,
  }));
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("project_drivers").insert(rows);
    if (insErr) return { error: insErr.message };
  }

  revalidatePath("/projects");
  revalidatePath("/trips");
  return { error: null };
}
