"use client";

import Link from "next/link";
import { tripHighlightHref } from "@/lib/tripHighlight";

/**
 * Clickable trip-ref (or ref-range) label. Navigates to the Kanban board and
 * highlights the given trip's card (see lib/tripHighlight.ts). Used from
 * invoice tables and statements — anywhere a trip ref is shown alongside a
 * resolvable trip id.
 */
export default function TripRefLink({
  tripId,
  label,
  className,
}: {
  tripId: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={tripHighlightHref(tripId)}
      className={className ?? "underline decoration-dotted underline-offset-2 hover:text-sky-700"}
    >
      {label}
    </Link>
  );
}
