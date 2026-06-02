import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSar(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " SAR";
}

export function formatNum(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

export function statusTone(s: string): "ok" | "warn" | "bad" | "info" | "muted" {
  switch (s) {
    case "active": case "on_duty": case "delivered": case "completed": return "ok";
    case "idle": case "scheduled": case "loading": case "off_duty": return "info";
    case "maintenance": case "in_progress": case "awaiting_parts": case "warning": case "training": case "in_transit": return "warn";
    case "out_of_service": case "cancelled": case "critical": return "bad";
    default: return "muted";
  }
}
