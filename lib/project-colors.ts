// Deterministic decorative pill color per project id (hash → fixed palette).
// Same id => same color EVERYWHERE a project shows as a pill — the Trips
// calendar strip (app/trips/ProjectsBoard.tsx) and the Drivers/Fleet
// "Assigned Project" columns both import this so a given project always
// renders the same color across features. No status meaning, no legend.
const PILL_PALETTE = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];

export function pillColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PILL_PALETTE[h % PILL_PALETTE.length];
}
