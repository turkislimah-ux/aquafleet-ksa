"use client";

// A person's ID number, rendered as a DEEP LINK into the Archive.
//
// "The person owns the number" (0088): an Iqama or licence number lives on
// the driver/staff row, and the documents that carry it live in the Archive's
// Staff tab. Clicking the number is the shortest path between the two — it
// opens that person's own row in the right matrix, rather than making
// somebody find the Archive, the tab, the sub-tab and the person by hand.
//
// A LEAF component: imports nothing from either page that uses it, so both
// the driver detail and the staff detail can pull it one-way.
//
// Renders a plain "—" when there is no number — a link to a row about a
// number nobody has entered yet would be a dead end.

import Link from "next/link";

export default function PersonIdLink({
  personId,
  sub,
  value,
}: {
  personId: string;
  // Which Staff sub-tab holds this person's matrix.
  sub: "drivers" | "management";
  value: string | null;
}) {
  if (!value) return <span className="muted">—</span>;
  return (
    <Link
      href={`/archive?tab=staff&sub=${sub}&person=${personId}`}
      className="font-mono text-xs text-brand-600 dark:text-brand-300 hover:underline"
      title="Open this person's documents in the Archive"
    >
      {value}
    </Link>
  );
}
