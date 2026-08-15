// The two cost doughnuts must agree on what every bucket looks like.
//
// Reports Overview renders `costBuckets` (lib/reports.ts); the Dashboard's Cost
// mix renders `COST_TYPE` (lib/dashboard.ts). Both are now built from
// COST_COLOR (lib/cost-colors.ts) — this asserts they still are.
//
// WHY A TEST AND NOT JUST THE SHARED CONSTANT. The constant makes them agree
// today; nothing makes them KEEP agreeing. Either list can have a hex pasted
// back into it in thirty seconds, and the failure is invisible in review — the
// page still renders, the colours still look deliberate, they just mean
// different things on different pages. That is exactly how they drifted the
// first time, and the drift was not a near-miss: Payroll and Outsourced were
// swapped, so amber meant payroll on one page and outsourced work on the other.
//
// No browser needed — both mappings are pure data.

import { test, expect } from "@playwright/test";
import { costBuckets, type PnlRow } from "../lib/reports";
import { COST_TYPE } from "../lib/dashboard";
import { COST_COLOR } from "../lib/cost-colors";

// Reports' bucket key -> the shared key. Only "os" differs; it is that list's
// own long-standing identity (a React key on the Overview bars), deliberately
// not renamed.
const REPORTS_KEY_TO_SHARED: Record<string, keyof typeof COST_COLOR> = {
  parts: "parts",
  os: "outsourced",
  payroll: "payroll",
  commissions: "commissions",
  filling: "filling",
};

// Values are irrelevant here — only the colour mapping is under test. Cast
// because costBuckets takes a full PnlRow and every other column is unread.
const ROW = {
  month: "2026-08-01",
  parts_cost_sar: 1, os_cost_sar: 1, payroll_sar: 1,
  commissions_sar: 1, filling_cost_sar: 1,
} as PnlRow;

test("every cost bucket is the same colour on Reports and the Dashboard", () => {
  const dash = new Map(COST_TYPE.map((t) => [t.key, t.color]));

  for (const b of costBuckets(ROW)) {
    const sharedKey = REPORTS_KEY_TO_SHARED[b.key];
    expect(sharedKey, `Reports bucket "${b.key}" has no shared-key mapping`).toBeTruthy();
    expect(b.color, `Reports "${b.key}" drifted from COST_COLOR`).toBe(COST_COLOR[sharedKey]);
    expect(dash.get(sharedKey), `Dashboard "${sharedKey}" drifted from COST_COLOR`)
      .toBe(COST_COLOR[sharedKey]);
    // The assertion that actually matters to a person looking at two screens.
    expect(b.color, `"${b.key}" renders a different colour on the two pages`)
      .toBe(dash.get(sharedKey));
  }
});

test("Payroll and Outsourced are no longer swapped between the pages", () => {
  // The specific regression, pinned by name rather than by loop, so a failure
  // reads as what it is instead of as "some bucket drifted".
  const r = new Map(costBuckets(ROW).map((b) => [b.key, b.color]));
  const d = new Map(COST_TYPE.map((t) => [t.key, t.color]));

  expect(r.get("payroll")).toBe(d.get("payroll"));
  expect(r.get("os")).toBe(d.get("outsourced"));
  expect(r.get("payroll")).not.toBe(r.get("os"));
});

test("Reports covers five buckets; the Dashboard adds only 'other'", () => {
  // Reports scopes itself to OPERATING cost, so manual expenses are absent by
  // design (0098 keeps them a separate P&L section). If a sixth bucket ever
  // appears on Reports, this fails and someone has to decide deliberately.
  expect(costBuckets(ROW).map((b) => b.key))
    .toEqual(["parts", "os", "payroll", "commissions", "filling"]);
  expect(COST_TYPE.map((t) => t.key))
    .toEqual(["parts", "outsourced", "payroll", "commissions", "filling", "other"]);
});
