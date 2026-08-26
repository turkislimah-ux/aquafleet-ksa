export type Lang = "en" | "ar";

export const dict = {
  appName: { en: "AquaFleet KSA", ar: "أكوافليت السعودية" },
  tagline: { en: "Water Transportation Fleet Operations", ar: "إدارة عمليات أسطول نقل المياه" },
  nav: {
    dashboard: { en: "Dashboard", ar: "لوحة التحكم" },
    fleet: { en: "Fleet", ar: "الأسطول" },
    drivers: { en: "Staff", ar: "الموظفون" },
    trips: { en: "Trips", ar: "الرحلات" },
    routes: { en: "Route Optimization", ar: "تحسين المسارات" },
    maintenance: { en: "Maintenance", ar: "الصيانة" },
    predictive: { en: "Predictive AI", ar: "الذكاء التنبؤي" },
    iot: { en: "IoT Monitoring", ar: "مراقبة المستشعرات" },
    inventory: { en: "Inventory", ar: "المخزون" },
    consumption: { en: "Consumption", ar: "الاستهلاك" },
    reports: { en: "Reports", ar: "التقارير" },
    archive: { en: "Archive", ar: "الأرشيف" },
  },
  /**
   * Names for the sidebar's two <nav> LANDMARKS — deliberately a separate block
   * from `nav` above, which is keyed by `NavItem.key` and read as
   * `t(\`nav.${item.key}\`)`. A `main` or `soon` entry sitting in there would be
   * indistinguishable from a page, and would start resolving for any nav item
   * that ever took one of those keys.
   *
   * `soon` is also the heading printed above the deferred trio, so the visible
   * text and the landmark's accessible name are the same string rather than two
   * that can drift apart.
   */
  navLandmark: {
    main: { en: "Main", ar: "الرئيسية" },
    soon: { en: "Coming Soon", ar: "قريبًا" },
  },
  status: {
    active: { en: "Active", ar: "نشط" },
    idle: { en: "Idle", ar: "متوقف" },
    maintenance: { en: "Maintenance", ar: "صيانة" },
    out_of_service: { en: "Out of Service", ar: "خارج الخدمة" },
    on_duty: { en: "On Duty", ar: "في الخدمة" },
    off_duty: { en: "Off Duty", ar: "خارج الخدمة" },
    leave: { en: "On Leave", ar: "في إجازة" },
    training: { en: "Training", ar: "تدريب" },
    scheduled: { en: "Scheduled", ar: "مجدولة" },
    loading: { en: "Loading", ar: "تحميل" },
    in_transit: { en: "In Transit", ar: "في الطريق" },
    delivered: { en: "Delivered", ar: "تم التسليم" },
    cancelled: { en: "Cancelled", ar: "ملغاة" },
    open: { en: "Open", ar: "مفتوحة" },
    in_progress: { en: "In Progress", ar: "قيد التنفيذ" },
    awaiting_parts: { en: "Awaiting Parts", ar: "بانتظار قطع" },
    completed: { en: "Completed", ar: "مكتملة" },
    info: { en: "Info", ar: "معلومات" },
    warning: { en: "Warning", ar: "تحذير" },
    critical: { en: "Critical", ar: "حرج" },
    low: { en: "Low", ar: "منخفض" },
    medium: { en: "Medium", ar: "متوسط" },
    high: { en: "High", ar: "مرتفع" },
    preventive: { en: "Preventive", ar: "وقائية" },
    corrective: { en: "Repair", ar: "إصلاح" },
    predictive: { en: "Predictive", ar: "تنبؤية" },
    inspection: { en: "Inspection", ar: "فحص" },
  },
  kpi: {
    activeTrucks: { en: "Active Trucks", ar: "الشاحنات النشطة" },
    fleetSize: { en: "Fleet Size", ar: "حجم الأسطول" },
    avgHealth: { en: "Avg Fleet Health", ar: "متوسط حالة الأسطول" },
    utilization: { en: "Utilization", ar: "معدل الاستخدام" },
    onTime: { en: "On-Time Delivery", ar: "التسليم في الوقت" },
    litersDelivered: { en: "Liters Delivered (30d)", ar: "اللترات الموردة (30 يوم)" },
    fuelCost: { en: "Fuel Cost (30d)", ar: "تكلفة الوقود (30 يوم)" },
    opCost: { en: "Operating Cost (30d)", ar: "تكلفة التشغيل (30 يوم)" },
    revenue: { en: "Revenue (30d)", ar: "الإيرادات (30 يوم)" },
    todayTrips: { en: "Trips Today", ar: "رحلات اليوم" },
    openWO: { en: "Open Work Orders", ar: "أوامر عمل مفتوحة" },
    criticalAlerts: { en: "Critical Alerts", ar: "تنبيهات حرجة" },
  },
  common: {
    search: { en: "Search…", ar: "بحث..." },
    all: { en: "All", ar: "الكل" },
    truck: { en: "Truck", ar: "شاحنة" },
    plate: { en: "Plate", ar: "اللوحة" },
    driver: { en: "Driver", ar: "السائق" },
    depot: { en: "Depot", ar: "المستودع" },
    status: { en: "Status", ar: "الحالة" },
    health: { en: "Health", ar: "الحالة الفنية" },
    odometer: { en: "Odometer", ar: "العداد" },
    actions: { en: "Actions", ar: "إجراءات" },
    view: { en: "View", ar: "عرض" },
    new: { en: "New", ar: "جديد" },
    save: { en: "Save", ar: "حفظ" },
    cancel: { en: "Cancel", ar: "إلغاء" },
    optimize: { en: "Optimize", ar: "تحسين" },
    nextService: { en: "Next Service", ar: "الصيانة القادمة" },
    capacity: { en: "Capacity", ar: "السعة" },
    confidence: { en: "Confidence", ar: "الثقة" },
    failureIn: { en: "Predicted in", ar: "متوقع خلال" },
    days: { en: "days", ar: "يوم" },
    recommended: { en: "Recommended Action", ar: "الإجراء الموصى به" },
    component: { en: "Component", ar: "المكون" },
    severity: { en: "Severity", ar: "الخطورة" },
    cost: { en: "Cost", ar: "التكلفة" },
    revenue: { en: "Revenue", ar: "الإيرادات" },
    margin: { en: "Margin", ar: "الهامش" },
    title: { en: "Title", ar: "العنوان" },
    type: { en: "Type", ar: "النوع" },
    priority: { en: "Priority", ar: "الأولوية" },
    mechanic: { en: "Mechanic", ar: "الفني" },
    opened: { en: "Opened", ar: "تاريخ الفتح" },
    due: { en: "Due", ar: "تاريخ الاستحقاق" },
    part: { en: "Part", ar: "القطعة" },
    qty: { en: "Qty", ar: "الكمية" },
    unitPrice: { en: "Unit price", ar: "سعر الوحدة" },
    add: { en: "Add", ar: "إضافة" },
    newWO: { en: "New Work Order", ar: "أمر عمل جديد" },
    // Added in Phase 3 Batch 1. These three earn a place in `common` rather
    // than a route namespace because each already appears in more than one of
    // the three routes converted in that batch — Edit and Saving in all three
    // forms, Select… in both entity pickers. `mt.edit` / `mt.saveNotes` are the
    // maintenance track's own copies and stay where they are: they are read by
    // that module's buttons, not by generic form chrome.
    edit: { en: "Edit", ar: "تعديل" },
    saving: { en: "Saving…", ar: "جارٍ الحفظ…" },
    selectPlaceholder: { en: "Select…", ar: "اختر…" },
  },
  mt: {
    calendar: { en: "Maintenance Calendar", ar: "تقويم الصيانة" },
    weekOf: { en: "Week of", ar: "أسبوع" },
    prevWeek: { en: "Previous week", ar: "الأسبوع السابق" },
    nextWeek: { en: "Next week", ar: "الأسبوع التالي" },
    moreCount: { en: "more", ar: "أكثر" },
    weekActive: { en: "Active", ar: "نشطة" },
    weekPlanned: { en: "Planned", ar: "مخططة" },
    weekDelayed: { en: "Delayed", ar: "متأخرة" },
    weekNoJobs: { en: "No jobs", ar: "لا أعمال" },
    historical: { en: "Historical Jobs", ar: "الأعمال السابقة" },
    delayed: { en: "Delayed", ar: "متأخرة" },
    addJob: { en: "Schedule Job", ar: "جدولة عمل" },
    viewJob: { en: "View Job", ar: "عرض العمل" },
    workPerformed: { en: "Work Performed", ar: "العمل المنجز" },
    partsReplacedTitle: { en: "Parts Replaced", ar: "القطع المستبدلة" },
    mechanicNotes: { en: "Mechanic notes", ar: "ملاحظات الفني" },
    description: { en: "Description", ar: "الوصف" },
    addDescription: { en: "Add description…", ar: "إضافة وصف…" },
    chipsHelp: { en: "Click chips to select; type to add new", ar: "اضغط على الأوصاف لاختيارها؛ اكتب لإضافة جديد" },
    partsAndEquipment: { en: "Parts & Equipment", ar: "القطع والمعدات" },
    partsHelp: { en: "Reserved now — stock deducts when the job is started", ar: "محجوزة الآن — يخصم المخزون عند بدء العمل" },
    onHand: { en: "On hand", ar: "المتوفر" },
    outOfStock: { en: "Out of stock", ar: "غير متوفر" },
    // Polish item 1 (manual title) — replaces the old woTitleAuto/
    // woTitlePendingSave keys (title is a real optional field now, not an
    // auto-number preview). Shared by both tracks' create forms.
    titleOptionalHint: { en: "Describe the work — optional", ar: "وصف العمل — اختياري" },
    totalCost: { en: "Total Cost", ar: "التكلفة الإجمالية" },
    laborHours: { en: "Labor Hrs", ar: "ساعات العمل" },
    laborCost: { en: "Labor Cost", ar: "تكلفة العمالة" },
    partsCost: { en: "Parts Cost", ar: "تكلفة القطع" },
    // Polish item 2 display refinement — in-house track's parts-only total
    // (0079 migration). A NEW key, not a reuse of `mt.actualCost` — that one
    // already means something different (the OS track's workshop-payment
    // total, worded "Actual Total") and is used in unrelated screens
    // (OutsourcedJobDetailModal, OutsourcedTrack); reusing it here would
    // show the wrong wording and couple two unrelated figures.
    woActualCost: { en: "Actual Cost", ar: "التكلفة الفعلية" },
    inHouse: { en: "In-House", ar: "داخلية" },
    outsourced: { en: "Out-Sourced", ar: "خارجية" },
    groupByTruck: { en: "Group by truck", ar: "تجميع حسب الشاحنة" },
    clearDate: { en: "Clear date filter", ar: "إلغاء تصفية التاريخ" },
    phase2Note: { en: "Start / Complete actions land in Phase 2", ar: "إجراءات البدء / الإكمال تُضاف في المرحلة الثانية" },
    markInProg: { en: "Start Job", ar: "بدء العمل" },
    markComplete: { en: "Mark Complete", ar: "إنهاء العمل" },
    editNotes: { en: "Edit", ar: "تعديل" },
    saveNotes: { en: "Save", ar: "حفظ" },
    outsourcedComingSoon: { en: "Out-sourced jobs — coming in a later phase", ar: "الأعمال الخارجية — قادمة في مرحلة لاحقة" },
    noWorkOrders: { en: "No work orders in this view", ar: "لا توجد أوامر عمل في هذا العرض" },
    // P3 item 2 — combined group-by-truck table row count, matches
    // preview's own T("mt.jobCount") (pages-2.js's groupHeader).
    jobCount: { en: "jobs", ar: "عمل" },
    // P3 item 4B — "this month created" KPI box label, per active tab.
    thisMonthInHouse: { en: "This Month (Work Orders)", ar: "هذا الشهر (أوامر العمل)" },
    thisMonthOutsourced: { en: "This Month (Outsourced Jobs)", ar: "هذا الشهر (الأعمال الخارجية)" },
    editJob: { en: "Edit Work Order", ar: "تعديل أمر العمل" },
    laborCostPreview: { en: "Labor cost", ar: "تكلفة العمالة" },
    editInProgressNote: {
      en: "This job is already in progress — parts changes here consume or return stock immediately.",
      ar: "هذا العمل قيد التنفيذ بالفعل — تغييرات القطع هنا تستهلك أو تُعيد المخزون فوراً.",
    },
    outOfPart: { en: "Out of part", ar: "نقص في القطع" },
    outOfPartRow: {
      en: "One or more parts on this job no longer have enough stock",
      ar: "قطعة واحدة أو أكثر في هذا العمل لم يعد لها مخزون كافٍ",
    },
    outOfPartBlockStart: {
      en: "Cannot start — stock has dropped below what this job needs. Edit the parts list or wait for restock.",
      ar: "تعذر البدء — انخفض المخزون عن حاجة هذا العمل. عدّل قائمة القطع أو انتظر التوريد.",
    },
    outOfPartBanner: { en: "work order(s) can't start — stock is short", ar: "أمر/أوامر عمل لا يمكنها البدء — المخزون غير كافٍ" },
    allTasksRequired: { en: "All tasks must be checked before completing", ar: "يجب تحديد كل المهام قبل الإنهاء" },
    createdBy: { en: "Created by", ar: "أنشأه" },
    startedBy: { en: "Started by", ar: "بدأه" },
    completedBy: { en: "Completed by", ar: "أنهاه" },
    photos: { en: "Photos", ar: "الصور" },
    uploadPhoto: { en: "Upload photo", ar: "رفع صورة" },
    noPhotos: { en: "No photos yet", ar: "لا توجد صور بعد" },
    photoTooLarge: { en: "Photo too large (max 2 MB)", ar: "الصورة كبيرة جدًا (الحد 2 ميغابايت)" },
    photoCapReached: { en: "Maximum 4 photos per part", ar: "الحد الأقصى 4 صور لكل قطعة" },
    removePhoto: { en: "Remove photo", ar: "حذف الصورة" },
    // Phase 4 — Outsourced-jobs track.
    newOutsourcedJob: { en: "New Outsourced Job", ar: "عمل خارجي جديد" },
    editOutsourcedJob: { en: "Edit Outsourced Job", ar: "تعديل العمل الخارجي" },
    dispatch: { en: "Dispatch", ar: "إرسال" },
    responsibleMechanic: { en: "Responsible Mechanic", ar: "الفني المسؤول" },
    startDate: { en: "Start Date", ar: "تاريخ البدء" },
    estimatedFinish: { en: "Estimated Finish", ar: "الإنجاز المتوقع" },
    osOverdue: { en: "Overdue", ar: "متأخر" },
    repairer: { en: "Repairer", ar: "الورشة" },
    repairers: { en: "Repairers", ar: "الورش" },
    repairerType: { en: "Repairer Type", ar: "نوع الورشة" },
    newRepairer: { en: "New repairer…", ar: "ورشة جديدة…" },
    newRepairerType: { en: "New type…", ar: "نوع جديد…" },
    location: { en: "Location", ar: "الموقع" },
    contactName: { en: "Contact Name", ar: "اسم المسؤول" },
    contactNumber: { en: "Contact Number", ar: "رقم التواصل" },
    selectAtLeastOneRepairer: { en: "Select at least one repairer", ar: "اختر ورشة واحدة على الأقل" },
    workshopPayments: { en: "Workshop Payments", ar: "مدفوعات الورش" },
    addPayment: { en: "Add Payment", ar: "إضافة دفعة" },
    noPayments: { en: "No payments yet", ar: "لا توجد مدفوعات بعد" },
    billedBy: { en: "Billed by", ar: "فوترة من" },
    invoiceNumber: { en: "Invoice Number", ar: "رقم الفاتورة" },
    invoiceDate: { en: "Invoice Date", ar: "تاريخ الفاتورة" },
    subtotal: { en: "Subtotal", ar: "المجموع الفرعي" },
    vat: { en: "VAT", ar: "ضريبة القيمة المضافة" },
    grandTotal: { en: "Grand Total", ar: "الإجمالي" },
    actualCost: { en: "Actual Total", ar: "الإجمالي الفعلي" },
    osNoJobs: { en: "No outsourced jobs in this view", ar: "لا توجد أعمال خارجية في هذا العرض" },
    // OS adjustments batch
    all: { en: "All", ar: "الكل" },
    track: { en: "Track", ar: "المسار" },
    note: { en: "Note", ar: "ملاحظة" },
    discount: { en: "Discount", ar: "الخصم" },
    edit: { en: "Edit", ar: "تعديل" },
    delete: { en: "Delete", ar: "حذف" },
    confirmDeleteRepairer: { en: "Remove this repairer? It stays in past jobs/payments, just hidden from new ones.", ar: "إزالة هذه الورشة؟ ستبقى في الأعمال والمدفوعات السابقة، فقط تختفي من الجديدة." },
    confirmDeletePayment: { en: "Delete this payment?", ar: "حذف هذه الدفعة؟" },
    newRepairerBtn: { en: "New Repairer", ar: "ورشة جديدة" },
    editRepairer: { en: "Edit Repairer", ar: "تعديل الورشة" },
    uploadInvoice: { en: "Upload invoice", ar: "رفع فاتورة" },
    changeInvoice: { en: "Change file", ar: "تغيير الملف" },
  },
  // Global search (Polish Batch 1). `common.search` above stays as-is — it
  // is the generic per-page filter placeholder used by Fleet/Inventory/etc.
  // and is a different control from the header's global bar.
  search: {
    placeholder: {
      en: "Search trucks, drivers, invoices, parts…",
      ar: "ابحث في الشاحنات والسائقين والفواتير وقطع الغيار...",
    },
    ariaLabel: { en: "Search everything", ar: "البحث في كل شيء" },
    modeSearch: { en: "Search", ar: "بحث" },
    modeAsk: { en: "Ask", ar: "اسأل" },
    comingSoon: { en: "Coming soon", ar: "قريباً" },
    recent: { en: "Recent searches", ar: "عمليات البحث الأخيرة" },
    clearRecent: { en: "Clear", ar: "مسح" },
    noRecent: { en: "No recent searches yet.", ar: "لا توجد عمليات بحث سابقة." },
    recentAreLocal: {
      en: "Recent searches are kept in this browser only.",
      ar: "عمليات البحث الأخيرة محفوظة في هذا المتصفح فقط.",
    },
    typeToSearch: { en: "Type at least 2 characters.", ar: "اكتب حرفين على الأقل." },
    searchedAcross: {
      en: "Searched pages, trucks, drivers, staff, customers, invoices, trips, parts, orders, permits and documents.",
      ar: "تم البحث في الصفحات والشاحنات والسائقين والموظفين والعملاء والفواتير والرحلات وقطع الغيار والطلبات والتصاريح والوثائق.",
    },
    searching: { en: "Searching\u2026", ar: "\u062c\u0627\u0631\u064d \u0627\u0644\u0628\u062d\u062b\u2026" },
    // Announced to screen readers only (aria-live). "{n}" is replaced
    // at the call site; kept as a token so the Arabic word order can
    // differ from the English without a code change.
    resultsCount: { en: "{n} results", ar: "{n} \u0646\u062a\u064a\u062c\u0629" },
    noResultsShort: { en: "No results", ar: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c" },
    pages: { en: "Pages", ar: "الصفحات" },
    askTitle: { en: "Ask about your operation", ar: "اسأل عن عملياتك" },
    askBody: {
      en: "A chat assistant that answers from this app's own data will live here. It is not built yet — nothing you type is sent anywhere, and no answer is generated.",
      ar: "سيكون هنا مساعد محادثة يجيب من بيانات هذا التطبيق. لم يُبنَ بعد — لا يُرسل ما تكتبه إلى أي مكان، ولا تُولَّد أي إجابة.",
    },
    askPlaceholder: {
      en: "Chat is not available yet",
      ar: "المحادثة غير متاحة بعد",
    },
    // Entity group headings.
    g_page: { en: "Pages", ar: "الصفحات" },
    g_truck: { en: "Trucks", ar: "الشاحنات" },
    g_driver: { en: "Drivers", ar: "السائقون" },
    g_staff: { en: "Staff", ar: "الموظفون" },
    g_customer: { en: "Customers", ar: "العملاء" },
    g_project: { en: "Projects", ar: "المشاريع" },
    g_invoice: { en: "Invoices", ar: "الفواتير" },
    g_trip: { en: "Trips", ar: "الرحلات" },
    g_part: { en: "Parts", ar: "قطع الغيار" },
    g_work_order: { en: "Work Orders", ar: "أوامر العمل" },
    g_outsourced_job: { en: "Outsourced Jobs", ar: "الأعمال الخارجية" },
    g_exit_permit: { en: "Exit Permits", ar: "تصاريح الخروج" },
    g_purchase_order: { en: "Purchase Orders", ar: "أوامر الشراء" },
    g_archive_document: { en: "Archive Documents", ar: "وثائق الأرشيف" },
    g_expense: { en: "Expenses", ar: "المصروفات" },
    g_supplier: { en: "Suppliers", ar: "الموردون" },
    g_warehouse: { en: "Warehouses", ar: "المستودعات" },
    g_repairer: { en: "Repairers", ar: "الورش" },
  },

  /**
   * DB ENUM LABELS — the display text for a column whose values are a fixed
   * Postgres enum. Deliberately NOT under a route namespace, and deliberately
   * NOT merged into `status` above.
   *
   * Not under a route: the English source of each of these is a label map in
   * lib/db-types.ts (CUSTOMER_TYPE_LABELS, PAYMENT_MODE_LABELS,
   * PROJECT_STATUS_LABELS), and those maps are read from several routes —
   * app/archive/ArchiveCustomerTab.tsx, app/trips/FinanceTab.tsx,
   * app/trips/BreakdownReport.tsx and app/trips/ProjectModal.tsx as well as the
   * two converted here. A key called `customers.postpaid` would be imported by
   * the Trips finance tab in a later batch, or duplicated there.
   *
   * Not merged into `status`: that block is the StatusPill vocabulary (truck,
   * driver, trip and work-order states) and is indexed by a different set of
   * enums. `projActive` and `status.active` render the same English word today
   * and are still two different columns; collapsing them would make a future
   * rewording of one silently reword the other.
   *
   * The English values here are byte-identical to the label maps they came
   * from. The maps stay in db-types.ts as the enum's source of order and as
   * the English text — they are still read for iteration order, so a status
   * added there and not translated here is a compile error, not a silent gap.
   */
  labels: {
    // CustomerType
    custConstruction: { en: "Construction", ar: "مقاولات" },
    custGovernmentOffice: { en: "Government office", ar: "جهة حكومية" },
    custFacilityManagement: { en: "Facility management", ar: "إدارة مرافق" },
    // PaymentMode
    postpaid: { en: "Postpaid", ar: "دفع آجل" },
    prepaid: { en: "Prepaid", ar: "دفع مقدم" },
    // ProjectStatus
    projActive: { en: "Active", ar: "نشط" },
    projPaused: { en: "Paused", ar: "متوقف" },
    projEnded: { en: "Ended", ar: "منتهي" },
  },

  /**
   * ── Phase 3 Batch 2a — SHARED CHROME + SHARED FIELD COMPONENTS ───────────
   *
   * The strings that belong to `components/` rather than to any one route: the
   * app chrome (AppShell's Settings and Log out, the global search panel's own
   * words) and the field components that three different route dirs render
   * inside their own forms.
   *
   * GROUPED BY THE SURFACE THAT OWNS THE STRING, not flattened. A flat
   * `shared` would sit "Name *" from the station form next to "Name *" from a
   * customer form with nothing to tell them apart.
   *
   * Every `en` below is the EXACT literal that was in the JSX before this
   * conversion. Two things that looks like but is not:
   *   - `chrome.noMatches` keeps the CURLY quotes the English line has always
   *     used, while its Arabic keeps the straight ones IT has always used.
   *   - the multi-line JSX text nodes are stored in their COLLAPSED single-line
   *     form, because JSX joins a wrapped text run with exactly one space —
   *     the collapsed string is what actually rendered.
   *
   * `{q}` / `{name}` / `{n}` are call-site tokens, the same device as
   * `search.resultsCount`, so Arabic word order is free of the code. Every one
   * of them is substituted with a REPLACER FUNCTION rather than a string,
   * because a plain string replacement would interpret `$&` / `$1` inside a
   * value the user typed or named.
   *
   * Reused rather than duplicated here: `common.plate`, `common.actions`,
   * `common.edit`, `common.cancel`, `common.save`, `common.saving` — each is
   * already byte-identical to the literal it replaces.
   */
  shared: {
    chrome: {
      settings: { en: "Settings", ar: "الإعدادات" },
      logOut: { en: "Log out", ar: "تسجيل الخروج" },
      // Trails a global-search hit that routes to a PAGE rather than a record.
      opensPage: { en: "opens page", ar: "فتح الصفحة" },
      noMatches: { en: "No matches for “{q}”", ar: "لا توجد نتائج لـ \"{q}\"" },
    },

    // OperationStationField (the picker section) and OperationStationsModal
    // (the popup it opens). One group: they are one feature in two files, and
    // `deactivated` is genuinely rendered by both.
    stations: {
      fieldLabel: { en: "Operation station", ar: "محطة التشغيل" },
      fieldHint: {
        en: "Where this is based — the truck/driver/staff BASE, separate from water/fill stations.",
        ar: "المقر الذي تتبع له الشاحنة أو السائق أو الموظف — منفصل عن محطات المياه والتعبئة.",
      },
      // Lower-case in English on purpose: both sites uppercase it in CSS.
      deactivated: { en: "deactivated", ar: "معطّلة" },
      // Suffix on a select option whose station has since been deactivated.
      // The separating space stays in the JSX, so this is the bracketed word
      // only — otherwise the leading space would be invisible in this file.
      deactivatedParen: { en: "(deactivated)", ar: "(معطّلة)" },
      manage: { en: "Manage stations", ar: "إدارة المحطات" },
      title: { en: "Operation stations", ar: "محطات التشغيل" },
      subtitle: {
        en: "Where a driver, truck, or staff member is based. Separate from water/fill stations.",
        ar: "المقر الذي يتبع له السائق أو الشاحنة أو الموظف. منفصل عن محطات المياه والتعبئة.",
      },
      thName: { en: "Name", ar: "الاسم" },
      thCoordinates: { en: "Coordinates", ar: "الإحداثيات" },
      none: { en: "No active stations.", ar: "لا توجد محطات نشطة." },
      deactivate: { en: "Deactivate", ar: "تعطيل" },
      deactivating: { en: "Deactivating…", ar: "جارٍ التعطيل…" },
      confirmTitle: { en: "Deactivate \"{name}\"?", ar: "تعطيل \"{name}\"؟" },
      confirmBody: {
        en: "It disappears from every station picker. A driver, truck, or staff member already based here keeps showing it (marked \"deactivated\") until changed — nothing breaks.",
        ar: "ستختفي من كل قوائم اختيار المحطات. وستظل ظاهرة لأي سائق أو شاحنة أو موظف يتبعها بالفعل (موسومة بـ \"معطّلة\") إلى أن تُغيَّر — دون أن يتعطل شيء.",
      },
      hide: { en: "Hide", ar: "إخفاء" },
      show: { en: "Show", ar: "إظهار" },
      // Follows Hide/Show and precedes a Latin count:
      // "Show deactivated stations (3)".
      deactivatedStations: { en: "deactivated stations", ar: "المحطات المعطّلة" },
      add: { en: "Add station", ar: "إضافة محطة" },
      close: { en: "Close", ar: "إغلاق" },
      edit: { en: "Edit station", ar: "تعديل محطة" },
      fName: { en: "Name *", ar: "الاسم *" },
      fLatitude: { en: "Latitude", ar: "خط العرض" },
      fLongitude: { en: "Longitude", ar: "خط الطول" },
      // Sample coordinates stay Latin numerals — the standing rule.
      phLatitude: { en: "e.g. 24.7136", ar: "مثال: 24.7136" },
      phLongitude: { en: "e.g. 46.6753", ar: "مثال: 46.6753" },
      // StationForm's own client-side guard. The SERVER action's messages stay
      // English this batch — same boundary as `customers.loadFailed`.
      nameRequired: { en: "Station name is required.", ar: "اسم المحطة مطلوب." },
      saveChanges: { en: "Save changes", ar: "حفظ التغييرات" },
    },

    company: {
      title: { en: "Company settings", ar: "إعدادات الشركة" },
      subtitle: {
        en: "Seller identity — appears in the Seller section of every invoice header.",
        ar: "هوية البائع — تظهر في قسم البائع في ترويسة كل فاتورة.",
      },
      loading: { en: "Loading…", ar: "جارٍ التحميل…" },
      fLegalName: { en: "CR Company Name *", ar: "اسم الشركة في السجل التجاري *" },
      // The SAMPLE stays Latin in both languages: this field holds the Latin CR
      // name and `fLegalNameAr` below holds the Arabic one. That Arabic field's
      // own placeholder ("مجموعة بن سليمة") is not keyed at all — it is sample
      // DATA for an Arabic-only column, not UI copy, and must not flip to
      // English when the interface does.
      phLegalName: { en: "e.g. Bin Slimah Group", ar: "مثال: Bin Slimah Group" },
      fLegalNameAr: { en: "Company name (Arabic)", ar: "اسم الشركة (بالعربية)" },
      fDescription: { en: "Description", ar: "الوصف" },
      phDescription: { en: "e.g. Water transport & treatment", ar: "مثال: نقل ومعالجة المياه" },
      fCrNumber: { en: "CR Number", ar: "رقم السجل التجاري" },
      fVatNumber: { en: "VAT Registration Number", ar: "الرقم الضريبي" },
      fAddress: { en: "Address", ar: "العنوان" },
      fTelephone: { en: "Telephone (landline)", ar: "الهاتف (أرضي)" },
      fPhone: { en: "Phone (mobile)", ar: "الجوال" },
      fEmail: { en: "Company email", ar: "البريد الإلكتروني للشركة" },
      phEmail: { en: "e.g. info@binslimah.com", ar: "مثال: info@binslimah.com" },
      operations: { en: "Operations", ar: "العمليات" },
      fWorkingDays: { en: "Working days per month", ar: "أيام العمل في الشهر" },
      workingDaysHint: {
        en: "Used to turn a mechanic's per-day duty hours into monthly hours for Maintenance labor costing.",
        ar: "تُستخدم لتحويل ساعات دوام الفني اليومية إلى ساعات شهرية في احتساب تكلفة عمالة الصيانة.",
      },
      saved: { en: "Saved", ar: "تم الحفظ" },
    },

    fields: {
      // LinkedIdField's link out to the one screen that DOES edit the value —
      // see that file's header for why it is read-only where it is shown.
      editInArchive: { en: "Edit in the Archive", ar: "التعديل في الأرشيف" },
      // PlateInput's per-box screen-reader names; `{n}` is the 1-based column.
      // The VISIBLE label reuses `common.plate`, which is already "Plate".
      plateLetterAria: { en: "Plate letter {n}", ar: "حرف اللوحة {n}" },
      plateDigitAria: { en: "Plate digit {n}", ar: "رقم اللوحة {n}" },
    },
  },

  // ── Phase 3 Batch 1 — per-route screen copy ──────────────────────────────
  // One namespace per route. Every `en` value below is the EXACT literal that
  // was in the JSX before the conversion, so English output is unchanged.

  customers: {
    title: { en: "Customers", ar: "العملاء" },
    subtitle: {
      en: "Organizations that order water deliveries.",
      ar: "الجهات التي تطلب توريد المياه.",
    },
    // Prefix only — the message that follows it comes from Supabase and is
    // out of scope for this MVP (server-action and DB text stay English).
    loadFailed: { en: "Failed to load customers:", ar: "تعذر تحميل العملاء:" },
    newCustomer: { en: "New customer", ar: "عميل جديد" },
    editCustomer: { en: "Edit customer", ar: "تعديل عميل" },
    thName: { en: "Name", ar: "الاسم" },
    thContact: { en: "Contact", ar: "جهة الاتصال" },
    thPhone: { en: "Phone", ar: "الهاتف" },
    thPayment: { en: "Payment", ar: "الدفع" },
    empty: {
      en: "No customers yet. Create the first one.",
      ar: "لا يوجد عملاء بعد. أنشئ أول عميل.",
    },
    inactive: { en: "Inactive", ar: "غير نشط" },
    fName: { en: "Name *", ar: "الاسم *" },
    fNameAr: { en: "Name (Arabic)", ar: "الاسم (بالعربية)" },
    fType: { en: "Customer type *", ar: "نوع العميل *" },
    fContactName: { en: "Contact name", ar: "اسم جهة الاتصال" },
    fAddress: { en: "Delivery site address", ar: "عنوان موقع التسليم" },
    fLat: { en: "Delivery latitude", ar: "خط عرض التسليم" },
    fLng: { en: "Delivery longitude", ar: "خط طول التسليم" },
  },

  projects: {
    title: { en: "Projects", ar: "المشاريع" },
    subtitle: {
      en: "Delivery contracts tied to a customer.",
      ar: "عقود التوريد المرتبطة بعميل.",
    },
    loadFailed: { en: "Failed to load projects:", ar: "تعذر تحميل المشاريع:" },
    newProject: { en: "New project", ar: "مشروع جديد" },
    editProject: { en: "Edit project", ar: "تعديل مشروع" },
    needCustomer: {
      en: "Create a customer first — projects must belong to a customer.",
      ar: "أنشئ عميلاً أولاً — كل مشروع يجب أن يتبع عميلاً.",
    },
    thProject: { en: "Project", ar: "المشروع" },
    thCustomer: { en: "Customer", ar: "العميل" },
    thDates: { en: "Dates", ar: "التواريخ" },
    empty: { en: "No projects yet.", ar: "لا توجد مشاريع بعد." },
    // The end-date cell when a project has no end date. A word, not a status:
    // it reads "2026-01-04 → open".
    openEnded: { en: "open", ar: "مفتوح" },
    drivers: { en: "Drivers", ar: "السائقون" },
    fName: { en: "Name *", ar: "الاسم *" },
    fCustomer: { en: "Customer *", ar: "العميل *" },
    fStartDate: { en: "Start date", ar: "تاريخ البدء" },
    fEndDate: {
      en: "End date (blank = open-ended)",
      ar: "تاريخ الانتهاء (فارغ = مفتوح)",
    },
    manageDrivers: { en: "Manage drivers", ar: "إدارة السائقين" },
    // Trails a Latin count: "Riyadh North · 4 selected".
    selectedCount: { en: "selected", ar: "محدد" },
  },

  // The login screen renders OUTSIDE the app chrome (AppShell returns early
  // for /login), but inside the language context — see the note at that early
  // return. The brand block above the form is translate="no" and has no keys
  // here on purpose: "Bousla" and "Bin Slimah Group · Operations" are a name.
  login: {
    signIn: { en: "Sign in", ar: "تسجيل الدخول" },
    email: { en: "Email", ar: "البريد الإلكتروني" },
    password: { en: "Password", ar: "كلمة المرور" },
    signingIn: { en: "Signing in…", ar: "جارٍ تسجيل الدخول…" },
  },
} as const;

/**
 * A translation LEAF — the `{ en, ar }` pair that `t()` actually reads from.
 * Anything in `dict` that is not this shape is a namespace to recurse into.
 */
type Leaf = { readonly en: string; readonly ar: string };

/**
 * Every dotted path in `dict` that ends at a leaf, as a union of string
 * literals: "appName" | "nav.dashboard" | … | "search.g_repairer".
 *
 * Derived FROM the dictionary, never hand-listed — add a key above and it is
 * callable immediately; delete one and every caller breaks at compile time
 * instead of quietly printing its own path on screen.
 */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

export type TKey = LeafPaths<typeof dict>;

/**
 * The tails of every key under one prefix. `SubKeys<"nav.">` is
 * "dashboard" | "fleet" | … ; `SubKeys<"search.g_">` is "page" | "truck" | …
 *
 * For code that builds a key from a value — `t(\`nav.${item.key}\`)` — this is
 * what types that value, so the interpolation produces a real TKey instead of
 * a `\`nav.${string}\`` the compiler has to reject.
 *
 * The `K = TKey` parameter is load-bearing: a conditional type only spreads
 * across a union when the checked side is a NAKED TYPE PARAMETER. Written
 * inline as `TKey extends \`nav.${infer R}\` ? R : never` it does not
 * distribute — the whole union does not match the pattern, only its members do
 * — and the answer silently collapses to `never`.
 */
export type SubKeys<Prefix extends string, K = TKey> =
  K extends `${Prefix}${infer Rest}` ? Rest : never;

/**
 * The `??`/`if (!node)` fallbacks below are now UNREACHABLE for any typed
 * caller — a bad path stops at `tsc`, not at render time. They stay as a
 * backstop for the one thing types cannot cover: `dict` is data, and a future
 * edit could leave a namespace with no `en`/`ar` pair under it. Printing the
 * path beats throwing inside a render.
 */
export function t(path: TKey, lang: Lang): string {
  const parts = path.split(".");
  let node: any = dict;
  for (const p of parts) node = node?.[p];
  if (!node) return path;
  return (node as any)[lang] ?? path;
}

// `t()` above translates STATIC copy from the dictionary. `arText()` below is
// its counterpart for ROW DATA — the per-record Arabic columns: name_ar,
// title_ar, description_ar, label_ar.
//
// One rule, everywhere: show the Arabic value only when the UI is in Arabic AND
// that value is really there — non-null and non-empty AFTER a trim. A row saved
// with "  " therefore falls back to the base column instead of rendering an
// empty cell. In English it returns `base` untouched, so every adopting site is
// byte-identical to what it printed before.
//
// It replaces four hand-rolled patterns that had drifted apart across the app:
//   x.name_ar || x.name                             null+empty safe, not trimmed
//   x.name_ar ?? x.name                             BLANK on an empty string
//   lang === "ar" && x.name_ar ? x.name_ar : x.name correct, not trimmed
//   lang === "ar" ? x.title_ar : x.title            no fallback at all
//
// Trim-awareness is belt-and-braces, not a live bug fix: every Arabic-name
// writer was audited for this commit and all of them already trim before the
// ""-to-null coercion (`str()` in the customers/drivers actions trims, and the
// inventory/repairer/settings writers use `?.trim() || null`), so no code path
// today can store "  ". The rule belongs in the reader anyway — it costs
// nothing, and it means one careless future writer cannot blank a name.
//
// DISPLAY ONLY. Never use this for a sort key, a lookup/match key, a dedupe
// map, or a type-to-confirm gate — those compare against the base column and
// must stay language-independent, or an Arabic-mode user is comparing a string
// the rest of the system never sees.
export function arText(base: string, ar: string | null | undefined, lang: Lang): string {
  if (lang !== "ar") return base;
  const trimmed = ar?.trim();
  return trimmed ? trimmed : base;
}
