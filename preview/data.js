// Deterministic mock dataset for the AquaFleet KSA SaaS demo.
(function () {
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20260511);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const between = (min, max) => +(min + rnd() * (max - min)).toFixed(2);
  const intBetween = (min, max) => Math.floor(min + rnd() * (max - min + 1));

  const DEPOTS = ["Riyadh", "Jeddah", "Dammam", "Madinah"];
  const DEPOT_COORDS = {
    Riyadh: [24.7136, 46.6753], Jeddah: [21.4858, 39.1925],
    Dammam: [26.4207, 50.0888], Madinah: [24.5247, 39.5692],
  };

  // Water truck capacity classes — only three tank sizes are operated:
  // 33 m³ (heavy), 18 m³ (standard), 6 m³ (light/urban).
  const CAPACITY_M3 = [33, 18, 6, 18, 33, 6];
  const TRUCK_MODELS = [
    { model: "Mercedes-Benz Actros 3340", year: 2022 },
    { model: "Volvo FMX 440",            year: 2021 },
    { model: "MAN TGS 33.400",           year: 2023 },
    { model: "Isuzu FVZ",                year: 2020 },
    { model: "Hino 700",                 year: 2022 },
    { model: "Scania P410",              year: 2023 },
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

  /** Each engine-mounted sensor reads VIBRATION (mm/s RMS) + SOUND (dB).
   *  A component's condition is derived from how far those readings sit above
   *  the component's nominal threshold. Higher wear = noisier + shakier. */
  const ENGINE_COMPONENTS = [
    { key: "gearbox",    en: "Gearbox",        ar: "علبة التروس",        vibBase: 2.8, sndBase: 78, vibMax: 6.0, sndMax: 95 },
    { key: "valves",     en: "Valves",         ar: "الصمامات",           vibBase: 1.6, sndBase: 72, vibMax: 4.5, sndMax: 90 },
    { key: "crankshaft", en: "Crankshaft",     ar: "عمود الكرنك",        vibBase: 2.2, sndBase: 75, vibMax: 5.5, sndMax: 92 },
    { key: "turbo",      en: "Turbocharger",   ar: "الشاحن التوربيني",   vibBase: 3.4, sndBase: 82, vibMax: 7.0, sndMax: 98 },
    { key: "camshaft",   en: "Camshaft",       ar: "عمود الحدبات",       vibBase: 1.8, sndBase: 71, vibMax: 4.8, sndMax: 88 },
    { key: "pistons",    en: "Pistons",        ar: "المكابس",            vibBase: 2.4, sndBase: 76, vibMax: 6.2, sndMax: 94 },
    { key: "injectors",  en: "Fuel Injectors", ar: "بخاخات الوقود",      vibBase: 1.4, sndBase: 70, vibMax: 4.0, sndMax: 86 },
    { key: "alternator", en: "Alternator",     ar: "الدينمو",            vibBase: 1.9, sndBase: 73, vibMax: 4.6, sndMax: 90 },
  ];

  function makeIoT(health, depot) {
    const [lat, lng] = DEPOT_COORDS[depot];
    const wear = 100 - health;            // 0-62 ish
    const wearF = wear / 60;              // 0..1 normalized
    // Per-component vibration + sound. Higher wear pushes readings toward the
    // component's threshold; condition is "ok" up to ~70% of max, "warn" up
    // to ~90%, and "bad" above that.
    const engineComponents = {};
    ENGINE_COMPONENTS.forEach(c => {
      const vibRange = c.vibMax - c.vibBase;
      const sndRange = c.sndMax - c.sndBase;
      const vibrationRms = +(c.vibBase + vibRange * wearF * (0.55 + rnd() * 0.7)).toFixed(2);
      const soundDb = +(c.sndBase + sndRange * wearF * (0.5 + rnd() * 0.7)).toFixed(1);
      const vibPct = (vibrationRms - c.vibBase) / vibRange;
      const sndPct = (soundDb - c.sndBase) / sndRange;
      const worst = Math.max(vibPct, sndPct);
      const condition = worst > 0.9 ? "bad" : worst > 0.7 ? "warn" : "ok";
      engineComponents[c.key] = { vibrationRms, soundDb, condition };
    });
    return {
      // Vehicle-level
      speedKph: rnd() < 0.5 ? 0 : intBetween(40, 95),
      fuelLevelPct: +(20 + rnd() * 75).toFixed(1),
      tankLevelPct: +(rnd() * 100).toFixed(1),
      gps: { lat: +(lat + (rnd() - 0.5) * 0.4).toFixed(4), lng: +(lng + (rnd() - 0.5) * 0.4).toFixed(4) },
      // Engine component health (vibration + sound sensors detect failures)
      engineComponents,
      // Aggregated overall vibration kept for backward compat with calendar code
      vibrationRms: +(Object.values(engineComponents).reduce((s, c) => s + c.vibrationRms, 0) / ENGINE_COMPONENTS.length).toFixed(2),
      lastUpdate: new Date(2026, 4, 11, intBetween(6, 22), intBetween(0, 59)).toISOString(),
    };
  }

  // ---- 40 trucks ----
  const trucks = Array.from({ length: 40 }, (_, i) => {
    const idx = i + 1;
    const m = TRUCK_MODELS[i % TRUCK_MODELS.length];
    const depot = DEPOTS[i % DEPOTS.length];
    const odometer = intBetween(40000, 480000);
    const lastServiceKm = odometer - intBetween(500, 9000);
    // Last service date: 5–180 days before today's reference (May 11, 2026)
    const daysAgo = intBetween(5, 180);
    const lastServiceDate = new Date(2026, 4, 11);
    lastServiceDate.setDate(lastServiceDate.getDate() - daysAgo);
    const health = intBetween(38, 98);
    const sr = rnd();
    // Only three statuses now: active / maintenance / out_of_service.
    // "Idle" is folded into "active" (the truck is operational, just not on a trip).
    const status = health < 50 ? "maintenance"
                  : sr < 0.78 ? "active"
                  : sr < 0.92 ? "maintenance"
                  : "out_of_service";
    const capacityM3 = CAPACITY_M3[i % CAPACITY_M3.length];
    return {
      id: `TRK-${String(idx).padStart(3, "0")}`,
      plate: `${5000 + idx} ABJ`,
      plateAr: `${5000 + idx} ا ب ج`,
      model: m.model, year: m.year,
      capacityM3,
      capacityLiters: capacityM3 * 1000,  // kept for downstream code paths
      tankMaterial: pick(["stainless_steel", "polyethylene", "fiberglass"]),
      fuelType: "diesel",
      odometerKm: odometer,
      engineHours: intBetween(2000, 18000),
      status,
      driverId: status === "active" ? `DRV-${String(((i % 30) + 1)).padStart(3, "0")}` : null,
      homeDepot: depot,
      lastServiceKm,
      lastServiceDate: lastServiceDate.toISOString().slice(0, 10),
      nextServiceKm: lastServiceKm + 15000, // kept for any old refs
      vin: `WDB${intBetween(100000000, 999999999)}`,
      iot: makeIoT(health, depot),
      healthScore: health,
      fuelEfficiencyKmPerL: +(2.4 + rnd() * 1.2).toFixed(2),
      utilizationPct: +(40 + rnd() * 55).toFixed(1),
      acquiredOn: `20${intBetween(19, 24)}-${String(intBetween(1, 12)).padStart(2, "0")}-15`,
    };
  });

  // ---- 30 drivers ----
  const drivers = Array.from({ length: 30 }, (_, i) => {
    const [name, nameAr] = ARABIC_NAMES[i % ARABIC_NAMES.length];
    const depot = DEPOTS[i % DEPOTS.length];
    const safety = intBetween(62, 99);
    const sr = rnd();
    const status = sr < 0.6 ? "on_duty" : sr < 0.85 ? "off_duty" : sr < 0.95 ? "leave" : "training";
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

  const people = [
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

  // ---- 60 trips ----
  const CUSTOMERS = [
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
  const ORIGIN_AR_MAP = {
    "Riyadh Filling Station 1": "محطة تعبئة الرياض 1",
    "Jeddah Desalination Plant": "محطة تحلية جدة",
    "Dammam Water Hub": "مركز مياه الدمام",
    "Madinah Filling Station": "محطة تعبئة المدينة",
  };
  const ORIGINS = Object.keys(ORIGIN_AR_MAP);

  // Water filling stations — each tanker fills its tank at one of these
  // stations before heading out. Drivers can pick any station; the chosen
  // station is shown in the Loading-column Kanban card.
  const WATER_STATIONS = [
    { id: "WS-MAN",   name: "Manfuhah Station",     nameAr: "محطة منفوحة",         city: "Riyadh",  cityAr: "الرياض" },
    { id: "WS-UAH",   name: "Umm Al Hamam Station", nameAr: "محطة أم الحمام",      city: "Riyadh",  cityAr: "الرياض" },
    { id: "WS-OLA",   name: "Olaya Filling Point",  nameAr: "نقطة العليا للتعبئة", city: "Riyadh",  cityAr: "الرياض" },
    { id: "WS-JED-N", name: "Jeddah North Plant",   nameAr: "محطة جدة الشمالية",   city: "Jeddah",  cityAr: "جدة" },
    { id: "WS-JED-S", name: "Al Hamra Station",     nameAr: "محطة الحمراء",        city: "Jeddah",  cityAr: "جدة" },
    { id: "WS-DAM",   name: "Dammam Desalination",  nameAr: "محطة تحلية الدمام",   city: "Dammam",  cityAr: "الدمام" },
    { id: "WS-MAD",   name: "Madinah Filling Hub",  nameAr: "محطة تعبئة المدينة",  city: "Madinah", cityAr: "المدينة" },
    { id: "WS-TBK",   name: "Tabuk West Station",   nameAr: "محطة تبوك الغربية",   city: "Tabuk",   cityAr: "تبوك" },
  ];

  // "Today" anchor used by the trip seed below + by the Kanban reporting
  // periods (daily / weekly / monthly / quarterly).
  const TRIPS_TODAY = new Date(2026, 5, 7);  // 2026-06-07

  const trips = Array.from({ length: 72 }, (_, i) => {
    const truck = trucks[i % trucks.length];
    const customer = CUSTOMERS[i % CUSTOMERS.length];
    const origin = ORIGINS[i % ORIGINS.length];
    const distance = intBetween(45, 480);
    const planned = Math.round(distance * 1.05);
    const pool = ["scheduled", "loading", "in_transit", "delivered", "delivered", "delivered", "cancelled"];
    const status = pool[i % pool.length];
    const water = Math.min(truck.capacityLiters, intBetween(8000, truck.capacityLiters));
    const fuelLiters = +(distance / truck.fuelEfficiencyKmPerL).toFixed(1);
    // Spread trips across last 35 days from TRIPS_TODAY so daily/weekly/
    // monthly/quarterly reporting periods are all non-empty.
    const dayOffset = -(i % 35);
    const startDate = new Date(TRIPS_TODAY.getTime() + dayOffset * 86400000);
    startDate.setHours(intBetween(5, 21), intBetween(0, 59), 0, 0);
    const [oLat, oLng] = DEPOT_COORDS[truck.homeDepot];
    const dLat = oLat + (rnd() - 0.5) * 1.6, dLng = oLng + (rnd() - 0.5) * 1.6;
    // Tank class = the truck's capacity in m³ (33 / 18 / 6). Loading phase
    // gets a water-station assignment.
    const tankSizeM3 = truck.capacityM3 || Math.round((truck.capacityLiters || 18000) / 1000);
    const waterStationId = WATER_STATIONS[i % WATER_STATIONS.length].id;
    // Phase timestamps — populated for whichever phases the trip has reached.
    const loadingAt = (status !== "scheduled") ? new Date(startDate.getTime() + 5 * 60000).toISOString() : null;
    const inTransitAt = (status === "in_transit" || status === "delivered") ? new Date(startDate.getTime() + 25 * 60000).toISOString() : null;
    const deliveredAt = (status === "delivered") ? new Date(startDate.getTime() + planned * 60000).toISOString() : null;
    return {
      id: `TRP-${String(i + 1).padStart(4, "0")}`,
      ref: `WT-2026-${String(1000 + i)}`,
      truckId: truck.id,
      driverId: drivers[i % drivers.length].id,
      origin: { name: origin, nameAr: ORIGIN_AR_MAP[origin], lat: oLat, lng: oLng },
      destination: { name: customer[0], nameAr: customer[1], lat: dLat, lng: dLng },
      customer: customer[0], customerAr: customer[1],
      projectId: null,  // back-filled after PROJECT_BY_CUSTOMER is built
      tankSizeM3,
      waterStationId,
      phaseTimestamps: {
        scheduled: startDate.toISOString(),
        loading: loadingAt,
        in_transit: inTransitAt,
        delivered: deliveredAt,
      },
      scheduledStart: startDate.toISOString(),
      actualStart: status !== "scheduled" ? startDate.toISOString() : undefined,
      actualEnd: status === "delivered" ? new Date(startDate.getTime() + planned * 60000).toISOString() : undefined,
      status,
      distanceKm: distance,
      plannedDurationMin: planned,
      actualDurationMin: status === "delivered" ? planned + intBetween(-15, 35) : undefined,
      waterLiters: water,
      waterType: pick(["potable", "non_potable", "industrial"]),
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
  ];

  /**
   * Parts now carry a *price history* so older stock can be consumed at its
   * original cost (FIFO) before the new market price takes effect. Each part
   * has one or more `priceTiers` — { priceSar, qty }. The current market price
   * is always the LAST tier (the one that will be used for the next purchase).
   */
  // Suppliers are full vendor records (name + contact). Code that previously
  // expected a list of strings should now read `.name` — kept names array as
  // SUPPLIER_NAMES for any legacy template strings.
  const SUPPLIERS = [
    { id: "SUP-001", name: "Al-Futtaim Auto Parts",  phone: "+966 11 478 1100", email: "orders@futtaim-ap.sa",   contactPerson: "Yousef Al-Otaibi" },
    { id: "SUP-002", name: "Mohamed Yousuf Naghi",   phone: "+966 12 661 4500", email: "sales@naghi-parts.sa",   contactPerson: "Rashid Naghi" },
    { id: "SUP-003", name: "Bin Dawood Heavy",       phone: "+966 13 824 0099", email: "po@bindawood-heavy.sa",  contactPerson: "Salem Bin Dawood" },
    { id: "SUP-004", name: "Juffali Trucks",         phone: "+966 11 245 7700", email: "parts@juffali.com",      contactPerson: "Khalid Al-Juffali" },
    { id: "SUP-005", name: "ALJ Industrial",         phone: "+966 12 668 4400", email: "supply@alj-industrial.sa", contactPerson: "Faisal Al-Jomaih" },
  ];
  const SUPPLIER_NAMES = SUPPLIERS.map(s => s.name);

  /** Warehouses where part inventory lives. Previously hard-coded as a
   *  three-item list in the parts seed — promoted here so the UI can add
   *  new locations on the fly. */
  const WAREHOUSES = [
    { id: "WH-RIY", name: "Riyadh",  nameAr: "الرياض",   city: "Riyadh",  cityAr: "الرياض",   address: "Industrial Area, Riyadh" },
    { id: "WH-JED", name: "Jeddah",  nameAr: "جدة",      city: "Jeddah",  cityAr: "جدة",      address: "Phase 2 Industrial Zone, Jeddah" },
    { id: "WH-DAM", name: "Dammam",  nameAr: "الدمام",   city: "Dammam",  cityAr: "الدمام",   address: "Eastern Industrial Cluster, Dammam" },
  ];

  /** Custom Archive document types — user-defined doc taxonomies that sit
   *  alongside the 14 built-in types. Declared up here so `aiExtract` can
   *  reference it without hitting the TDZ. */
  const archiveCustomTypes = [
    {
      id: "DT-ZAKAT",
      label: "Zakat & Tax Certificate",
      labelAr: "شهادة الزكاة والضريبة",
      color: "#0c66bf",
      fields: [
        { key: "certificateNumber", label: "Certificate #",     labelAr: "رقم الشهادة" },
        { key: "entity",            label: "Entity",            labelAr: "المنشأة" },
        { key: "authority",         label: "Issuing authority", labelAr: "الجهة المُصدِرة" },
        { key: "issueDate",         label: "Issue date",        labelAr: "تاريخ الإصدار" },
        { key: "expiryDate",        label: "Expiry date",       labelAr: "تاريخ الانتهاء" },
        { key: "notes",             label: "Notes",             labelAr: "ملاحظات" },
      ],
      createdAt: "2026-04-01",
    },
  ];
  const findSupplierByName = (name) => SUPPLIERS.find(s => s.name === name) || SUPPLIERS[0];

  const parts = PART_DEFS.map((d, i) => {
    const baseCost = d[4];
    const onHand = d[5] - intBetween(0, 25);
    // ~60% of parts have a price change recorded (old tier + current tier).
    // Each tier carries qtyPurchased (the constant amount received in that
    // batch) AND qty (= qtyRemaining, decreases as parts are consumed).
    const hasHistory = rnd() < 0.6;
    let priceTiers;
    if (hasHistory) {
      const oldQty = Math.max(0, Math.floor(onHand * (0.25 + rnd() * 0.45)));
      const newQty = Math.max(0, onHand - oldQty);
      // qtyPurchased mimics what was originally received — typically more than what's left.
      const oldPurchased = oldQty + intBetween(10, 60);
      const newPurchased = newQty + intBetween(5, 30);
      const priceChange = (rnd() < 0.7 ? 1 : -1) * +(rnd() * 0.22 + 0.05).toFixed(2); // ±5–27%
      const newCost = Math.max(1, Math.round(baseCost * (1 + priceChange)));
      priceTiers = [
        { priceSar: baseCost, qty: oldQty, qtyPurchased: oldPurchased, receivedOn: `2025-${String(intBetween(8, 12)).padStart(2, "0")}-${String(intBetween(1, 28)).padStart(2, "0")}`, note: "Previous price" },
        { priceSar: newCost, qty: newQty, qtyPurchased: newPurchased, receivedOn: `2026-${String(intBetween(2, 5)).padStart(2, "0")}-${String(intBetween(1, 28)).padStart(2, "0")}`, note: "Current price" },
      ];
    } else {
      priceTiers = [
        { priceSar: baseCost, qty: onHand, qtyPurchased: onHand + intBetween(10, 50), receivedOn: `2026-${String(intBetween(1, 5)).padStart(2, "0")}-${String(intBetween(1, 28)).padStart(2, "0")}`, note: "Current price" },
      ];
    }
    return {
      id: `PRT-${String(i + 1).padStart(4, "0")}`,
      sku: `SKU-${1000 + i}`,
      name: d[0], nameAr: d[1],
      category: d[2], unit: d[3],
      currentPriceSar: priceTiers[priceTiers.length - 1].priceSar,
      previousPriceSar: priceTiers.length > 1 ? priceTiers[0].priceSar : null,
      priceTiers,
      qtyOnHand: onHand,
      reorderLevel: d[6],
      reorderQty: d[6] * 2,
      warehouse: pick(["Riyadh", "Jeddah", "Dammam"]),
      supplier: pick(SUPPLIER_NAMES),
      leadTimeDays: intBetween(2, 21),
      lastReceived: priceTiers[priceTiers.length - 1].receivedOn,
    };
  });

  /** Weighted average cost based on active tiers (qty > 0). */
  function partAvgCost(p) {
    const active = p.priceTiers.filter(t => t.qty > 0);
    const totalQty = active.reduce((s, t) => s + t.qty, 0);
    if (totalQty === 0) return p.currentPriceSar;
    const totalVal = active.reduce((s, t) => s + t.qty * t.priceSar, 0);
    return totalVal / totalQty;
  }

  // ---- Predictive Alerts ----
  const PRED_TPL = [
    { component: "Brake Pads (Rear)", componentAr: "تيل الفرامل الخلفي", signal: "Wear pattern crossed 25% threshold; vibration RMS rising", signalAr: "نمط التآكل تجاوز 25%؛ اهتزاز متزايد", action: "Schedule rear brake replacement within 2 weeks", actionAr: "جدولة استبدال الفرامل الخلفية خلال أسبوعين" },
    { component: "Engine Cooling System", componentAr: "نظام تبريد المحرك", signal: "Coolant temp 9°C above baseline under load", signalAr: "حرارة سائل التبريد أعلى من المعدل بـ 9°م تحت الحمل", action: "Inspect radiator and water pump", actionAr: "فحص الرديتر وطلمبة الماء" },
    { component: "Front-Left Tire", componentAr: "الإطار الأمامي الأيسر", signal: "Pressure dropping 0.3 bar/24h — slow leak suspected", signalAr: "انخفاض الضغط 0.3 بار/24س — تسرب بطيء محتمل", action: "Replace or patch tire", actionAr: "استبدال الإطار أو إصلاحه" },
    { component: "Battery", componentAr: "البطارية", signal: "Cranking voltage trending down (11.8V)", signalAr: "جهد البدء ينخفض (11.8 فولت)", action: "Battery test & possible replacement", actionAr: "اختبار البطارية واستبدالها إن لزم" },
    { component: "Oil Pressure Sensor", componentAr: "حساس ضغط الزيت", signal: "Intermittent pressure dips during idle", signalAr: "انخفاضات متقطعة في الضغط أثناء التشغيل", action: "Diagnose oil pump and sensor", actionAr: "تشخيص طلمبة الزيت والحساس" },
    { component: "Tank Mounting Bolts", componentAr: "مسامير تثبيت الخزان", signal: "Vibration anomaly on rough roads", signalAr: "اهتزاز غير طبيعي على الطرق الوعرة", action: "Re-torque tank brackets", actionAr: "إعادة شد مسامير الخزان" },
    { component: "Alternator", componentAr: "الدينمو", signal: "Charging output 13.2V (low)", signalAr: "خرج الشحن 13.2 فولت (منخفض)", action: "Test alternator output, replace if <13.5V", actionAr: "فحص الدينمو واستبداله إن لزم" },
  ];

  const predictiveAlerts = trucks
    .filter(t => t.healthScore < 80)
    .slice(0, 14)
    .map((t, i) => {
      const tpl = PRED_TPL[i % PRED_TPL.length];
      const sev = t.healthScore < 50 ? "critical" : t.healthScore < 65 ? "warning" : "info";
      return {
        id: `PA-${String(i + 1).padStart(4, "0")}`,
        truckId: t.id,
        component: tpl.component, componentAr: tpl.componentAr,
        severity: sev,
        predictedFailureInDays: sev === "critical" ? intBetween(1, 7) : sev === "warning" ? intBetween(7, 21) : intBetween(21, 60),
        confidencePct: intBetween(72, 96),
        signal: tpl.signal, signalAr: tpl.signalAr,
        recommendedAction: tpl.action, recommendedActionAr: tpl.actionAr,
        createdAt: new Date(2026, 4, 11 - (i % 5)).toISOString(),
      };
    });

  // ---- Work orders ----
  const WO_TPL = [
    ["10,000 km Preventive Service", "صيانة دورية 10,000 كم", "preventive"],
    ["Brake System Overhaul", "صيانة نظام الفرامل", "corrective"],
    ["Cooling System Repair", "إصلاح نظام التبريد", "corrective"],
    ["Tire Rotation & Balance", "تدوير وتوازن الإطارات", "preventive"],
    ["Tank Pressure Test", "اختبار ضغط الخزان", "inspection"],
    ["Predictive: Battery Replacement", "تنبؤي: استبدال البطارية", "predictive"],
    ["Predictive: Brake Pad Replacement", "تنبؤي: استبدال تيل الفرامل", "predictive"],
    ["Annual MOT Inspection", "فحص فني سنوي", "inspection"],
  ];

  /** Mechanic notes / job tasks per WO template (parts consumed + work tasks). */
  const WO_PLAYBOOK = {
    "10,000 km Preventive Service": {
      tasks: [
        ["Change engine oil and oil filter", "تغيير زيت المحرك وفلتر الزيت"],
        ["Replace air & fuel filters", "استبدال فلتر الهواء والوقود"],
        ["Top up coolant and check belts", "إعادة تعبئة سائل التبريد وفحص السيور"],
        ["Inspect tires and rotate", "فحص الإطارات وتدويرها"],
      ],
      parts: [["PRT-0001", 14], ["PRT-0002", 1], ["PRT-0003", 1], ["PRT-0004", 1], ["PRT-0010", 4]],
    },
    "Brake System Overhaul": {
      tasks: [
        ["Replace front brake pad set", "استبدال طقم تيل الفرامل الأمامي"],
        ["Replace rear brake pad set", "استبدال طقم تيل الفرامل الخلفي"],
        ["Resurface brake discs", "تجليخ هوب الفرامل"],
        ["Bleed brake lines", "تنفيس خطوط الفرامل"],
      ],
      parts: [["PRT-0005", 1], ["PRT-0006", 1], ["PRT-0007", 2]],
    },
    "Cooling System Repair": {
      tasks: [
        ["Pressure-test cooling system", "اختبار ضغط نظام التبريد"],
        ["Replace water pump", "استبدال طلمبة الماء"],
        ["Flush coolant and refill", "غسيل وإعادة تعبئة سائل التبريد"],
        ["Replace serpentine belt", "استبدال سير المحرك"],
      ],
      parts: [["PRT-0017", 1], ["PRT-0010", 12], ["PRT-0018", 1]],
    },
    "Tire Rotation & Balance": {
      tasks: [
        ["Rotate tires (front ↔ rear)", "تدوير الإطارات (أمامي ↔ خلفي)"],
        ["Balance wheels", "ضبط توازن العجلات"],
        ["Inspect for sidewall damage", "فحص الجدران الجانبية"],
      ],
      parts: [["PRT-0020", 2]],
    },
    "Tank Pressure Test": {
      tasks: [
        ["Inspect tank inspection hatch seal", "فحص حلقة فتحة الخزان"],
        ["Pressure-test water tank", "اختبار ضغط خزان المياه"],
        ["Verify gasket integrity", "التحقق من سلامة الجوانات"],
      ],
      parts: [["PRT-0016", 1], ["PRT-0015", 1]],
    },
    "Predictive: Battery Replacement": {
      tasks: [
        ["Diagnose charging system", "تشخيص نظام الشحن"],
        ["Replace 12V 200Ah battery", "استبدال بطارية 12 فولت 200 أمبير"],
        ["Verify alternator output", "التحقق من خرج الدينمو"],
      ],
      parts: [["PRT-0012", 1]],
    },
    "Predictive: Brake Pad Replacement": {
      tasks: [
        ["Inspect brake pad wear", "فحص تآكل تيل الفرامل"],
        ["Replace rear brake pad set", "استبدال طقم تيل الفرامل الخلفي"],
        ["Road-test braking performance", "اختبار أداء الفرامل على الطريق"],
      ],
      parts: [["PRT-0006", 1]],
    },
    "Annual MOT Inspection": {
      tasks: [
        ["Full safety inspection", "فحص سلامة شامل"],
        ["Emissions test", "اختبار الانبعاثات"],
        ["Brake performance test", "اختبار أداء الفرامل"],
        ["Headlight alignment", "ضبط الأضواء الأمامية"],
      ],
      parts: [["PRT-0019", 1]],
    },
  };

  // Tiny 24×24 SVG data URLs used as photo placeholders for the demo. Real
  // production would store File→FormData uploads to S3 / GCS / etc.; here we
  // just keep the per-part `photos[]` array populated so the UI looks real.
  const PHOTO_SAMPLES = [
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23475569'/%3E%3Ccircle cx='120' cy='90' r='38' fill='%23334155'/%3E%3Ccircle cx='120' cy='90' r='20' fill='%2364748b'/%3E%3Ctext x='50%25' y='160' text-anchor='middle' fill='%23cbd5e1' font-size='12' font-family='sans-serif'%3EOld brake pad%3C/text%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='180'%3E%3Crect width='100%25' height='100%25' fill='%2392400e'/%3E%3Crect x='40' y='60' width='160' height='60' fill='%2378350f' rx='6'/%3E%3Ctext x='50%25' y='155' text-anchor='middle' fill='%23fde68a' font-size='12' font-family='sans-serif'%3EWorn filter%3C/text%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23064e3b'/%3E%3Ccircle cx='120' cy='90' r='50' fill='none' stroke='%23a7f3d0' stroke-width='6'/%3E%3Ctext x='50%25' y='160' text-anchor='middle' fill='%23a7f3d0' font-size='12' font-family='sans-serif'%3EUsed tire%3C/text%3E%3C/svg%3E",
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='180'%3E%3Crect width='100%25' height='100%25' fill='%237c2d12'/%3E%3Crect x='60' y='70' width='120' height='40' fill='%23431407' rx='4'/%3E%3Ctext x='50%25' y='155' text-anchor='middle' fill='%23fed7aa' font-size='12' font-family='sans-serif'%3EReplaced battery%3C/text%3E%3C/svg%3E",
  ];

  // We generate ~32 work orders so each trucks has a fair history. Status mix
  // covers historical (completed), in-progress, scheduled (open), AND delayed
  // (status≠completed AND dueBy<today). The maintenance UI derives the
  // "delayed" bucket dynamically — we just seed enough past-due open work.
  const TODAY_REF = new Date(2026, 4, 13); // matches MT.TODAY
  const workOrders = Array.from({ length: 32 }, (_, i) => {
    const truck = trucks[i % trucks.length];
    const tpl = WO_TPL[i % WO_TPL.length];
    const pool = ["completed", "completed", "completed", "in_progress", "awaiting_parts", "open", "open"];
    let status = pool[i % pool.length];
    const priority = tpl[2] === "predictive" ? "high" : i % 4 === 0 ? "critical" : i % 3 === 0 ? "medium" : "low";
    // Spread WOs across past 60 days and next 14 days so the calendar has events.
    const dayOffset = (i % 13) - 5;        // -5..+7
    const monthOffset = i < 16 ? 0 : -1;   // some last month
    const opened = new Date(2026, 4 + monthOffset, 13 + dayOffset);
    let due = new Date(opened.getTime() + (i % 5 + 1) * 86400000);

    // Force a handful of WOs to be DELAYED: open/awaiting_parts/in_progress
    // with dueBy in the past. Indexes chosen so each city/truck gets one.
    const DELAYED_IDX = new Set([2, 9, 15, 21, 27]);
    if (DELAYED_IDX.has(i)) {
      status = i % 2 === 0 ? "in_progress" : "open";
      due = new Date(TODAY_REF.getTime() - (intBetween(1, 6)) * 86400000);
    }

    const playbook = WO_PLAYBOOK[tpl[0]] || { tasks: [], parts: [] };
    const partsUsed = playbook.parts.map(([partId, qty], k) => {
      const part = parts.find(p => p.id === partId);
      // Snapshot unit price at consumption time. For completed/in_progress
      // jobs we capture the current price; for not-yet-started jobs we still
      // store an estimated unit price so the modal table has numbers.
      const unitPriceSar = part ? part.currentPriceSar : 0;
      // Seed photos on a subset of completed jobs (the "old part" gallery).
      const photos = (status === "completed" && (i + k) % 3 === 0)
        ? [{
            id: `PH-${i}-${k}-1`,
            name: `old_${partId}_${i}.svg`,
            dataUrl: PHOTO_SAMPLES[(i + k) % PHOTO_SAMPLES.length],
            uploadedAt: new Date(TODAY_REF.getTime() - intBetween(1, 25) * 86400000).toISOString(),
          }]
        : [];
      return { partId, qty: qty + (i % 2), unitPriceSar, photos };
    });
    const tasksDone = playbook.tasks.map(([en, ar], k) => ({
      en, ar,
      done: status === "completed" ? true : status === "in_progress" ? k < Math.ceil(playbook.tasks.length / 2) : false,
    }));
    const partsCost = partsUsed.reduce((s, pu) => s + pu.unitPriceSar * pu.qty, 0);
    const laborHours = +(2 + rnd() * 8).toFixed(1);
    const laborRate = 145;
    const estCost = Math.round(partsCost + laborHours * laborRate);
    return {
      id: `WO-${String(i + 1).padStart(4, "0")}`,
      truckId: truck.id,
      type: tpl[2], priority, status,
      title: tpl[0], titleAr: tpl[1],
      openedAt: opened.toISOString(),
      dueBy: due.toISOString(),
      closedAt: status === "completed" ? new Date(due.getTime() - 3600000).toISOString() : undefined,
      assignedMechanicId: ["PER-004", "PER-005", "PER-006", "PER-007"][i % 4],
      estimatedCostSar: estCost,
      actualCostSar: status === "completed" ? estCost + intBetween(-200, 500) : undefined,
      laborHours, laborRate,
      partsUsed,                  // [{ partId, qty, unitPriceSar, photos: [] }]
      tasks: tasksDone,           // [{ en, ar, done }]
      mechanicNotes: status === "completed" ? pick([
        "All listed tasks completed. Customer signed off.",
        "Replaced parts as planned, road-tested for 12 km.",
        "Found additional minor wear, replaced under warranty.",
        "",
      ]) : "",
      predictiveSignal: tpl[2] === "predictive" ? "IoT vibration + thermal anomaly" : undefined,
      odometerAtService: truck.odometerKm - intBetween(0, 1500),
    };
  });

  // ---- Repair description catalog (shared by in-house + out-sourced jobs) ----
  // User can add new descriptions live; new entries get pushed here in-session.
  const repairDescriptions = [
    { id: "RD-001", en: "Replace engine oil & filter",      ar: "تغيير زيت المحرك والفلتر" },
    { id: "RD-002", en: "Replace brake pads (front)",       ar: "استبدال تيل الفرامل الأمامي" },
    { id: "RD-003", en: "Replace brake pads (rear)",        ar: "استبدال تيل الفرامل الخلفي" },
    { id: "RD-004", en: "Top up / replace coolant",         ar: "إعادة تعبئة سائل التبريد" },
    { id: "RD-005", en: "Inspect & rotate tires",           ar: "فحص وتدوير الإطارات" },
    { id: "RD-006", en: "Replace fuel filter",              ar: "استبدال فلتر الوقود" },
    { id: "RD-007", en: "Diagnose engine fault code",       ar: "تشخيص أعطال المحرك" },
    { id: "RD-008", en: "Clean & inspect water tank",       ar: "تنظيف وفحص خزان المياه" },
    { id: "RD-009", en: "Re-torque tank mounting bolts",    ar: "إعادة شد مسامير تثبيت الخزان" },
    { id: "RD-010", en: "Replace air filter",               ar: "استبدال فلتر الهواء" },
    { id: "RD-011", en: "Test alternator output",           ar: "فحص خرج الدينمو" },
    { id: "RD-012", en: "Battery load test / replacement",  ar: "اختبار حِمل البطارية / استبدالها" },
    { id: "RD-013", en: "Lubricate chassis",                ar: "تشحيم الشاسيه" },
    { id: "RD-014", en: "Replace serpentine belt",          ar: "استبدال سير المحرك" },
  ];

  /** Apply consumption from completed + in-progress WOs to the parts tiers
   *  (FIFO — oldest tier first). Builds a usage log keyed by part id.
   *  Also overwrites pu.unitPriceSar with the *actual* weighted price the
   *  job paid (since FIFO can span 2 tiers when the older one runs out). */
  const partUsage = {}; // partId -> [{ woId, truckId, date, qty, costSar, unitPriceSar }]

  /** Deduct every `partsUsed` entry on a WO from its part's FIFO price tiers.
   *  Idempotent: sets `wo.inventoryDeductedAt` after the first successful pass
   *  so subsequent calls (e.g., when a mechanic toggles status) are no-ops.
   *  Returns the total cost consumed (0 if already deducted or no parts). */
  function consumePartsForWO(wo) {
    if (!wo || wo.inventoryDeductedAt) return 0;
    if (!wo.partsUsed || wo.partsUsed.length === 0) {
      wo.inventoryDeductedAt = new Date().toISOString();
      return 0;
    }
    let totalCost = 0;
    wo.partsUsed.forEach(pu => {
      const part = parts.find(p => p.id === pu.partId);
      if (!part) return;
      let remaining = pu.qty;
      let lineCost = 0;
      for (const tier of part.priceTiers) {
        if (remaining <= 0) break;
        const take = Math.min(tier.qty, remaining);
        tier.qty -= take;
        remaining -= take;
        lineCost += take * tier.priceSar;
      }
      part.qtyOnHand = Math.max(0, part.priceTiers.reduce((s, t) => s + t.qty, 0));
      const consumedQty = pu.qty - remaining;
      if (consumedQty > 0) pu.unitPriceSar = +(lineCost / consumedQty).toFixed(2);
      totalCost += lineCost;
      partUsage[part.id] = partUsage[part.id] || [];
      partUsage[part.id].push({
        woId: wo.id, truckId: wo.truckId, date: wo.openedAt || new Date().toISOString(),
        qty: consumedQty, costSar: lineCost,
        unitPriceSar: consumedQty > 0 ? +(lineCost / consumedQty).toFixed(2) : 0,
      });
    });
    wo.inventoryDeductedAt = new Date().toISOString();
    return totalCost;
  }

  // Seed-time pass — only completed + in-progress WOs draw from stock initially.
  workOrders.forEach(wo => {
    if (wo.status === "completed" || wo.status === "in_progress") {
      consumePartsForWO(wo);
    }
  });

  /** Driver commissions. The user wants commissions distributed by project
   *  served + trip count, with manual override for special trips. We seed a
   *  reasonable structure that the UI can edit live (state held in APP_STATE). */
  /** Each project carries its own water-transport workstream. Drivers are
   *  assigned to one or more projects; trips operate inside a project's
   *  Kanban board. Commission rate is per trip and is paid the moment a
   *  trip enters the Delivered column. */
  const PROJECTS = [
    { id: "PRJ-NEOM",    name: "NEOM Construction Camp",   nameAr: "مخيم نيوم للإنشاءات",
      ratePerTrip: 85,   customer: "NEOM Construction Camp",
      location: "NEOM, Tabuk Province", locationAr: "نيوم، منطقة تبوك",
      coords: { lat: 27.9300, lng: 35.0900 },
      description: "Round-the-clock potable water support for the NEOM Phase-1 worker housing.",
      descriptionAr: "دعم المياه الصالحة للشرب لمساكن العمال في المرحلة الأولى من نيوم.",
      active: true, createdAt: "2025-11-01",
      commissionMode: "scalable", scalableRatePct: 6 },
    { id: "PRJ-ARAMCO", name: "Aramco Operations", nameAr: "عمليات أرامكو",
      ratePerTrip: 70, customer: "Aramco Operations",
      location: "Dhahran, Eastern Province", locationAr: "الظهران، المنطقة الشرقية",
      coords: { lat: 26.2885, lng: 50.1500 },
      description: "Industrial and process-water deliveries to Aramco compound sites.",
      descriptionAr: "توصيل مياه صناعية لمواقع أرامكو.",
      active: true, createdAt: "2025-09-15",
      commissionMode: "fixed", scalableRatePct: 0 },
    { id: "PRJ-DIRIYAH", name: "Diriyah Gate Project", nameAr: "مشروع بوابة الدرعية",
      ratePerTrip: 65, customer: "Diriyah Gate Project",
      location: "Diriyah, Riyadh", locationAr: "الدرعية، الرياض",
      coords: { lat: 24.7370, lng: 46.5750 },
      description: "Construction water for the Diriyah heritage restoration zone.",
      descriptionAr: "مياه إنشاءات لمنطقة ترميم تراث الدرعية.",
      active: true, createdAt: "2026-01-12",
      commissionMode: "fixed", scalableRatePct: 0 },
    { id: "PRJ-REDSEA", name: "Red Sea Project Site", nameAr: "موقع مشروع البحر الأحمر",
      ratePerTrip: 90, customer: "Red Sea Project Site",
      location: "Umluj, Tabuk Province", locationAr: "أملج، منطقة تبوك",
      coords: { lat: 25.0260, lng: 37.2640 },
      description: "Premium rate — long-haul potable + irrigation deliveries to the Red Sea coastal resorts.",
      descriptionAr: "تعريفة مميزة — توصيل مياه الشرب والري للمنتجعات الساحلية بالبحر الأحمر.",
      active: true, createdAt: "2025-12-03",
      commissionMode: "scalable", scalableRatePct: 8 },
    { id: "PRJ-KAEC", name: "KAEC Residential", nameAr: "مدينة الملك عبدالله الاقتصادية",
      ratePerTrip: 60, customer: "KAEC Residential",
      location: "KAEC, Western Region", locationAr: "مدينة الملك عبدالله الاقتصادية",
      coords: { lat: 22.4500, lng: 39.1500 },
      description: "Residential potable water — daily routes through the KAEC compound.",
      descriptionAr: "مياه شرب للمناطق السكنية — مسارات يومية داخل المدينة الاقتصادية.",
      active: true, createdAt: "2025-08-20",
      commissionMode: "fixed", scalableRatePct: 0 },
    { id: "PRJ-RIYADH", name: "Riyadh Municipality", nameAr: "أمانة الرياض",
      ratePerTrip: 50, customer: "Riyadh Municipality",
      location: "Riyadh metropolitan area", locationAr: "أمانة الرياض",
      coords: { lat: 24.7136, lng: 46.6753 },
      description: "Municipal contract — emergency top-ups + park irrigation tanker runs.",
      descriptionAr: "عقد بلدي — تعبئة طارئة وري حدائق.",
      active: true, createdAt: "2025-06-10",
      commissionMode: "fixed", scalableRatePct: 0 },
    { id: "PRJ-JEDDAH", name: "Jeddah Industrial Area", nameAr: "المنطقة الصناعية - جدة",
      ratePerTrip: 55, customer: "Jeddah Industrial Area",
      location: "Jeddah, Western Region", locationAr: "جدة",
      coords: { lat: 21.4858, lng: 39.1925 },
      description: "Process water for the Jeddah Industrial Cities (1st + 2nd phases).",
      descriptionAr: "مياه عمليات للمدن الصناعية بجدة (المرحلة الأولى والثانية).",
      active: true, createdAt: "2025-07-22",
      commissionMode: "fixed", scalableRatePct: 0 },
    { id: "PRJ-YANBU", name: "Yanbu Industrial Hub", nameAr: "مركز ينبع الصناعي",
      ratePerTrip: 60, customer: "Yanbu Industrial Hub",
      location: "Yanbu, Western Region", locationAr: "ينبع",
      coords: { lat: 24.0890, lng: 38.0610 },
      description: "Industrial water for the Yanbu petrochemical corridor.",
      descriptionAr: "مياه صناعية لمحور البتروكيماويات بينبع.",
      active: true, createdAt: "2025-10-18",
      commissionMode: "fixed", scalableRatePct: 0 },
    { id: "PRJ-ALULA", name: "AlUla Heritage Site", nameAr: "موقع العلا التراثي",
      ratePerTrip: 75, customer: "AlUla Heritage Site",
      location: "AlUla, Madinah region", locationAr: "العلا",
      coords: { lat: 26.6082, lng: 37.9220 },
      description: "Heritage-site potable + dust-suppression water for the AlUla restoration.",
      descriptionAr: "مياه شرب وإخماد غبار لمشروع ترميم العلا.",
      active: true, createdAt: "2026-02-04",
      commissionMode: "scalable", scalableRatePct: 5 },
    { id: "PRJ-QIDDIYA", name: "Qiddiya Construction", nameAr: "إنشاءات القدية",
      ratePerTrip: 65, customer: "Qiddiya Construction",
      location: "Qiddiya, Riyadh region", locationAr: "القدية، الرياض",
      coords: { lat: 24.5750, lng: 46.1750 },
      description: "Construction-grade water for the Qiddiya entertainment city build-out.",
      descriptionAr: "مياه إنشائية لمشروع مدينة القدية الترفيهية.",
      active: true, createdAt: "2026-03-08",
      commissionMode: "fixed", scalableRatePct: 0 },
  ];
  const PROJECT_BY_CUSTOMER = {
    "NEOM Construction Camp": "PRJ-NEOM",
    "Aramco Operations": "PRJ-ARAMCO",
    "Riyadh Municipality": "PRJ-RIYADH",
    "Jeddah Industrial Area": "PRJ-JEDDAH",
    "KAEC Residential": "PRJ-KAEC",
    "Diriyah Gate Project": "PRJ-DIRIYAH",
    "Red Sea Project Site": "PRJ-REDSEA",
    "Yanbu Industrial Hub": "PRJ-YANBU",
    "AlUla Heritage Site": "PRJ-ALULA",
    "Qiddiya Construction": "PRJ-QIDDIYA",
  };

  // Back-fill each trip's projectId from the customer mapping.
  trips.forEach(t => { t.projectId = PROJECT_BY_CUSTOMER[t.customer] || null; });

  // Build each project's assignedDriverIds from drivers who actually ran trips
  // there. This makes the Kanban driver tables non-empty out of the gate.
  PROJECTS.forEach(p => {
    const driverIds = new Set();
    trips.forEach(t => { if (t.projectId === p.id && t.driverId) driverIds.add(t.driverId); });
    // Always seat at least 2 drivers per project so the driver table has rows
    // even on a brand-new project. Fall back to the first N drivers if needed.
    if (driverIds.size < 2) {
      drivers.slice(0, 4).forEach(d => driverIds.add(d.id));
    }
    p.assignedDriverIds = Array.from(driverIds).slice(0, 8);
  });
  // Seed three months of commissions (Mar, Apr, May 2026) so the user can
  // switch months in the UI. May is the editable current month; Apr is mostly
  // paid; Mar is fully paid. Each row keyed by driverId+monthKey.
  const COMMISSION_MONTHS = [
    { key: "2026-03", labelEn: "March 2026", labelAr: "مارس 2026",  defaultPayout: ["paid", "paid", "paid"] },
    { key: "2026-04", labelEn: "April 2026", labelAr: "أبريل 2026", defaultPayout: ["paid", "approved", "paid"] },
    { key: "2026-05", labelEn: "May 2026",   labelAr: "مايو 2026",  defaultPayout: ["paid", "paid", "approved"] },
    { key: "2026-06", labelEn: "June 2026",  labelAr: "يونيو 2026", defaultPayout: ["pending", "approved", "paid"] },
  ];

  function buildLinesFor(driver, monthFactor) {
    // Reuse the seeded trips as the May baseline; for earlier months scale
    // the trip counts up/down a little so historical data looks plausible.
    const driverTrips = trips.filter(t => t.driverId === driver.id && t.status === "delivered");
    const byProject = {};
    driverTrips.forEach(t => {
      const pid = PROJECT_BY_CUSTOMER[t.customer];
      if (!pid) return;
      byProject[pid] = (byProject[pid] || 0) + 1;
    });
    return Object.entries(byProject).map(([pid, count]) => {
      const project = PROJECTS.find(p => p.id === pid);
      const scaled = Math.max(1, Math.round(count * monthFactor));
      return {
        id: `CL-${driver.id}-${pid}-${monthFactor}`,
        projectId: pid,
        tripsCount: scaled,
        ratePerTrip: project.ratePerTrip,
        amountSar: scaled * project.ratePerTrip,
        manual: false,
      };
    });
  }

  const SPECIAL_TEMPLATES_EN = ["Emergency desert delivery", "Weekend Hajj support", "After-hours NEOM run", "Storm-route bonus", "VIP customer handover"];
  const SPECIAL_TEMPLATES_AR = ["توصيل طارئ للصحراء", "دعم الحج في عطلة الأسبوع", "رحلة نيوم خارج الدوام", "علاوة طريق العاصفة", "تسليم لعميل VIP"];

  const commissions = [];
  COMMISSION_MONTHS.forEach((m, mi) => {
    // June is the live month — fewer trips banked so far. May is a peak month.
    const monthFactor = mi === 0 ? 0.85 : mi === 1 ? 0.95 : mi === 2 ? 1.0 : 0.35;
    drivers.forEach((d, di) => {
      const lines = buildLinesFor(d, monthFactor);
      const wantSpecial = rnd() < (mi === 2 ? 0.28 : 0.18);
      const specials = wantSpecial ? [{
        id: `CS-${m.key}-${d.id}-1`,
        label: SPECIAL_TEMPLATES_EN[(di + mi) % SPECIAL_TEMPLATES_EN.length],
        labelAr: SPECIAL_TEMPLATES_AR[(di + mi) % SPECIAL_TEMPLATES_AR.length],
        amountSar: intBetween(150, 800),
        date: `${m.key}-${String(intBetween(1, 26)).padStart(2, "0")}`,
        manual: true,
        note: "Manually approved by fleet manager",
        isSpecialTrip: true,
      }] : [];
      commissions.push({
        driverId: d.id,
        monthKey: m.key,
        monthLabel: m.labelEn,
        monthLabelAr: m.labelAr,
        lines,
        specials,
        adjustments: [],
        bonusSar: 0,
        payoutStatus: m.defaultPayout[di % m.defaultPayout.length],
      });
    });
  });
  const CURRENT_MONTH_KEY = "2026-06";
  // ----------------------------------------------------------------------
  // ARCHIVE — per-project documents organized into named, sortable groups.
  // Each document carries a `type` and an `aiExtracted` field map that the
  // simulated AI scanner pre-fills based on filename pattern matching.
  // ----------------------------------------------------------------------

  // Standard group templates that every project gets seeded with.
  const GROUP_TEMPLATES = [
    { name: "Contracts & Agreements", nameAr: "العقود والاتفاقيات", types: ["contract"] },
    { name: "Invoices & Receipts",   nameAr: "الفواتير والإيصالات", types: ["invoice", "po", "quote"] },
    { name: "Permits & Licenses",    nameAr: "التصاريح والرخص",      types: ["permit", "license", "registration", "insurance"] },
    { name: "Inspection Reports",    nameAr: "تقارير الفحص",          types: ["inspection"] },
    { name: "Correspondence",        nameAr: "المراسلات",              types: ["letter", "delivery", "other"] },
  ];

  // Attach groups (deep-cloned, with stable ids) to every project.
  let groupSeed = 0;
  PROJECTS.forEach((p, i) => {
    // 3–4 groups per project, varying selection
    const numGroups = 3 + (i % 2);
    p.groups = GROUP_TEMPLATES.slice(0, numGroups).map((g, gi) => ({
      id: `GRP-${p.id}-${++groupSeed}`,
      name: g.name,
      nameAr: g.nameAr,
      order: gi,
      types: g.types,
    }));
  });

  /** AI scanner — sample documents the demo can detect and auto-fill. Each
   *  sample maps a filename pattern (substring, case-insensitive) to a doc
   *  type and a factory that builds the extracted fields, given context. */
  const AI_SAMPLES = [
    {
      filename: "Vehicle_Insurance_TRK-003.pdf",
      type: "insurance",
      iconBg: "rgba(11,126,234,.12)", iconColor: "#0c66bf",
    },
    {
      filename: "Service_Invoice_Juffali_2026-04.pdf",
      type: "invoice",
      iconBg: "rgba(245,158,11,.12)", iconColor: "#b45309",
    },
    {
      filename: "Annual_MOT_Inspection_TRK-007.pdf",
      type: "inspection",
      iconBg: "rgba(16,185,129,.12)", iconColor: "#047857",
    },
    {
      filename: "NEOM_Water_Supply_Contract_2026.docx",
      type: "contract",
      iconBg: "rgba(139,92,246,.12)", iconColor: "#7c3aed",
    },
    {
      filename: "Driver_License_DRV-005.pdf",
      type: "license",
      iconBg: "rgba(11,126,234,.12)", iconColor: "#0c66bf",
    },
    {
      filename: "Bulk_Water_Transport_Permit_RYD-2026.pdf",
      type: "permit",
      iconBg: "rgba(16,185,129,.12)", iconColor: "#047857",
    },
    {
      filename: "Delivery_Note_Aramco_5421.pdf",
      type: "delivery",
      iconBg: "rgba(11,126,234,.12)", iconColor: "#0c66bf",
    },
    {
      filename: "Quotation_AlFuttaim_Tires_2026.pdf",
      type: "quote",
      iconBg: "rgba(245,158,11,.12)", iconColor: "#b45309",
    },
    {
      filename: "PO-2026-0042_Engine_Oil.pdf",
      type: "po",
      iconBg: "rgba(245,158,11,.12)", iconColor: "#b45309",
    },
    {
      filename: "Vehicle_Registration_TRK-014.pdf",
      type: "registration",
      iconBg: "rgba(16,185,129,.12)", iconColor: "#047857",
    },
    {
      filename: "Commercial_Registration_AquaFleet_1010234567.pdf",
      type: "commercial_registration",
      iconBg: "rgba(139,92,246,.12)", iconColor: "#7c3aed",
    },
    {
      filename: "National_Address_HQ_Riyadh.pdf",
      type: "national_address",
      iconBg: "rgba(16,185,129,.12)", iconColor: "#047857",
    },
  ];

  /** Heuristic: detect a document type from a filename. Returns "other" if unknown. */
  function detectDocType(filename) {
    const f = String(filename || "").toLowerCase();
    if (/(commercial[_\- ]?registration|cr[_\- ]\d|سجل[_\- ]?تجاري)/.test(f)) return "commercial_registration";
    if (/(national[_\- ]?address|عنوان[_\- ]?وطني)/.test(f)) return "national_address";
    if (/(insurance|policy|بوليصة|تأمين)/.test(f)) return "insurance";
    if (/(invoice|فاتورة)/.test(f)) return "invoice";
    if (/(inspection|mot|فحص)/.test(f)) return "inspection";
    if (/(contract|agreement|عقد|اتفاقية)/.test(f)) return "contract";
    if (/(license|licence|رخصة)/.test(f)) return "license";
    if (/(permit|تصريح)/.test(f)) return "permit";
    if (/(delivery|bol|إشعار|تسليم)/.test(f)) return "delivery";
    if (/(quote|quotation|عرض)/.test(f)) return "quote";
    if (/(^|[_\- ])po[_\- ]|purchase[_\- ]?order|أمر شراء/.test(f)) return "po";
    if (/(registration|استمارة)/.test(f)) return "registration";
    if (/(letter|خطاب)/.test(f)) return "letter";
    return "other";
  }

  /** Try to extract truck/driver/project hints from a filename. */
  function detectRefs(filename) {
    const f = String(filename || "");
    const truck = (f.match(/TRK-\d{3}/i) || [])[0];
    const driver = (f.match(/DRV-\d{3}/i) || [])[0];
    return {
      truck: truck ? truck.toUpperCase() : null,
      driver: driver ? driver.toUpperCase() : null,
    };
  }

  /** Build a plausible extracted-fields object for a given doc type. */
  function aiExtract(type, ctx) {
    const truck = ctx.truck ? trucks.find(t => t.id === ctx.truck) || trucks[intBetween(0, trucks.length - 1)] : trucks[intBetween(0, trucks.length - 1)];
    const driver = ctx.driver ? drivers.find(d => d.id === ctx.driver) || drivers[intBetween(0, drivers.length - 1)] : drivers[intBetween(0, drivers.length - 1)];
    const today = new Date(2026, 4, 14);
    const fmtDate = (d) => d.toISOString().slice(0, 10);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

    // Custom user-defined types: build an empty (or sample) record from the
    // type's declared field list so manual entry / AI fallback has the right shape.
    const custom = archiveCustomTypes.find(t => t.id === type);
    if (custom) {
      const out = {};
      custom.fields.forEach(f => {
        // Provide a sample value for common keys so the UI demo isn't empty.
        if (/date|expir/i.test(f.key)) {
          out[f.key] = /expir/i.test(f.key)
            ? fmtDate(addDays(today, intBetween(60, 720)))
            : fmtDate(addDays(today, -intBetween(0, 180)));
        } else if (f.key === "entity") out[f.key] = "AquaFleet KSA Co.";
        else if (f.key === "authority") out[f.key] = "Ministry of Commerce — Saudi Arabia";
        else if (f.key === "certificateNumber") out[f.key] = `CERT-${intBetween(100000, 999999)}`;
        else if (f.key === "notes") out[f.key] = "";
        else out[f.key] = "";
      });
      return out;
    }

    switch (type) {
      case "invoice":
        return {
          vendor: pick(SUPPLIER_NAMES),
          docNumber: `INV-2026-${intBetween(1000, 9999)}`,
          issueDate: fmtDate(addDays(today, -intBetween(5, 60))),
          dueDate: fmtDate(addDays(today, intBetween(5, 45))),
          amount: intBetween(2500, 28000),
          currency: "SAR",
          paymentTerms: "Net 30",
          notes: "Auto-detected line items: 6",
        };
      case "contract":
        return {
          party1: "AquaFleet KSA",
          party2: pick(["NEOM Co.", "Saudi Aramco", "Riyadh Municipality", "Red Sea Global", "Diriyah Gate Development Authority"]),
          docNumber: `CTR-${intBetween(1000, 9999)}`,
          effectiveDate: fmtDate(addDays(today, -intBetween(30, 365))),
          expiryDate: fmtDate(addDays(today, intBetween(60, 720))),
          amount: intBetween(80000, 1200000),
          currency: "SAR",
          notes: "Bulk potable water transport agreement",
        };
      case "permit":
        return {
          authority: pick(["Ministry of Transport", "Riyadh Municipality", "TGA — Transport General Authority", "MEWA — Environment, Water & Agriculture"]),
          docType: "Bulk Water Transport Permit",
          docNumber: `PRM-${intBetween(10000, 99999)}`,
          issueDate: fmtDate(addDays(today, -intBetween(20, 300))),
          expiryDate: fmtDate(addDays(today, intBetween(15, 540))),
          plate: truck.plate,
          notes: "Class 3 — Hazardous & Potable",
        };
      case "inspection":
        return {
          truck: truck.id,
          plate: truck.plate,
          inspector: pick(["MVPI Center", "Saudi MOT Lab", "Fahss Authorized Center"]),
          issueDate: fmtDate(addDays(today, -intBetween(1, 90))),
          nextDue: fmtDate(addDays(today, intBetween(60, 360))),
          result: rnd() < 0.85 ? "Pass" : "Fail (minor)",
          notes: "Brakes, lights, emissions, tires inspected",
        };
      case "license":
        return {
          holder: driver.name,
          docNumber: driver.iqama,
          licenseClass: "Class 3 — Heavy Vehicle",
          issueDate: fmtDate(addDays(today, -intBetween(180, 1500))),
          expiryDate: driver.licenseExpiry,
          authority: "Saudi General Department of Traffic",
          notes: "",
        };
      case "commercial_registration":
        return {
          entity: pick(["AquaFleet KSA Co.", "AquaFleet Water Transport LLC", "AquaFleet Logistics Co."]),
          docNumber: `${1010 + intBetween(100000, 999999)}`,
          activity: pick(["Bulk water transport", "Heavy vehicle logistics", "Water tanker operations"]),
          issueDate: fmtDate(addDays(today, -intBetween(180, 1800))),
          expiryDate: fmtDate(addDays(today, intBetween(60, 720))),
          authority: "Ministry of Commerce — Saudi Arabia",
          capitalSar: intBetween(500000, 5000000),
        };
      case "national_address":
        return {
          holder: pick(["AquaFleet KSA Co.", "AquaFleet Water Transport LLC"]),
          shortAddress: `${pick(["RHRA","HAJD","KKRA","DKHD"])}${intBetween(1000,9999)}`,
          building: String(intBetween(2000, 9999)),
          street: pick(["King Fahd Road", "Olaya Street", "Prince Mohammed Road", "Northern Ring Road"]),
          district: pick(["Al Olaya", "Al Malqa", "Al Sahafa", "Al Yarmouk", "Al Murabba"]),
          city: pick(["Riyadh", "Jeddah", "Dammam", "Madinah"]),
          postalCode: String(intBetween(10000, 99999)),
          additionalNumber: String(intBetween(1000, 9999)),
          authority: "Saudi Post — SPL",
          issueDate: fmtDate(addDays(today, -intBetween(30, 720))),
        };
      case "insurance":
        return {
          vendor: pick(["Tawuniya", "Bupa Arabia", "Al Rajhi Takaful", "Solidarity Saudi", "SAICO"]),
          policyNumber: `POL-${intBetween(100000, 999999)}`,
          truck: truck.id,
          plate: truck.plate,
          vin: truck.vin,
          coverage: pick(["Comprehensive", "Third-party + theft", "Comprehensive + GCC"]),
          sumInsured: intBetween(180000, 320000),
          premium: intBetween(7500, 22000),
          currency: "SAR",
          issueDate: fmtDate(addDays(today, -intBetween(30, 280))),
          expiryDate: fmtDate(addDays(today, intBetween(10, 360))),
        };
      case "registration":
        return {
          plate: truck.plate,
          vin: truck.vin,
          holder: "AquaFleet KSA Co.",
          authority: "Saudi General Department of Traffic",
          issueDate: fmtDate(addDays(today, -intBetween(60, 720))),
          expiryDate: fmtDate(addDays(today, intBetween(30, 720))),
          notes: `${truck.model} · ${truck.year}`,
        };
      case "delivery":
        return {
          shipper: "AquaFleet KSA",
          consignee: pick(["NEOM Construction Camp", "Aramco Operations", "KAEC Residential", "Diriyah Gate"]),
          docNumber: `DN-2026-${intBetween(1000, 9999)}`,
          issueDate: fmtDate(addDays(today, -intBetween(0, 30))),
          truck: truck.id,
          driver: driver.name,
          items: "Potable water — 1 lot",
          weight: intBetween(8000, 22000) + " L",
          notes: "Signed by site supervisor",
        };
      case "quote":
        return {
          vendor: pick(SUPPLIER_NAMES),
          docNumber: `QT-${intBetween(1000, 9999)}`,
          issueDate: fmtDate(addDays(today, -intBetween(1, 30))),
          validity: 30,
          amount: intBetween(5500, 95000),
          currency: "SAR",
          items: pick(["Tires 12R22.5 (set of 6)", "Engine overhaul kit", "Brake pad sets (10)", "Hydraulic pump rebuild"]),
        };
      case "po":
        return {
          vendor: pick(SUPPLIER_NAMES),
          docNumber: `PO-2026-${intBetween(1000, 9999)}`,
          issueDate: fmtDate(addDays(today, -intBetween(1, 60))),
          amount: intBetween(2500, 60000),
          currency: "SAR",
          paymentTerms: "Net 45",
          items: pick(["Engine oil 15W-40 — 540 L", "Air filters (24)", "Battery 12V 200Ah (8)", "Coolant concentrate — 380 L"]),
        };
      case "letter":
        return {
          from: pick(["Ministry of Transport", "Aramco Logistics", "Riyadh Municipality"]),
          to: "AquaFleet KSA — Operations",
          subject: pick(["Route Permit Renewal Reminder", "Compliance Notice", "Service Performance Feedback", "Tariff Change Notification"]),
          issueDate: fmtDate(addDays(today, -intBetween(1, 30))),
          notes: "Response required: yes",
        };
      default:
        return {
          docNumber: `DOC-${intBetween(1000, 9999)}`,
          issueDate: fmtDate(today),
          notes: "Generic document — please complete metadata manually.",
        };
    }
  }

  /** Build a seed list of documents distributed across projects/groups. */
  let docSeed = 0;
  const documents = [];
  PROJECTS.forEach((p, pi) => {
    // 6–9 documents per project
    const n = 6 + (pi % 4);
    for (let i = 0; i < n; i++) {
      const sample = AI_SAMPLES[(pi * 3 + i) % AI_SAMPLES.length];
      const type = sample.type;
      // Match a group by allowed types; fall back to first group.
      const group = p.groups.find(g => g.types.includes(type)) || p.groups[0];
      const ctx = detectRefs(sample.filename);
      const extracted = aiExtract(type, ctx);
      const uploaded = new Date(2026, 4, 14 - intBetween(0, 35), intBetween(8, 18), intBetween(0, 59));
      documents.push({
        id: `DOC-${String(++docSeed).padStart(5, "0")}`,
        filename: sample.filename.replace(/(\.\w+)$/, `_${p.id.split('-')[1]}-${i + 1}$1`),
        type,
        projectId: p.id,
        groupId: group.id,
        sizeKb: intBetween(120, 4800),
        uploadedOn: uploaded.toISOString(),
        scannedByAI: true,
        aiConfidence: intBetween(78, 97),
        extracted,
        notes: "",
      });
    }
  });

  /** Document helpers — feed the new Archive UI.
   *
   *  - docPrimaryHeading: the human-friendly title for a doc card
   *    (e.g. "License — Mohammed Al-Qahtani" instead of the raw filename).
   *  - docExpiryStatus:  "expired" | "expiring_soon" | "valid" | "n_a"
   *    based on extracted.expiryDate against TODAY_REF.
   *  - docDaysUntilExpiry: signed integer (negative = past expiry).
   *  - docSummaryFields: ordered [{ key, value }] list of the 3–4
   *    fields that should appear on the card face for that doc type.
   *  - docDetailFields:  the full ordered field list for the doc-detail
   *    modal (everything in extracted, in a sensible order).
   *  - docIssuer:        a short string identifying who issued the doc
   *    (e.g. "Saudi General Department of Traffic"), used for the
   *    "Group by Issuer" view. Falls back to a sensible per-type label.
   *  - docExpiryStatusList / docPrimaryHeadingList: convenience wrappers
   *    so the UI can iterate without writing the same lookup each time. */
  const DOC_TODAY = new Date(2026, 5, 7);
  const _typeIssuer = {
    license: "Saudi General Department of Traffic",
    registration: "Saudi General Department of Traffic",
    insurance: "Saudi Central Bank (regulated insurer)",
    commercial_registration: "Ministry of Commerce — Saudi Arabia",
    national_address: "Saudi Post — SPL",
    permit: "Ministry of Transport — TGA",
    inspection: "MVPI Authorized Center",
    contract: "AquaFleet KSA — Legal",
    delivery: "Operations",
    quote: "Procurement",
    po: "Procurement",
    invoice: "Finance",
    letter: "Correspondence",
    other: "Various",
  };
  function docPrimaryHeading(doc) {
    if (!doc || !doc.extracted) return doc?.filename || "—";
    // Custom types: heading = first non-empty extracted value or the type label.
    const ct = archiveCustomTypes.find(t => t.id === doc.type);
    if (ct) {
      const e = doc.extracted;
      const primaryKeys = ["certificateNumber","docNumber","entity","holder","subject"];
      for (const k of primaryKeys) if (e[k]) return `${ct.label} — ${e[k]}`;
      for (const f of ct.fields) if (e[f.key]) return `${ct.label} — ${e[f.key]}`;
      return ct.label;
    }
    const e = doc.extracted;
    switch (doc.type) {
      case "license": return e.holder ? `License — ${e.holder}` : "Driver License";
      case "registration": return e.plate ? `Vehicle Reg — ${e.plate}` : "Vehicle Registration";
      case "insurance": return e.plate ? `Insurance — ${e.plate}` : (e.policyNumber || "Insurance");
      case "commercial_registration": return e.entity ? `CR — ${e.entity}` : `CR ${e.docNumber || ""}`;
      case "national_address": return e.holder ? `Address — ${e.holder}` : "National Address";
      case "permit": return e.docNumber ? `Permit ${e.docNumber}` : "Permit";
      case "inspection": return e.truck ? `Inspection — ${e.truck}` : "Inspection";
      case "contract": return e.party2 ? `Contract — ${e.party2}` : "Contract";
      case "delivery": return e.docNumber ? `Delivery ${e.docNumber}` : "Delivery";
      case "quote": return e.vendor ? `Quote — ${e.vendor}` : "Quote";
      case "po": return e.docNumber || "Purchase Order";
      case "invoice": return e.vendor ? `Invoice — ${e.vendor}` : (e.docNumber || "Invoice");
      case "letter": return e.subject || "Letter";
      default: return e.docNumber || doc.filename;
    }
  }
  function docExpiryStatus(doc) {
    const exp = doc?.extracted?.expiryDate;
    if (!exp) return "n_a";
    const d = new Date(exp);
    const diffDays = Math.round((d - DOC_TODAY) / 86400000);
    if (diffDays < 0) return "expired";
    if (diffDays <= 60) return "expiring_soon";
    return "valid";
  }
  function docDaysUntilExpiry(doc) {
    const exp = doc?.extracted?.expiryDate;
    if (!exp) return null;
    const d = new Date(exp);
    return Math.round((d - DOC_TODAY) / 86400000);
  }
  function docIssuer(doc) {
    if (!doc) return "Various";
    if (doc.extracted?.authority) return doc.extracted.authority;
    if (_typeIssuer[doc.type]) return _typeIssuer[doc.type];
    // Custom types fall back to a sensible default.
    const ct = archiveCustomTypes.find(t => t.id === doc.type);
    if (ct) return ct.label;
    return "Various";
  }

  // The 3–4 most-important fields per type for the card face.
  function docSummaryFields(doc) {
    if (!doc || !doc.extracted) return [];
    const e = doc.extracted;
    const pickFields = (arr) => arr.filter(([, v]) => v != null && v !== "");
    // Custom types: take the first 4 declared fields that have a value.
    const ct = archiveCustomTypes.find(t => t.id === doc.type);
    if (ct) {
      return pickFields(ct.fields.slice(0, 4).map(f => [f.key, e[f.key]]));
    }
    switch (doc.type) {
      case "license":
        return pickFields([["docNumber", e.docNumber], ["licenseClass", e.licenseClass], ["authority", e.authority], ["expiryDate", e.expiryDate]]);
      case "registration":
        return pickFields([["plate", e.plate], ["vin", e.vin], ["holder", e.holder], ["expiryDate", e.expiryDate]]);
      case "insurance":
        return pickFields([["policyNumber", e.policyNumber], ["vendor", e.vendor], ["coverage", e.coverage], ["expiryDate", e.expiryDate]]);
      case "commercial_registration":
        return pickFields([["docNumber", e.docNumber], ["entity", e.entity], ["activity", e.activity], ["expiryDate", e.expiryDate]]);
      case "national_address":
        return pickFields([["shortAddress", e.shortAddress], ["building", e.building], ["district", e.district], ["postalCode", e.postalCode]]);
      case "permit":
        return pickFields([["docNumber", e.docNumber], ["scope", e.scope], ["authority", e.authority], ["expiryDate", e.expiryDate]]);
      case "inspection":
        return pickFields([["truck", e.truck], ["result", e.result], ["issueDate", e.issueDate], ["nextDue", e.nextDue]]);
      case "contract":
        return pickFields([["party2", e.party2], ["docNumber", e.docNumber], ["amount", e.amount], ["expiryDate", e.expiryDate]]);
      case "delivery":
        return pickFields([["docNumber", e.docNumber], ["consignee", e.consignee], ["truck", e.truck], ["issueDate", e.issueDate]]);
      case "quote":
        return pickFields([["vendor", e.vendor], ["docNumber", e.docNumber], ["amount", e.amount], ["validity", e.validity && `${e.validity} d`]]);
      case "po":
        return pickFields([["vendor", e.vendor], ["docNumber", e.docNumber], ["amount", e.amount], ["paymentTerms", e.paymentTerms]]);
      case "invoice":
        return pickFields([["vendor", e.vendor], ["docNumber", e.docNumber], ["amount", e.amount], ["dueDate", e.dueDate]]);
      case "letter":
        return pickFields([["from", e.from], ["to", e.to], ["subject", e.subject], ["issueDate", e.issueDate]]);
      default:
        return pickFields([["docNumber", e.docNumber], ["issueDate", e.issueDate]]);
    }
  }

  // Every extracted key, for the doc-detail modal.
  function docDetailFields(doc) {
    if (!doc || !doc.extracted) return [];
    const e = doc.extracted;
    // Preserve a sensible order across types; fall back to Object.keys.
    const preferred = ["entity","holder","docNumber","policyNumber","plate","vin","truck","driver","licenseClass","activity","coverage","party1","party2","from","to","subject","shipper","consignee","vendor","items","weight","amount","currency","paymentTerms","sumInsured","premium","capitalSar","shortAddress","building","street","district","city","postalCode","additionalNumber","authority","issueDate","effectiveDate","dueDate","expiryDate","nextDue","validity","result","notes"];
    const ordered = preferred.filter(k => e[k] != null && e[k] !== "").map(k => ({ key: k, value: e[k] }));
    // Append anything not in the preferred order.
    Object.keys(e).forEach(k => { if (!preferred.includes(k) && e[k] != null && e[k] !== "") ordered.push({ key: k, value: e[k] }); });
    return ordered;
  }

  /** Custom Archive groups — user-defined folders that cut across document
   *  types (e.g. "Compliance binder 2026"). Seeded with a few examples;
   *  the UI can add/remove more. Each doc carries a `customGroupId` (null
   *  = ungrouped). The "Group by: Custom group" mode buckets docs by this
   *  field. */
  const archiveCustomGroups = [
    { id: "AGRP-001", name: "Compliance binder 2026", nameAr: "ملف الالتزام 2026", color: "#0b7eea", createdAt: "2026-01-15" },
    { id: "AGRP-002", name: "Vendor agreements",      nameAr: "اتفاقيات الموردين",  color: "#f59e0b", createdAt: "2026-02-08" },
    { id: "AGRP-003", name: "NEOM project archive",   nameAr: "أرشيف مشروع نيوم",   color: "#7c3aed", createdAt: "2026-03-20" },
  ];
  // Tag a slice of seeded documents to demo the grouping.
  documents.forEach((d, i) => {
    if (i % 9 === 0) d.customGroupId = "AGRP-001";
    else if (i % 11 === 0) d.customGroupId = "AGRP-002";
    else if (i % 13 === 0) d.customGroupId = "AGRP-003";
    else d.customGroupId = null;
  });

  /** Auth users — for the demo login page. Each user is one of the
   *  existing PER-* people so the topbar can read their name / role.
   *  Password is intentionally trivial for the demo. */
  const AUTH_USERS = [
    { personId: "PER-001", email: "turki@aquafleet.sa",   password: "aquafleet" },
    { personId: "PER-002", email: "sara@aquafleet.sa",    password: "aquafleet" },
    { personId: "PER-003", email: "mahmoud@aquafleet.sa", password: "aquafleet" },
    { personId: "PER-004", email: "hatem@aquafleet.sa",   password: "aquafleet" },
    { personId: "PER-008", email: "reem@aquafleet.sa",    password: "aquafleet" },
    { personId: "PER-009", email: "khaled@aquafleet.sa",  password: "aquafleet" },
  ];

  function commissionTotal(c) {
    const lineSum = c.lines.reduce((s, l) => s + l.amountSar, 0);
    const specialSum = c.specials.reduce((s, x) => s + x.amountSar, 0);
    const adjSum = c.adjustments.reduce((s, a) => s + a.amountSar, 0);
    return lineSum + specialSum + adjSum + (c.bonusSar || 0);
  }

  // ---- KPIs ----
  function fleetKpis() {
    const active = trucks.filter(t => t.status === "active").length;
    const maint = trucks.filter(t => t.status === "maintenance").length;
    const idle = trucks.filter(t => t.status === "idle").length;
    const oos = trucks.filter(t => t.status === "out_of_service").length;
    const utilization = +(trucks.reduce((s, t) => s + t.utilizationPct, 0) / trucks.length).toFixed(1);
    const avgHealth = +(trucks.reduce((s, t) => s + t.healthScore, 0) / trucks.length).toFixed(1);
    const todayTrips = trips.filter(t => t.scheduledStart.startsWith("2026-05-11")).length;
    const delivered = trips.filter(t => t.status === "delivered");
    const litersDelivered30d = delivered.reduce((s, t) => s + t.waterLiters, 0);
    const fuelCost30d = +delivered.reduce((s, t) => s + t.fuelLiters * 2.18, 0).toFixed(0);
    const revenue30d = +delivered.reduce((s, t) => s + t.revenueSar, 0).toFixed(0);
    const opCost30d = +delivered.reduce((s, t) => s + t.costSar, 0).toFixed(0);
    const onTimePct = +((delivered.filter(t => (t.actualDurationMin ?? 0) <= t.plannedDurationMin + 10).length /
      Math.max(1, delivered.length)) * 100).toFixed(1);
    return { active, maint, idle, oos, utilization, avgHealth, todayTrips, litersDelivered30d, fuelCost30d, revenue30d, opCost30d, onTimePct };
  }

  // ---- Out-Sourced Jobs (external repair shops) ----
  // Independent from in-house WOs — no inventory deduction, but invoices
  // (PDF / image data URLs) are tracked. Seed ~6 across the fleet.
  const OS_REPAIRERS = [
    { name: "Al-Tawfeeq Heavy Truck Workshop", phone: "+966 11 234 5610" },
    { name: "Naghi Service Center — Jeddah",   phone: "+966 12 656 7012" },
    { name: "Eastern Diesel Repair — Dammam",  phone: "+966 13 821 4488" },
    { name: "Madinah Auto Mechanical",         phone: "+966 14 845 2231" },
    { name: "Saudi Truck Service Riyadh",      phone: "+966 11 472 9908" },
  ];
  const OS_DESC_SAMPLES = [
    { en: "Transmission overhaul", ar: "صيانة شاملة لناقل الحركة" },
    { en: "Chassis welding & frame straightening", ar: "لحام الشاسيه وتعديل الإطار" },
    { en: "Hydraulic pump rebuild", ar: "إعادة بناء طلمبة الهيدروليك" },
    { en: "AC compressor replacement", ar: "استبدال ضاغط المكيف" },
    { en: "Differential repair", ar: "إصلاح الترس التفاضلي" },
    { en: "Turbocharger rebuild", ar: "إعادة بناء التيربو" },
  ];
  const OS_INVOICE_SAMPLE = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='200'%3E%3Crect width='100%25' height='100%25' fill='%23f1f5f9'/%3E%3Crect x='20' y='20' width='280' height='160' fill='%23ffffff' stroke='%23cbd5e1' stroke-width='2' rx='6'/%3E%3Ctext x='50%25' y='55' text-anchor='middle' fill='%2334495e' font-size='16' font-weight='bold' font-family='sans-serif'%3EINVOICE%3C/text%3E%3Cline x1='40' y1='75' x2='280' y2='75' stroke='%23cbd5e1'/%3E%3Ctext x='40' y='100' fill='%2364748b' font-size='11' font-family='sans-serif'%3EVendor: Repair Shop%3C/text%3E%3Ctext x='40' y='120' fill='%2364748b' font-size='11' font-family='sans-serif'%3EVehicle: Truck%3C/text%3E%3Ctext x='40' y='140' fill='%2364748b' font-size='11' font-family='sans-serif'%3EService: Repair %26 Maintenance%3C/text%3E%3Ctext x='40' y='168' fill='%23059669' font-size='14' font-weight='bold' font-family='sans-serif'%3ETotal: SAR%3C/text%3E%3C/svg%3E";

  const outsourcedJobs = Array.from({ length: 6 }, (_, i) => {
    const truck = trucks[(i * 5 + 3) % trucks.length];
    const repairer = OS_REPAIRERS[i % OS_REPAIRERS.length];
    const desc = OS_DESC_SAMPLES[i % OS_DESC_SAMPLES.length];
    // Use the same type enum as in-house WOs — `corrective` now displays as "Repair".
    const typePool = ["corrective", "corrective", "preventive", "inspection", "corrective", "predictive"];
    const statusPool = ["scheduled", "in_progress", "completed", "in_progress", "scheduled", "completed"];
    const status = statusPool[i];
    const startDate = new Date(2026, 4, 13 + (i - 2));
    const hasInvoices = status !== "scheduled";
    return {
      id: `OS-${String(i + 1).padStart(4, "0")}`,
      truckId: truck.id,
      plate: truck.plate, plateAr: truck.plateAr,
      startDate: startDate.toISOString().slice(0, 10),
      type: typePool[i],
      descriptionIds: i % 2 === 0 ? [repairDescriptions[(i * 3) % repairDescriptions.length].id] : [],
      descriptionsFreeText: desc.en,
      descriptionsFreeTextAr: desc.ar,
      repairerName: repairer.name,
      repairerPhone: repairer.phone,
      estimatedCostSar: 2500 + i * 1750,
      status,
      invoices: hasInvoices ? [{
        id: `INV-${i}-1`,
        name: `invoice_${repairer.name.split(" ")[0]}_${i + 1}.svg`,
        dataUrl: OS_INVOICE_SAMPLE,
        mime: "image/svg+xml",
        uploadedAt: new Date(startDate.getTime() + 2 * 86400000).toISOString(),
      }] : [],
      createdAt: startDate.toISOString(),
    };
  });

  // ===== Purchase Orders (two-step purchasing workflow) =====
  // Flow:
  //   draft → issued (sent to supplier) → received (stock added) → pending_approval
  //   → approved (>= MIN_APPROVALS approvers) OR rejected
  // Approvers = anyone in `people` with role in APPROVER_ROLES.
  const APPROVER_ROLES = ["fleet_manager", "ops_supervisor", "inventory_clerk"];
  const MIN_APPROVALS = 2;

  // AI rationale snippets for AI-generated POs.
  const AI_RATIONALES = [
    { en: "Stock at 18% of reorder level; 7-day burn rate suggests stock-out within 4 days.",
      ar: "المخزون عند 18% من حد إعادة الطلب؛ معدل الاستهلاك يشير إلى نفاد خلال 4 أيام." },
    { en: "Consumption +24% vs trailing 30-day average; preventive maintenance peak expected next week.",
      ar: "الاستهلاك +24% مقابل متوسط آخر 30 يومًا؛ يُتوقع ذروة صيانة وقائية الأسبوع القادم." },
    { en: "Below reorder threshold; supplier lead time exceeds remaining stock cover.",
      ar: "أقل من حد إعادة الطلب؛ وقت توريد المورّد يتجاوز تغطية المخزون المتبقي." },
    { en: "5 active work orders require this part; current stock covers only 2.",
      ar: "5 أوامر عمل نشطة تتطلب هذه القطعة؛ المخزون الحالي يغطي 2 فقط." },
  ];

  // Seed ~7 purchase orders distributed across statuses so each tab has data.
  const purchaseOrders = [];
  // Log of every parts-receipt (PO-based or loose). Each row:
  // { id, sourceType: "po" | "manual", poId?, supplier, warehouse,
  //   lines, invoices, receivedDate, receivedById, totalCost, note }
  const partReceipts = [];
  const PO_TODAY = new Date(2026, 4, 20);
  function makePO(spec) {
    const supplierName = spec.supplierName || parts.find(p => p.id === spec.lines[0].partId)?.supplier || SUPPLIER_NAMES[0];
    const supplier = findSupplierByName(supplierName);
    const totalEst = spec.lines.reduce((s, l) => s + l.qty * l.unitPriceSar, 0);
    const id = `PO-${String(2026)}-${String(purchaseOrders.length + 1).padStart(4, "0")}`;
    return {
      id,
      status: spec.status,
      lines: spec.lines.map(l => ({
        partId: l.partId,
        qty: l.qty,
        unitPriceSar: l.unitPriceSar,
        receivedQty: spec.status === "draft" || spec.status === "issued" ? 0 : l.qty,
        receivedUnitPriceSar: spec.status === "draft" || spec.status === "issued" ? null : l.unitPriceSar,
      })),
      supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone, email: supplier.email, contactPerson: supplier.contactPerson },
      warehouse: spec.warehouse || "Riyadh",
      requestedById: spec.requestedById || "PER-008",
      requestDate: spec.requestDate,
      expectedDelivery: spec.expectedDelivery,
      receivedDate: spec.receivedDate || null,
      receivedById: spec.receivedById || null,
      notes: spec.notes || "",
      aiGenerated: spec.aiGenerated || false,
      aiRationale: spec.aiGenerated ? pick(AI_RATIONALES) : null,
      approvals: spec.approvals || [],   // [{ personId, approvedAt, comment }]
      rejection: spec.rejection || null, // { personId, rejectedAt, reason }
      estimatedTotalSar: totalEst,
      actualTotalSar: spec.status === "approved" || spec.status === "pending_approval"
        ? spec.lines.reduce((s, l) => s + l.qty * (l.actualPrice ?? l.unitPriceSar), 0)
        : null,
    };
  }
  const daysAgo = (n) => { const d = new Date(PO_TODAY); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); };
  const daysAhead = (n) => { const d = new Date(PO_TODAY); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); };

  // 1) Draft (just being composed)
  purchaseOrders.push(makePO({
    status: "draft",
    lines: [{ partId: "PRT-0011", qty: 600, unitPriceSar: 8 }],
    supplierName: "Mohamed Yousuf Naghi",
    requestedById: "PER-008",
    requestDate: daysAgo(0),
    expectedDelivery: daysAhead(7),
    notes: "Run-of-the-mill DEF top-up. Awaiting clerk review.",
  }));

  // 2) Issued (sent to supplier, no receipt yet)
  purchaseOrders.push(makePO({
    status: "issued",
    lines: [
      { partId: "PRT-0005", qty: 16, unitPriceSar: 620 },
      { partId: "PRT-0006", qty: 16, unitPriceSar: 580 },
    ],
    supplierName: "Al-Futtaim Auto Parts",
    requestedById: "PER-008",
    requestDate: daysAgo(4),
    expectedDelivery: daysAhead(3),
    notes: "Quarterly brake-pad refresh.",
  }));

  // 3) Issued (AI-generated, awaiting delivery)
  purchaseOrders.push(makePO({
    status: "issued",
    lines: [{ partId: "PRT-0008", qty: 24, unitPriceSar: 2150 }],
    supplierName: "Juffali Trucks",
    requestedById: "PER-008",
    requestDate: daysAgo(2),
    expectedDelivery: daysAhead(10),
    aiGenerated: true,
    notes: "AI auto-suggestion based on Q1 burn rate.",
  }));

  // 4) Pending approval (received but awaiting management sign-off)
  purchaseOrders.push(makePO({
    status: "pending_approval",
    lines: [
      { partId: "PRT-0001", qty: 540, unitPriceSar: 28, actualPrice: 29 },
      { partId: "PRT-0002", qty: 60, unitPriceSar: 95, actualPrice: 95 },
    ],
    supplierName: "ALJ Industrial",
    requestedById: "PER-008",
    receivedById: "PER-008",
    requestDate: daysAgo(14),
    expectedDelivery: daysAgo(5),
    receivedDate: daysAgo(3),
    notes: "Engine oil arrived 24h late; price up 3.6%.",
    approvals: [{ personId: "PER-002", approvedAt: daysAgo(2), comment: "Variance acceptable." }],
  }));

  // 5) Pending approval, AI-generated, large value (needs two sign-offs)
  purchaseOrders.push(makePO({
    status: "pending_approval",
    lines: [{ partId: "PRT-0012", qty: 12, unitPriceSar: 1290 }],
    supplierName: "Bin Dawood Heavy",
    requestedById: "PER-008",
    receivedById: "PER-008",
    requestDate: daysAgo(10),
    expectedDelivery: daysAgo(3),
    receivedDate: daysAgo(1),
    aiGenerated: true,
    notes: "Batteries received in full.",
    approvals: [],
  }));

  // 6) Approved (fully signed off) — completed cycle, ~12 days old
  purchaseOrders.push(makePO({
    status: "approved",
    lines: [
      { partId: "PRT-0010", qty: 380, unitPriceSar: 22 },
      { partId: "PRT-0015", qty: 12, unitPriceSar: 480 },
    ],
    supplierName: "Mohamed Yousuf Naghi",
    requestedById: "PER-008",
    receivedById: "PER-008",
    requestDate: daysAgo(28),
    expectedDelivery: daysAgo(20),
    receivedDate: daysAgo(18),
    notes: "Coolant + tank gaskets restock.",
    approvals: [
      { personId: "PER-002", approvedAt: daysAgo(17), comment: "Match PO." },
      { personId: "PER-001", approvedAt: daysAgo(16), comment: "Approved." },
    ],
  }));

  // 7) Approved (older cycle)
  purchaseOrders.push(makePO({
    status: "approved",
    lines: [
      { partId: "PRT-0007", qty: 8, unitPriceSar: 1180 },
      { partId: "PRT-0009", qty: 18, unitPriceSar: 2250 },
    ],
    supplierName: "Juffali Trucks",
    requestedById: "PER-008",
    receivedById: "PER-008",
    requestDate: daysAgo(45),
    expectedDelivery: daysAgo(35),
    receivedDate: daysAgo(33),
    notes: "Brake discs + drive tires.",
    approvals: [
      { personId: "PER-002", approvedAt: daysAgo(32), comment: "OK." },
      { personId: "PER-003", approvedAt: daysAgo(31), comment: "Variance within limits." },
      { personId: "PER-001", approvedAt: daysAgo(30), comment: "Final sign-off." },
    ],
  }));

  function nextPOId() {
    const n = purchaseOrders.length + 1;
    return `PO-2026-${String(n).padStart(4, "0")}`;
  }
  /** Return parts at-or-below reorder level that don't already have an open PO. */
  function suggestAIPurchaseLines() {
    const inOpenPO = new Set();
    purchaseOrders.forEach(po => {
      if (po.status === "draft" || po.status === "issued") {
        po.lines.forEach(l => inOpenPO.add(l.partId));
      }
    });
    return parts
      .filter(p => p.qtyOnHand <= p.reorderLevel && !inOpenPO.has(p.id))
      .slice(0, 5)
      .map(p => ({ partId: p.id, qty: p.reorderQty, unitPriceSar: p.currentPriceSar, supplier: p.supplier }));
  }

  window.DATA = {
    trucks, drivers, people, trips, parts, predictiveAlerts, workOrders,
    DEPOTS, DEPOT_COORDS,
    PROJECTS, PROJECT_BY_CUSTOMER,
    commissions, partUsage, SUPPLIERS,
    COMMISSION_MONTHS, CURRENT_MONTH_KEY,
    documents, AI_SAMPLES, GROUP_TEMPLATES,
    detectDocType, detectRefs, aiExtract,
    docPrimaryHeading, docExpiryStatus, docDaysUntilExpiry, docIssuer, docSummaryFields, docDetailFields,
    archiveCustomGroups,
    findArchiveGroup: (id) => archiveCustomGroups.find(g => g.id === id) || null,
    archiveCustomTypes,
    findCustomType: (id) => archiveCustomTypes.find(t => t.id === id) || null,
    /** Built-in doc types — the UI calls this to render the full taxonomy
     *  in dropdowns + filters. Mirrors detectDocType's set. */
    builtInDocTypes: [
      "license","registration","insurance","commercial_registration","national_address",
      "permit","inspection","contract","delivery","quote","po","invoice","letter","other",
    ],
    /** All known doc types (built-in + user-defined). The IDs of custom
     *  types are the same strings used as `doc.type` on records. */
    allDocTypes() { return this.builtInDocTypes.concat(archiveCustomTypes.map(t => t.id)); },
    /** Resolve a doc type id → a human label honoring the current language. */
    docTypeLabel(typeId, lang) {
      const ct = archiveCustomTypes.find(t => t.id === typeId);
      if (ct) return lang === "ar" ? ct.labelAr || ct.label : ct.label;
      // Fall back to the i18n table for built-ins
      const key = `doc.${typeId}`;
      const T2 = window.T;
      const v = T2 ? T2(key) : key;
      return v && v !== key ? v : typeId;
    },
    AUTH_USERS,
    /** Validate a sign-in attempt. Returns the matched user record + person
     *  on success, null on failure. Accepts a lenient match for the demo:
     *  - exact email + password (canonical path)
     *  - email alone if the user picked from the demo-account list */
    authenticate(email, password) {
      const e = String(email || "").trim().toLowerCase();
      const u = AUTH_USERS.find(x => x.email.toLowerCase() === e);
      if (!u) return null;
      if (password != null && password !== "" && u.password !== password) return null;
      const person = people.find(p => p.id === u.personId) || null;
      return { user: u, person };
    },
    repairDescriptions, outsourcedJobs,
    consumePartsForWO,
    ENGINE_COMPONENTS,
    CAPACITY_OPTIONS_M3: [33, 18, 6],
    purchaseOrders,
    APPROVER_ROLES, MIN_APPROVALS, AI_RATIONALES,
    findPO: id => purchaseOrders.find(o => o.id === id),
    findSupplierByName,
    WAREHOUSES,
    findWarehouseByName: (name) => WAREHOUSES.find(w => w.name === name || w.nameAr === name) || null,
    /** Add a new supplier on the fly (used by the +Supplier flow inside
     *  Add Parts / New PO). Returns the freshly-created record. */
    addSupplier({ name, phone, email, contactPerson }) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return null;
      const existing = SUPPLIERS.find(s => s.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      const idx = SUPPLIERS.length + 1;
      const rec = {
        id: `SUP-${String(idx).padStart(3, "0")}`,
        name: trimmed,
        phone: phone || "",
        email: email || "",
        contactPerson: contactPerson || "",
      };
      SUPPLIERS.push(rec);
      SUPPLIER_NAMES.push(rec.name);
      return rec;
    },
    /** Add a new warehouse on the fly. */
    addWarehouse({ name, city, address }) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return null;
      const existing = WAREHOUSES.find(w => w.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      const id = `WH-${trimmed.slice(0, 3).toUpperCase()}-${String(WAREHOUSES.length + 1).padStart(2, "0")}`;
      const rec = {
        id, name: trimmed, nameAr: trimmed,
        city: city || trimmed, cityAr: city || trimmed,
        address: address || "",
      };
      WAREHOUSES.push(rec);
      return rec;
    },
    /** Add a brand-new item / equipment type to the catalog on the fly
     *  (used by the +Item flow inside Add Parts / New PO). Starts at zero
     *  on-hand with no price tiers — stock arrives via the receive flow.
     *  Returns the freshly-created (or matching existing) part record. */
    addPart({ name, nameAr, sku, category, unit, priceSar, reorderLevel, reorderQty, warehouse, supplier }) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return null;
      const existing = parts.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      const idx = parts.length + 1;
      const price = +priceSar || 0;
      const rec = {
        id: `PRT-${String(idx).padStart(4, "0")}`,
        sku: (sku && String(sku).trim()) || `SKU-${1000 + idx}`,
        name: trimmed,
        nameAr: (nameAr && String(nameAr).trim()) || trimmed,
        category: category || "consumable",
        unit: unit || "ea",
        currentPriceSar: price,
        previousPriceSar: null,
        priceTiers: [],
        qtyOnHand: 0,
        reorderLevel: +reorderLevel || 0,
        reorderQty: +reorderQty || 1,
        warehouse: warehouse || (WAREHOUSES[0] && WAREHOUSES[0].name) || "",
        supplier: supplier || SUPPLIER_NAMES[0] || "",
        leadTimeDays: 7,
        lastReceived: null,
      };
      parts.push(rec);
      return rec;
    },
    /** Receive parts WITHOUT a Purchase Order ("Add parts" direct flow).
     *  Each line becomes a fresh FIFO tier on its part record. Mandatory
     *  invoice (data URL) is stored on the receipt log. */
    receiveLooseParts({ supplierName, warehouse, lines, invoices, receivedById, note }) {
      if (!lines || lines.length === 0) return { receiptId: null, totalCost: 0 };
      const today = new Date().toISOString().slice(0, 10);
      let total = 0;
      lines.forEach(l => {
        const p = parts.find(x => x.id === l.partId);
        if (!p || !l.qty || l.qty <= 0) return;
        // Mark previous Current → Previous, then push the new tier.
        if (p.priceTiers.length > 0) {
          const last = p.priceTiers[p.priceTiers.length - 1];
          if (last.note === "Current price") last.note = "Previous price";
        }
        p.priceTiers.push({
          priceSar: +l.unitPriceSar || p.currentPriceSar,
          qty: l.qty,
          qtyPurchased: l.qty,
          receivedOn: today,
          note: "Current price",
        });
        p.qtyOnHand = p.priceTiers.reduce((s, t) => s + t.qty, 0);
        p.previousPriceSar = p.currentPriceSar;
        p.currentPriceSar = +l.unitPriceSar || p.currentPriceSar;
        p.lastReceived = today;
        p.supplier = supplierName || p.supplier;
        if (warehouse) p.warehouse = warehouse;
        total += (+l.unitPriceSar || 0) * (l.qty || 0);
      });
      // Log the receipt itself so we can show a small audit trail.
      const receiptId = `RCP-${String(Date.now()).slice(-6)}`;
      partReceipts.push({
        id: receiptId,
        sourceType: "manual",
        receivedById, receivedDate: today,
        supplier: supplierName,
        warehouse,
        lines: lines.map(l => ({ partId: l.partId, qty: l.qty, unitPriceSar: +l.unitPriceSar })),
        invoices: invoices || [],
        note: note || "",
        totalCost: total,
      });
      return { receiptId, totalCost: total };
    },
    /** All historical part receipts (PO and loose). The UI uses this for
     *  per-part history; the seeded loose-receipts list is empty at boot. */
    partReceipts,
    nextPOId, suggestAIPurchaseLines,
    /** Currently-eligible approvers — fleet managers, ops supervisors, inventory clerks. */
    approverList() { return people.filter(p => APPROVER_ROLES.includes(p.role) && p.active); },
    /** Add received parts to inventory as a new FIFO price tier per line.
     *  Mutates parts and returns the total cost recorded. */
    receivePO(poId, receivedById) {
      const po = purchaseOrders.find(o => o.id === poId);
      if (!po) return 0;
      if (po.status !== "issued" && po.status !== "draft") return 0;
      let total = 0;
      po.lines.forEach(l => {
        const p = parts.find(x => x.id === l.partId);
        if (!p) return;
        const qty = l.receivedQty || l.qty;
        const unit = l.receivedUnitPriceSar != null ? l.receivedUnitPriceSar : l.unitPriceSar;
        // Push a fresh FIFO tier, mark previous "Current price" as "Previous price"
        if (p.priceTiers.length > 0) {
          const last = p.priceTiers[p.priceTiers.length - 1];
          if (last.note === "Current price") last.note = "Previous price";
        }
        p.priceTiers.push({
          priceSar: unit, qty, qtyPurchased: qty,
          receivedOn: po.receivedDate, note: "Current price",
        });
        if (unit !== p.currentPriceSar) p.previousPriceSar = p.currentPriceSar;
        p.currentPriceSar = unit;
        p.qtyOnHand = p.priceTiers.reduce((s, t) => s + t.qty, 0);
        p.lastReceived = po.receivedDate;
        total += qty * unit;
      });
      po.status = "pending_approval";
      po.receivedById = receivedById;
      po.actualTotalSar = total;
      return total;
    },
    /** Add an approval entry. When count reaches MIN_APPROVALS, status flips. */
    approvePO(poId, personId, comment) {
      const po = purchaseOrders.find(o => o.id === poId);
      if (!po) return false;
      if (po.approvals.find(a => a.personId === personId)) return false;
      po.approvals.push({ personId, approvedAt: new Date().toISOString(), comment: comment || "" });
      if (po.approvals.length >= MIN_APPROVALS) po.status = "approved";
      return true;
    },
    rejectPO(poId, personId, reason) {
      const po = purchaseOrders.find(o => o.id === poId);
      if (!po) return false;
      po.rejection = { personId, rejectedAt: new Date().toISOString(), reason: reason || "" };
      po.status = "rejected";
      return true;
    },
    /** Per-part financial summary (last 90 days from PO_TODAY). */
    partFinance(partId) {
      const usage = (partUsage[partId] || []);
      const spentByConsumption = usage.reduce((s, u) => s + u.costSar, 0);
      const totalConsumed = usage.reduce((s, u) => s + u.qty, 0);
      const purchases = purchaseOrders
        .filter(po => po.lines.some(l => l.partId === partId) && (po.status === "approved" || po.status === "pending_approval"))
        .map(po => {
          const line = po.lines.find(l => l.partId === partId);
          const qty = line.receivedQty || line.qty;
          const unit = line.receivedUnitPriceSar != null ? line.receivedUnitPriceSar : line.unitPriceSar;
          return { poId: po.id, date: po.receivedDate || po.requestDate, qty, unit, cost: qty * unit, status: po.status };
        });
      const totalPurchased = purchases.reduce((s, p) => s + p.cost, 0);
      const part = parts.find(p => p.id === partId);
      const stockValue = part ? part.priceTiers.reduce((s, t) => s + t.qty * t.priceSar, 0) : 0;
      // Trend: positive means current price > avg of historical batches
      const priceTrendPct = (() => {
        if (!part || part.priceTiers.length < 2) return 0;
        const hist = part.priceTiers.slice(0, -1);
        const avgOld = hist.reduce((s, t) => s + t.priceSar, 0) / hist.length;
        return +(((part.currentPriceSar - avgOld) / avgOld) * 100).toFixed(1);
      })();
      return { spentByConsumption, totalConsumed, totalPurchased, purchases, stockValue, priceTrendPct };
    },
    fleetKpis,
    findTruck: id => trucks.find(t => t.id === id),
    findDriver: id => drivers.find(d => d.id === id),
    findPerson: id => people.find(p => p.id === id),
    /** Add a staff member (support/management employee) on the fly. Mirrors
     *  the shape of seeded `people` records. Returns the new record. */
    addPerson({ name, nameAr, role, email, phone, depot, active }) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return null;
      const idx = people.length + 1;
      const rec = {
        id: `PER-${String(idx).padStart(3, "0")}`,
        name: trimmed,
        nameAr: (nameAr && String(nameAr).trim()) || trimmed,
        role: role || "ops_supervisor",
        email: email || "",
        phone: phone || "",
        depot: depot || DEPOTS[0],
        active: active !== false,
      };
      people.push(rec);
      return rec;
    },
    findPart: id => parts.find(p => p.id === id),
    findWO: id => workOrders.find(w => w.id === id),
    findOutsourced: id => outsourcedJobs.find(o => o.id === id),
    findTripsForProject(projectId) { return trips.filter(t => t.projectId === projectId); },
    WATER_STATIONS,
    findWaterStation(id) { return WATER_STATIONS.find(s => s.id === id) || null; },
    nextProjectId() {
      let n = PROJECTS.length + 1;
      while (PROJECTS.some(p => p.id === `PRJ-CUSTOM${n}`)) n++;
      return `PRJ-CUSTOM${n}`;
    },
    /** Compute the commission for the n-th delivery on this project (1-indexed).
     *  - Fixed: every trip pays project.ratePerTrip.
     *  - Scalable: nth trip pays base × (1 + (n-1) × pct/100), so a 5% bump
     *    means trip 2 pays 1.05× base, trip 3 pays 1.10× base, etc. */
    commissionForNthTrip(project, n) {
      if (!project) return 0;
      const base = project.ratePerTrip || 0;
      if (project.commissionMode !== "scalable" || !project.scalableRatePct) return base;
      return +(base * (1 + (n - 1) * (project.scalableRatePct / 100))).toFixed(2);
    },

    /** When a trip transitions to "delivered" from the Kanban, credit the
     *  driver's commission row for the current month: add the cost of the
     *  Nth trip (where N is post-increment) for this project. If the project
     *  has scalable commission, the amount on this trip differs from the
     *  per-trip base. We track the cumulative amount + count on a per-line
     *  basis so the driver page can show both. */
    payCommissionForTrip(tripId) {
      const t = trips.find(x => x.id === tripId);
      if (!t) return null;
      const proj = PROJECTS.find(p => p.id === t.projectId);
      if (!proj || !t.driverId) return null;
      const monthKey = CURRENT_MONTH_KEY;
      let row = commissions.find(c => c.driverId === t.driverId && c.monthKey === monthKey);
      if (!row) {
        row = {
          driverId: t.driverId, monthKey,
          payoutStatus: "pending",
          lines: [], specials: [], adjustments: [],
          bonus: 0,
        };
        commissions.push(row);
      }
      let line = row.lines.find(l => l.projectId === proj.id);
      const nextN = line ? line.tripsCount + 1 : 1;
      const thisTripPay = this.commissionForNthTrip(proj, nextN);
      if (line) {
        line.tripsCount = nextN;
        line.amountSar = +(line.amountSar + thisTripPay).toFixed(2);
        line.lastTripAt = new Date().toISOString();
      } else {
        row.lines.push({
          id: `CL-${t.driverId}-${proj.id}-auto-${Date.now().toString(36)}`,
          projectId: proj.id,
          tripsCount: 1,
          ratePerTrip: proj.ratePerTrip,
          amountSar: thisTripPay,
          manual: false,
          lastTripAt: new Date().toISOString(),
          source: "kanban_delivery",
          commissionMode: proj.commissionMode || "fixed",
          scalableRatePct: proj.scalableRatePct || 0,
        });
      }
      return { driverId: t.driverId, projectId: proj.id, paidThisTrip: thisTripPay, tripN: nextN };
    },
    findProject: id => PROJECTS.find(p => p.id === id),
    /** Find a commission row for a driver in a specific month (defaults to
     *  current). Returns null if none seeded. */
    findCommission(driverId, monthKey) {
      const mk = monthKey || CURRENT_MONTH_KEY;
      return commissions.find(c => c.driverId === driverId && c.monthKey === mk);
    },
    commissionsForMonth(monthKey) {
      const mk = monthKey || CURRENT_MONTH_KEY;
      return commissions.filter(c => c.monthKey === mk);
    },
    findDocument: id => documents.find(d => d.id === id),
    findGroup(projectId, groupId) {
      const p = PROJECTS.find(p => p.id === projectId);
      return p ? p.groups.find(g => g.id === groupId) : null;
    },
    partAvgCost, commissionTotal,
    /** Apply consumption of a single part (e.g., when a mechanic "uses" a
     *  part from the UI). FIFO across price tiers. Mutates the part and adds
     *  a usage log entry. Returns the cost of the line at the tier mix used. */
    consumePart(partId, qty, woId, truckId) {
      const part = parts.find(p => p.id === partId);
      if (!part) return 0;
      let remaining = qty, lineCost = 0;
      for (const tier of part.priceTiers) {
        if (remaining <= 0) break;
        const take = Math.min(tier.qty, remaining);
        tier.qty -= take; remaining -= take; lineCost += take * tier.priceSar;
      }
      part.qtyOnHand = part.priceTiers.reduce((s, t) => s + t.qty, 0);
      partUsage[partId] = partUsage[partId] || [];
      partUsage[partId].push({ woId, truckId, date: new Date().toISOString(), qty: qty - remaining, costSar: lineCost });
      return lineCost;
    },
  };
})();
