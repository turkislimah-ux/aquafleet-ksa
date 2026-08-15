// TEST 4 — the station-change gate and the filling-cost re-snapshot.
//
// WHAT THIS FILE CAN AND CANNOT REACH, stated first so the coverage is not
// overread. This harness has NO Supabase session, so a server action cannot be
// exercised end-to-end: RLS returns zero rows to an anonymous client, which
// means the gate's own station read would come back empty and the gate would
// not fire for the RIGHT reason. Testing it that way would prove nothing and
// would look like it proved everything.
//
// So the rule is tested where the rule actually lives. `stationChangePatch`
// (app/trips/actions.ts) is two Supabase reads wrapped around ONE pure call to
// `decideStationChange`; that pure call is the whole decision — whether the
// move is blocked, and what happens to the frozen cost if it is not. These
// tests drive it directly, with the REAL live station pricing rows, so they
// assert the shipped code path's actual verdict rather than a restatement of it.
//
// The DB half of test 4 — apply the change, watch filling_cost_sar move or stay
// frozen, revert — was run separately against live data through the Supabase
// MCP and is reported with the run. No browser is needed here.
//
// LIVE PRICING, pulled via the Supabase MCP on 2026-08-14. NULL = the station
// does not offer that type; 0 would be a real free fill and is never the same
// thing.

import { test, expect } from "@playwright/test";
import type { TripStage } from "../lib/db-types";
import {
  decideStationChange,
  stationBlockedForType,
  selectableWaterTypes,
} from "../lib/station-pricing";

const MANFUHAH = { fill_cost_potable_sar: 15, fill_cost_non_potable_sar: 10 };
const SHAS = { fill_cost_potable_sar: 80, fill_cost_non_potable_sar: 50 };
const UMM_AL_HAMAM = { fill_cost_potable_sar: null, fill_cost_non_potable_sar: 10 };
const OLAYA = { fill_cost_potable_sar: null, fill_cost_non_potable_sar: 80 };
const FURAIAN = { fill_cost_potable_sar: 0, fill_cost_non_potable_sar: 0 };
// No live station is unpriced any more, but the legacy allowance is still in
// the code and still has to behave — a pre-0110 row must not freeze edits.
const LEGACY_UNPRICED = { fill_cost_potable_sar: null, fill_cost_non_potable_sar: null };

// The production rule, mirrored once (app/trips/actions.ts's stationChangePatch):
// a trip is closed history only when it is delivered at BOTH ENDS of the write.
// A function, not two consts — annotated consts still narrow to their literal
// type, so `from === "delivered"` reads as a constant and tsc rejects the
// comparison (TS2367), hiding the very expression under test.
function isClosedHistory(from: TripStage, to: TripStage): boolean {
  return from === "delivered" && to === "delivered";
}

test("4a — an in-transit trip moving to a station that offers its type re-snapshots to the NEW price", () => {
  // AI-026-0021: in_transit, non_potable, at Manfuhah, frozen at 10.00.
  // Moving it to Shas (non-potable 50.00) must re-take the cost, because the
  // truck filled somewhere else — the freeze is against PRICE EDITS, not
  // against changing which station did the filling.
  const d = decideStationChange(SHAS, "non_potable", false);
  expect(d.blocked).toBe(false);
  expect(d.costPatch).toEqual({ filling_cost_sar: 50 });
});

test("REGRESSION — becoming delivered is NOT closed history; the cost is re-taken", () => {
  // THIS ONE REACHED LIVE DATA. KI-026-0062 was moved to Shas and marked
  // delivered in a single Move-trip apply. setTripStage passed only the TARGET
  // stage, so `delivered` read as "closed history, leave the cost alone" — the
  // new station was written and the OLD station's price kept. The trip sat at
  // Shas (potable 80.00) holding 15.00, which was Manfuhah's potable price
  // before it was edited to 5.00, and had never been a Shas price at all.
  // Reports showed "Shas Water Station · 1 fill · 15 SAR" and Turki caught it.
  //
  // The rule is delivered at BOTH ENDS. from=in_transit, to=delivered is a trip
  // becoming delivered right now: the fill has just been asserted to have
  // happened somewhere else, so the cost must follow the station.
  const closedHistory = isClosedHistory("in_transit", "delivered");
  expect(closedHistory).toBe(false);

  const d = decideStationChange(SHAS, "potable", closedHistory);
  expect(d.blocked).toBe(false);
  expect(d.costPatch).toEqual({ filling_cost_sar: 80 });
});

test("REGRESSION — leaving delivered re-takes the cost too; the trip is reopened", () => {
  // The mirror case. A trip pushed back out of delivered is live again, so its
  // cost should follow its station rather than staying frozen at whatever the
  // closed period recorded. Keying on the CURRENT stage alone would have got
  // this one wrong in the other direction.
  const closedHistory = isClosedHistory("delivered", "in_transit");
  expect(closedHistory).toBe(false);
  expect(decideStationChange(SHAS, "potable", closedHistory).costPatch)
    .toEqual({ filling_cost_sar: 80 });
});

test("4b — a DELIVERED trip's cost does not move, whatever station it is given", () => {
  // AI-026-0001: delivered, non_potable, frozen at 10.00, staying delivered —
  // delivered at BOTH ends, so it is closed history: its cost has been reported
  // and re-taking it would silently restate a period. This is the pure
  // station-edit case (setTripStation changes no stage, so it passes the same
  // stage twice); the two REGRESSION tests above cover the ends differing.
  //
  // `costPatch === null` means DO NOT TOUCH — deliberately distinct from
  // `{ filling_cost_sar: null }`, which would WRITE a null and wipe the figure.
  // Asserting the distinction is the point of this test.
  for (const station of [SHAS, MANFUHAH, FURAIAN]) {
    const d = decideStationChange(station, "non_potable", true);
    expect(d.blocked).toBe(false);
    expect(d.costPatch).toBeNull();
  }
});

test("4c — THE GATE: a potable trip cannot move to Umm Al Hamam", () => {
  // The live bug. KI-026-0062 was potable, in_transit, and was moved to a
  // station that does not fill potable at all; its cost correctly went to NULL
  // and the trip was left parked somewhere physically incapable of filling it.
  const d = decideStationChange(UMM_AL_HAMAM, "potable", false);
  expect(d.blocked).toBe(true);
  // A blocked decision carries NO patch — the caller must refuse the whole
  // write, not save the station and skip the cost.
  expect(d.costPatch).toBeUndefined();

  // Olaya is the other potable-less station; same verdict, so the rule is
  // reading the pricing rather than matching one station key.
  expect(decideStationChange(OLAYA, "potable", false).blocked).toBe(true);
});

test("4c/ii — the gate holds at EVERY stage, delivered included", () => {
  // Grandfathering means the 13 existing Umm Al Hamam potable trips STAY. It
  // does not mean more may be created — including by re-parking a delivered
  // one. The freeze protects a delivered trip's COST; it does not license
  // putting it at a station that could not have filled it.
  expect(decideStationChange(UMM_AL_HAMAM, "potable", true).blocked).toBe(true);
});

test("4c/iii — the gate is type-specific, not a blanket ban on the station", () => {
  // Umm Al Hamam fills non-potable at 10.00 and must keep taking those trips.
  // A gate that blocked the whole station would break real operations.
  const d = decideStationChange(UMM_AL_HAMAM, "non_potable", false);
  expect(d.blocked).toBe(false);
  expect(d.costPatch).toEqual({ filling_cost_sar: 10 });
});

test("zero is a real price and never reads as 'not offered'", () => {
  // Furaian fills both types free. `0` must survive as a price — the moment it
  // collapses into "no price" the gate starts refusing a station that works,
  // and the cost snapshot starts writing null over a true 0.00.
  expect(stationBlockedForType(FURAIAN, "potable")).toBe(false);
  expect(decideStationChange(FURAIAN, "potable", false).costPatch)
    .toEqual({ filling_cost_sar: 0 });
});

test("a legacy unpriced station blocks nothing, exactly as trip-add allows both types", () => {
  // The two directions of the one rule have to agree: if trip creation would
  // let you pick either type at this station, changing to it cannot be refused.
  expect(selectableWaterTypes(LEGACY_UNPRICED)).toEqual(["potable", "non_potable"]);
  expect(decideStationChange(LEGACY_UNPRICED, "potable", false).blocked).toBe(false);
  // ...and it produces a NULL cost, which is the honest "we do not know what
  // this fill cost" rather than a fabricated 0.
  expect(decideStationChange(LEGACY_UNPRICED, "potable", false).costPatch)
    .toEqual({ filling_cost_sar: null });
});

test("clearing the station (direct-customer trips) is never blocked", () => {
  // No station to gate against. The cost still goes to null below — nothing is
  // known about a fill that has no station.
  const d = decideStationChange(null, "potable", false);
  expect(d.blocked).toBe(false);
  expect(d.costPatch).toEqual({ filling_cost_sar: null });
});
