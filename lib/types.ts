export type TruckStatus = "active" | "idle" | "maintenance" | "out_of_service";
export type FuelType = "diesel" | "petrol";
export type TankMaterial = "stainless_steel" | "polyethylene" | "fiberglass";

export interface Truck {
  id: string;
  plate: string;
  plateAr: string;
  model: string;
  year: number;
  capacityLiters: number;
  tankMaterial: TankMaterial;
  fuelType: FuelType;
  odometerKm: number;
  engineHours: number;
  status: TruckStatus;
  driverId: string | null;
  homeDepot: "Riyadh" | "Jeddah" | "Dammam" | "Madinah";
  lastServiceKm: number;
  nextServiceKm: number;
  vin: string;
  iot: IoTSnapshot;
  healthScore: number; // 0-100
  fuelEfficiencyKmPerL: number;
  utilizationPct: number;
  acquiredOn: string; // ISO date
}

export interface IoTSnapshot {
  engineTempC: number;
  oilPressureKpa: number;
  coolantLevelPct: number;
  brakePadWearPct: number; // 100 = new
  tirePressureBarFL: number;
  tirePressureBarFR: number;
  tirePressureBarRL: number;
  tirePressureBarRR: number;
  batteryV: number;
  fuelLevelPct: number;
  tankLevelPct: number;
  speedKph: number;
  gps: { lat: number; lng: number };
  vibrationRms: number; // mm/s
  lastUpdate: string;
}

export interface Driver {
  id: string;
  name: string;
  nameAr: string;
  iqama: string;
  licenseExpiry: string;
  phone: string;
  homeDepot: string;
  hireDate: string;
  safetyScore: number; // 0-100
  trips30d: number;
  hoursThisWeek: number;
  status: "on_duty" | "off_duty" | "leave" | "training";
  assignedTruckId: string | null;
  rating: number; // 1-5
  incidents12mo: number;
}

export interface Person {
  id: string;
  name: string;
  nameAr: string;
  role: "fleet_manager" | "ops_supervisor" | "mechanic" | "inventory_clerk" | "dispatcher";
  email: string;
  phone: string;
  depot: string;
  active: boolean;
}

export type TripStatus = "scheduled" | "loading" | "in_transit" | "delivered" | "cancelled";

export interface Trip {
  id: string;
  ref: string;
  truckId: string;
  driverId: string;
  origin: { name: string; nameAr: string; lat: number; lng: number };
  destination: { name: string; nameAr: string; lat: number; lng: number };
  customer: string;
  customerAr: string;
  scheduledStart: string;
  actualStart?: string;
  actualEnd?: string;
  status: TripStatus;
  distanceKm: number;
  plannedDurationMin: number;
  actualDurationMin?: number;
  waterLiters: number;
  waterType: "potable" | "non_potable" | "industrial";
  costSar: number;
  revenueSar: number;
  fuelLiters: number;
  routeWaypoints: { lat: number; lng: number }[];
  optimized: boolean;
}

export type WorkOrderStatus = "open" | "in_progress" | "awaiting_parts" | "completed" | "cancelled";
export type WorkOrderPriority = "low" | "medium" | "high" | "critical";
export type WorkOrderType = "preventive" | "corrective" | "predictive" | "inspection";

export interface WorkOrder {
  id: string;
  truckId: string;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  title: string;
  titleAr: string;
  description: string;
  openedAt: string;
  dueBy: string;
  closedAt?: string;
  assignedMechanicId: string | null;
  estimatedCostSar: number;
  actualCostSar?: number;
  partsUsed: { partId: string; qty: number }[];
  laborHours: number;
  predictiveSignal?: string;
}

export interface Part {
  id: string;
  sku: string;
  name: string;
  nameAr: string;
  category: "engine" | "brake" | "tire" | "fluid" | "electrical" | "tank" | "filter" | "consumable";
  unit: "ea" | "L" | "kg" | "set";
  unitCostSar: number;
  qtyOnHand: number;
  reorderLevel: number;
  reorderQty: number;
  warehouse: "Riyadh" | "Jeddah" | "Dammam";
  supplier: string;
  leadTimeDays: number;
  lastReceived: string;
}

export interface PredictiveAlert {
  id: string;
  truckId: string;
  component: string;
  severity: "info" | "warning" | "critical";
  predictedFailureInDays: number;
  confidencePct: number;
  signal: string;
  recommendedAction: string;
  recommendedActionAr: string;
  createdAt: string;
}

export interface KpiPoint { label: string; value: number; }
