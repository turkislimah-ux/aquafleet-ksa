import type {
  Truck, Driver, Person, Trip, WorkOrder, Part, PredictiveAlert, IoTSnapshot,
} from "./types";

// --- Deterministic PRNG so server & client match ---
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260510);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => +(min + rnd() * (max - min)).toFixed(2);
const intBetween = (min: number, max: number) => Math.floor(min + rnd() * (max - min + 1));

const DEPOTS = ["Riyadh", "Jeddah", "Dammam", "Madinah"] as const;
const DEPOT_AR: Record<string, string> = {
  Riyadh: "الرياض", Jeddah: "جدة", Dammam: "الدمام", Madinah: "المدينة",
};
const DEPOT_COORDS: Record<string, [number, number]> = {
  Riyadh: [24.7136, 46.6753], Jeddah: [21.4858, 39.1925],
  Dammam: [26.4207, 50.0888], Madinah: [24.5247, 39.5692],
};

const TRUCK_MODELS = [
  { model: "Mercedes-Benz Actros 3340", year: 2022, cap: 18000 },
  { model: "Volvo FMX 440", year: 2021, cap: 20000 },
  { model: "MAN TGS 33.400", year: 2023, cap: 16000 },
  { model: "Isuzu FVZ", year: 2020, cap: 14000 },
  { model: "Hino 700", year: 2022, cap: 18000 },
  { model: "Scania P410", year: 2023, cap: 22000 },
];

const ARABIC_NAMES = [
  ["Mohammed Al-Qahtani", "محمد القحطاني"],
  ["Abdullah Al-Otaibi", "عبدالله العتيبي"],
  ["Saleh Al-Ghamdi", "صالح الغامدي"],
  ["Khalid Al-Harbi", "خالد الحربي"],
  ["Faisal Al-Shehri", "فيصل الشهري"],
  ["Naif Al-Dosari", "نايف الدوسري"],
  ["Yousef Al-Zahrani", "يوسف الزهراني"],
  ["Hamad Al-Mutairi", "حمد المطيري"],
  ["Bandar Al-Subaie", "بندر السبيعي"],
  ["Sami Al-Anazi", "سامي العنزي"],
  ["Ahmed Al-Maliki", "أحمد المالكي"],
  ["Nasser Al-Rashidi", "ناصر الرشيدي"],
  ["Talal Al-Juhani", "طلال الجهني"],
  ["Ibrahim Al-Asiri", "إبراهيم العسيري"],
  ["Mansour Al-Balawi", "منصور البلوي"],
  ["Saud Al-Ahmadi", "سعود الأحمدي"],
  ["Tariq Al-Qurashi", "طارق القرشي"],
  ["Adel Al-Faifi", "عادل الفيفي"],
  ["Majed Al-Sulaimani", "ماجد السليماني"],
  ["Rashid Al-Hazmi", "راشد الحازمي"],
  ["Hassan Al-Yami", "حسن اليامي"],
  ["Omar Al-Shamrani", "عمر الشمراني"],
  ["Ziad Al-Bishi", "زياد البيشي"],
  ["Waleed Al-Sahli", "وليد السهلي"],
  ["Anas Al-Khaldi", "أنس الخالدي"],
  ["Fahad Al-Tamimi", "فهد التميمي"],
  ["Salman Al-Saleh", "سلمان الصالح"],
  ["Mishari Al-Hawsawi", "مشاري الحوسوي"],
  ["Sultan Al-Sharif", "سلطان الشريف"],
  ["Othman Al-Maghrabi", "عثمان المغربي"],
];

function makeIoT(truckHealth: number, depot: keyof typeof DEPOT_COORDS): IoTSnapshot {
  const [lat, lng] = DEPOT_COORDS[depot];
  const wear = 100 - truckHealth;
  return {
    engineTempC: +(85 + wear * 0.25 + rnd() * 6).toFixed(1),
    oilPressureKpa: +(380 - wear * 1.2 + rnd() * 30).toFixed(0),
    coolantLevelPct: +(95 - wear * 0.4).toFixed(1),
    brakePadWearPct: +(truckHealth - rnd() * 15).toFixed(1),
    tirePressureBarFL: +(8.0 - rnd() * 0.6).toFixed(2),
    tirePressureBarFR: +(8.0 - rnd() * 0.6).toFixed(2),
    tirePressureBarRL: +(8.2 - rnd() * 0.6).toFixed(2),
    tirePressureBarRR: +(8.2 - rnd() * 0.6).toFixed(2),
    batteryV: +(12.4 + rnd() * 1.0).toFixed(2),
    fuelLevelPct: +(20 + rnd() * 75).toFixed(1),
    tankLevelPct: +(rnd() * 100).toFixed(1),
    speedKph: +(rnd() < 0.5 ? 0 : intBetween(40, 95)),
    gps: { lat: +(lat + (rnd() - 0.5) * 0.4).toFixed(4), lng: +(lng + (rnd() - 0.5) * 0.4).toFixed(4) },
    vibrationRms: +(2 + wear * 0.08 + rnd() * 1.5).toFixed(2),
    lastUpdate: new Date(2026, 4, 10, intBetween(6, 22), intBetween(0, 59)).toISOString(),
  };
}

// ---- Trucks (40) ----
export const trucks: Truck[] = Array.from({ length: 40 }, (_, i) => {
  const idx = i + 1;
  const model = pick(TRUCK_MODELS);
  const depot = DEPOTS[i % DEPOTS.length];
  const odometer = intBetween(40000, 480000);
  const lastService = odometer - intBetween(500, 9000);
  const nextService = lastService + 15000;
  const healthBase = intBetween(38, 98);
  const statusRand = rnd();
  const status: Truck["status"] =
    healthBase < 50 ? "maintenance" :
    statusRand < 0.62 ? "active" :
    statusRand < 0.78 ? "idle" :
    statusRand < 0.92 ? "maintenance" : "out_of_service";

  return {
    id: `TRK-${String(idx).padStart(3, "0")}`,
    plate: `${5000 + idx} ABJ`,
    plateAr: `${5000 + idx} ا ب ج`,
    model: model.model,
    year: model.year,
    capacityLiters: model.cap,
    tankMaterial: pick(["stainless_steel", "polyethylene", "fiberglass"] as const),
    fuelType: "diesel",
    odometerKm: odometer,
    engineHours: intBetween(2000, 18000),
    status,
    driverId: status === "active" || status === "idle" ? `DRV-${String(((i % 30) + 1)).padStart(3, "0")}` : null,
    homeDepot: depot,
    lastServiceKm: lastService,
    nextServiceKm: nextService,
    vin: `WDB${intBetween(100000000, 999999999)}`,
    iot: makeIoT(healthBase, depot),
    healthScore: healthBase,
    fuelEfficiencyKmPerL: +(2.4 + rnd() * 1.2).toFixed(2),
    utilizationPct: +(40 + rnd() * 55).toFixed(1),
    acquiredOn: `20${intBetween(19, 24)}-${String(intBetween(1, 12)).padStart(2, "0")}-15`,
  };
});

// ---- Drivers (30) ----
export const drivers: Driver[] = Array.from({ length: 30 }, (_, i) => {
  const [name, nameAr] = ARABIC_NAMES[i % ARABIC_NAMES.length];
  const depot = DEPOTS[i % DEPOTS.length];
  const safety = intBetween(62, 99);
  const statusRand = rnd();
  const status: Driver["status"] =
    statusRand < 0.6 ? "on_duty" :
    statusRand < 0.85 ? "off_duty" :
    statusRand < 0.95 ? "leave" : "training";
  return {
    id: `DRV-${String(i + 1).padStart(3, "0")}`,
    name, nameAr,
    iqama: `2${intBetween(100000000, 999999999)}`,
    licenseExpiry: `20${intBetween(26, 29)}-${String(intBetween(1, 12)).padStart(2, "0")}-${String(intBetween(1, 28)).padStart(2, "0")}`,
    phone: `+9665${intBetween(10000000, 99999999)}`,
    homeDepot: depot,
    hireDate: `20${intBetween(15, 24)}-0${intBetween(1, 9)}-1${intBetween(0, 9)}`,
    safetyScore: safety,
    trips30d: intBetween(8, 42),
    hoursThisWeek: +(28 + rnd() * 22).toFixed(1),
    status,
    assignedTruckId: status === "on_duty" ? `TRK-${String(i + 1).padStart(3, "0")}` : null,
    rating: +(3.2 + rnd() * 1.7).toFixed(1),
    incidents12mo: rnd() < 0.7 ? 0 : intBetween(1, 3),
  };
});

// ---- People (managers, mechanics, etc.) ----
export const people: Person[] = [
  { id: "PER-001", name: "Turki Al-Slimah", nameAr: "تركي السليمة", role: "fleet_manager", email: "turki@aquafleet.sa", phone: "+966500000001", depot: "Riyadh", active: true },
  { id: "PER-002", name: "Sara Al-Otaibi", nameAr: "سارة العتيبي", role: "ops_supervisor", email: "sara@aquafleet.sa", phone: "+966500000002", depot: "Riyadh", active: true },
  { id: "PER-003", name: "Mahmoud Al-Sayed", nameAr: "محمود السيد", role: "ops_supervisor", email: "mahmoud@aquafleet.sa", phone: "+966500000003", depot: "Jeddah", active: true },
  { id: "PER-004", name: "Hatem Al-Zahrani", nameAr: "حاتم الزهراني", role: "mechanic", email: "hatem@aquafleet.sa", phone: "+966500000004", depot: "Riyadh", active: true },
  { id: "PER-005", name: "Imran Khan", nameAr: "عمران خان", role: "mechanic", email: "imran@aquafleet.sa", phone: "+966500000005", depot: "Jeddah", active: true },
  { id: "PER-006", name: "Yasir Al-Harbi", nameAr: "ياسر الحربي", role: "mechanic", email: "yasir@aquafleet.sa", phone: "+966500000006", depot: "Dammam", active: true },
  { id: "PER-007", name: "Abdulaziz Al-Najjar", nameAr: "عبدالعزيز النجار", role: "mechanic", email: "aziz@aquafleet.sa", phone: "+966500000007", depot: "Madinah", active: true },
  { id: "PER-008", name: "Reem Al-Saleh", nameAr: "ريم الصالح", role: "inventory_clerk", email: "reem@aquafleet.sa", phone: "+966500000008", depot: "Riyadh", active: true },
  { id: "PER-009", name: "Khaled Al-Anazi", nameAr: "خالد العنزي", role: "dispatcher", email: "khaled@aquafleet.sa", phone: "+966500000009", depot: "Riyadh", active: true },
  { id: "PER-010", name: "Lulwa Al-Ahmadi", nameAr: "لولوة الأحمدي", role: "dispatcher", email: "lulwa@aquafleet.sa", phone: "+966500000010", depot: "Jeddah", active: true },
];

// ---- Trips ----
const CUSTOMERS: [string, string][] = [
  ["NEOM Construction Camp", "مخيم نيوم للإنشاءات"],
  ["Aramco Operations", "عمليات أرامكو"],
  ["Riyadh Municipality", "أمانة الرياض"],
  ["Jeddah Industrial Area", "المنطقة الصناعية - جدة"],
  ["KAEC Residential", "مدينة الملك عبدالله الاقتصادية"],
  ["Diriyah Gate Project", "مشروع بوابة الدرعية"],
  ["Red Sea Project Site", "موقع مشروع البحر الأحمر"],
  ["Yanbu Industrial Hub", "مركز ينبع الصناعي"],
  ["AlUla Heritage Site", "موقع العلا التراثي"],
  ["Qiddiya Construction", "إنشاءات القدية"],
];

const ORIGIN_AR_MAP: Record<string, string> = {
  "Riyadh Filling Station 1": "محطة تعبئة الرياض 1",
  "Jeddah Desalination Plant": "محطة تحلية جدة",
  "Dammam Water Hub": "مركز مياه الدمام",
  "Madinah Filling Station": "محطة تعبئة المدينة",
};
const ORIGINS = Object.keys(ORIGIN_AR_MAP);

export const trips: Trip[] = Array.from({ length: 60 }, (_, i) => {
  const truck = trucks[i % trucks.length];
  const driverIdx = i % drivers.length;
  const customer = CUSTOMERS[i % CUSTOMERS.length];
  const origin = ORIGINS[i % ORIGINS.length];
  const distance = intBetween(45, 480);
  const planned = Math.round(distance * 1.05);
  const statusPool: Trip["status"][] = ["scheduled", "loading", "in_transit", "delivered", "delivered", "delivered", "cancelled"];
  const status = statusPool[i % statusPool.length];
  const water = Math.min(truck.capacityLiters, intBetween(8000, truck.capacityLiters));
  const fuelLiters = +(distance / truck.fuelEfficiencyKmPerL).toFixed(1);
  const startDate = new Date(2026, 4, 10 - (i % 14), intBetween(5, 21), intBetween(0, 59));
  const [oLat, oLng] = DEPOT_COORDS[truck.homeDepot];
  const [dLat, dLng] = [oLat + (rnd() - 0.5) * 1.6, oLng + (rnd() - 0.5) * 1.6];
  return {
    id: `TRP-${String(i + 1).padStart(4, "0")}`,
    ref: `WT-2026-${String(1000 + i)}`,
    truckId: truck.id,
    driverId: drivers[driverIdx].id,
    origin: { name: origin, nameAr: ORIGIN_AR_MAP[origin], lat: oLat, lng: oLng },
    destination: { name: customer[0], nameAr: customer[1], lat: dLat, lng: dLng },
    customer: customer[0], customerAr: customer[1],
    scheduledStart: startDate.toISOString(),
    actualStart: status !== "scheduled" ? startDate.toISOString() : undefined,
    actualEnd: status === "delivered" ? new Date(startDate.getTime() + planned * 60000).toISOString() : undefined,
    status,
    distanceKm: distance,
    plannedDurationMin: planned,
    actualDurationMin: status === "delivered" ? planned + intBetween(-15, 35) : undefined,
    waterLiters: water,
    waterType: pick(["potable", "non_potable", "industrial"] as const),
    costSar: +(fuelLiters * 2.18 + 350).toFixed(2),
    revenueSar: +(water * 0.085 + 200).toFixed(2),
    fuelLiters,
    routeWaypoints: [
      { lat: oLat, lng: oLng },
      { lat: (oLat + dLat) / 2 + (rnd() - 0.5) * 0.2, lng: (oLng + dLng) / 2 + (rnd() - 0.5) * 0.2 },
      { lat: dLat, lng: dLng },
    ],
    optimized: rnd() < 0.7,
  };
});

// ---- Parts ----
const PART_DEFS = [
  ["Engine Oil 15W-40", "زيت محرك 15W-40", "fluid", "L", 28, 540, 80],
  ["Oil Filter (Heavy Duty)", "فلتر زيت (ثقيل)", "filter", "ea", 95, 65, 20],
  ["Air Filter Cartridge", "فلتر هواء", "filter", "ea", 165, 38, 12],
  ["Fuel Filter Primary", "فلتر وقود رئيسي", "filter", "ea", 140, 52, 15],
  ["Brake Pad Set (Front)", "طقم تيل فرامل أمامي", "brake", "set", 620, 24, 8],
  ["Brake Pad Set (Rear)", "طقم تيل فرامل خلفي", "brake", "set", 580, 20, 8],
  ["Brake Disc Rotor", "هوب فرامل", "brake", "ea", 1180, 14, 6],
  ["Tire 12R22.5 (Steer)", "إطار 12R22.5 (توجيه)", "tire", "ea", 2150, 32, 12],
  ["Tire 12R22.5 (Drive)", "إطار 12R22.5 (دفع)", "tire", "ea", 2250, 28, 10],
  ["Coolant Concentrate", "سائل تبريد", "fluid", "L", 22, 380, 60],
  ["AdBlue / DEF", "محلول AdBlue", "fluid", "L", 8, 1200, 200],
  ["Battery 12V 200Ah", "بطارية 12V 200Ah", "electrical", "ea", 1290, 16, 6],
  ["Alternator", "دينمو", "electrical", "ea", 2150, 7, 3],
  ["Starter Motor", "سلف", "electrical", "ea", 1850, 6, 3],
  ["Tank Gasket Set", "طقم جوانات الخزان", "tank", "set", 480, 18, 6],
  ["Tank Inspection Hatch Seal", "حلقة فتحة الخزان", "tank", "ea", 145, 22, 8],
  ["Water Pump", "طلمبة ماء", "engine", "ea", 1320, 8, 3],
  ["Serpentine Belt", "سير محرك", "engine", "ea", 230, 30, 10],
  ["Wiper Blade Set", "مساحات", "consumable", "set", 95, 60, 15],
  ["Tire Pressure Sensor", "حساس ضغط إطار", "tire", "ea", 320, 25, 8],
] as const;

export const parts: Part[] = PART_DEFS.map(([name, nameAr, cat, unit, cost, onHand, reorder], i) => ({
  id: `PRT-${String(i + 1).padStart(4, "0")}`,
  sku: `SKU-${String(1000 + i)}`,
  name: name as string,
  nameAr: nameAr as string,
  category: cat as Part["category"],
  unit: unit as Part["unit"],
  unitCostSar: cost as number,
  qtyOnHand: (onHand as number) - intBetween(0, 25),
  reorderLevel: reorder as number,
  reorderQty: (reorder as number) * 2,
  warehouse: pick(["Riyadh", "Jeddah", "Dammam"] as const),
  supplier: pick(["Al-Futtaim Auto Parts", "Mohamed Yousuf Naghi", "Bin Dawood Heavy", "Juffali Trucks", "ALJ Industrial"]),
  leadTimeDays: intBetween(2, 21),
  lastReceived: `2026-0${intBetween(1, 5)}-${String(intBetween(1, 28)).padStart(2, "0")}`,
}));

// ---- Predictive Alerts ----
const PREDICTIVE_TEMPLATES = [
  { component: "Brake Pads (Rear)", signal: "Wear pattern crossed 25% threshold; vibration RMS rising", actionEn: "Schedule rear brake replacement within 2 weeks", actionAr: "جدولة استبدال الفرامل الخلفية خلال أسبوعين" },
  { component: "Engine Cooling System", signal: "Coolant temp 9°C above baseline under load", actionEn: "Inspect radiator and water pump", actionAr: "فحص الرديتر وطلمبة الماء" },
  { component: "Front-Left Tire", signal: "Pressure dropping 0.3 bar/24h — slow leak suspected", actionEn: "Replace or patch tire", actionAr: "استبدال الإطار أو إصلاحه" },
  { component: "Battery", signal: "Cranking voltage trending down (11.8V)", actionEn: "Battery test & possible replacement", actionAr: "اختبار البطارية واستبدالها إن لزم" },
  { component: "Oil Pressure Sensor", signal: "Intermittent pressure dips during idle", actionEn: "Diagnose oil pump and sensor", actionAr: "تشخيص طلمبة الزيت والحساس" },
  { component: "Tank Mounting Bolts", signal: "Vibration anomaly on rough roads", actionEn: "Re-torque tank brackets", actionAr: "إعادة شد مسامير الخزان" },
  { component: "Alternator", signal: "Charging output 13.2V (low)", actionEn: "Test alternator output, replace if <13.5V", actionAr: "فحص الدينمو واستبداله إن لزم" },
];

export const predictiveAlerts: PredictiveAlert[] = trucks
  .filter(t => t.healthScore < 80)
  .slice(0, 14)
  .map((t, i) => {
    const tpl = PREDICTIVE_TEMPLATES[i % PREDICTIVE_TEMPLATES.length];
    const sev: PredictiveAlert["severity"] =
      t.healthScore < 50 ? "critical" : t.healthScore < 65 ? "warning" : "info";
    return {
      id: `PA-${String(i + 1).padStart(4, "0")}`,
      truckId: t.id,
      component: tpl.component,
      severity: sev,
      predictedFailureInDays: sev === "critical" ? intBetween(1, 7) : sev === "warning" ? intBetween(7, 21) : intBetween(21, 60),
      confidencePct: intBetween(72, 96),
      signal: tpl.signal,
      recommendedAction: tpl.actionEn,
      recommendedActionAr: tpl.actionAr,
      createdAt: new Date(2026, 4, 10 - (i % 5)).toISOString(),
    };
  });

// ---- Work Orders ----
const WO_TEMPLATES = [
  ["10,000 km Preventive Service", "صيانة دورية 10,000 كم", "preventive"],
  ["Brake System Overhaul", "صيانة نظام الفرامل", "corrective"],
  ["Cooling System Repair", "إصلاح نظام التبريد", "corrective"],
  ["Tire Rotation & Balance", "تدوير وتوازن الإطارات", "preventive"],
  ["Tank Pressure Test", "اختبار ضغط الخزان", "inspection"],
  ["Predictive: Battery Replacement", "تنبؤي: استبدال البطارية", "predictive"],
  ["Predictive: Brake Pad Replacement", "تنبؤي: استبدال تيل الفرامل", "predictive"],
  ["Annual MOT Inspection", "فحص فني سنوي", "inspection"],
] as const;

export const workOrders: WorkOrder[] = trucks.slice(0, 22).map((t, i) => {
  const [title, titleAr, type] = WO_TEMPLATES[i % WO_TEMPLATES.length];
  const statusPool: WorkOrder["status"][] = ["open", "in_progress", "awaiting_parts", "completed", "completed"];
  const status = statusPool[i % statusPool.length];
  const priority: WorkOrder["priority"] =
    type === "predictive" ? "high" : i % 4 === 0 ? "critical" : i % 3 === 0 ? "medium" : "low";
  const opened = new Date(2026, 4, 10 - (i % 12));
  const due = new Date(opened.getTime() + (i % 5 + 2) * 86400000);
  const estCost = intBetween(450, 9500);
  return {
    id: `WO-${String(i + 1).padStart(4, "0")}`,
    truckId: t.id,
    type: type as WorkOrder["type"],
    priority, status,
    title: title as string, titleAr: titleAr as string,
    description: `Detailed inspection and service of ${title} on truck ${t.plate}.`,
    openedAt: opened.toISOString(),
    dueBy: due.toISOString(),
    closedAt: status === "completed" ? new Date(due.getTime() - 3600000).toISOString() : undefined,
    assignedMechanicId: ["PER-004", "PER-005", "PER-006", "PER-007"][i % 4],
    estimatedCostSar: estCost,
    actualCostSar: status === "completed" ? estCost + intBetween(-200, 500) : undefined,
    partsUsed: [
      { partId: parts[i % parts.length].id, qty: intBetween(1, 4) },
      { partId: parts[(i + 3) % parts.length].id, qty: intBetween(1, 2) },
    ],
    laborHours: +(2 + rnd() * 8).toFixed(1),
    predictiveSignal: type === "predictive" ? "IoT vibration + thermal anomaly" : undefined,
  };
});

// --- Helpers ---
export const fleetKpis = () => {
  const active = trucks.filter(t => t.status === "active").length;
  const maint = trucks.filter(t => t.status === "maintenance").length;
  const idle = trucks.filter(t => t.status === "idle").length;
  const oos = trucks.filter(t => t.status === "out_of_service").length;
  const utilization = +(trucks.reduce((s, t) => s + t.utilizationPct, 0) / trucks.length).toFixed(1);
  const avgHealth = +(trucks.reduce((s, t) => s + t.healthScore, 0) / trucks.length).toFixed(1);
  const todayTrips = trips.filter(t => t.scheduledStart.startsWith("2026-05-10")).length;
  const litersDelivered30d = trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.waterLiters, 0);
  const fuelCost30d = +trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.fuelLiters * 2.18, 0).toFixed(0);
  const revenue30d = +trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.revenueSar, 0).toFixed(0);
  const opCost30d = +trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.costSar, 0).toFixed(0);
  const onTimePct = +((trips.filter(t => t.status === "delivered" && (t.actualDurationMin ?? 0) <= t.plannedDurationMin + 10).length /
    Math.max(1, trips.filter(t => t.status === "delivered").length)) * 100).toFixed(1);
  return { active, maint, idle, oos, utilization, avgHealth, todayTrips, litersDelivered30d, fuelCost30d, revenue30d, opCost30d, onTimePct };
};

export const findTruck = (id: string) => trucks.find(t => t.id === id);
export const findDriver = (id: string) => drivers.find(d => d.id === id);
export const findPart = (id: string) => parts.find(p => p.id === id);
export const findPerson = (id: string) => people.find(p => p.id === id);
