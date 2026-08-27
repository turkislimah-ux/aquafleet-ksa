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
    // In `common`, not `fleet`: formatUtilization() is the single writer of this
    // token and BOTH the Dashboard and Fleet render it, so a fleet-scoped key
    // would misdescribe itself the first time the Dashboard called it.
    na: { en: "N/A", ar: "غير متاح" },
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
    // Added in Phase 3 Batch 2b, on the same test the three above were added
    // under: a string earns `common` by appearing in MORE THAN ONE of the files
    // that batch converted. Loading and Try again are in four of the five
    // Settings panels, Saved in three, Note in two — every one of them already
    // spelled the same way in both languages, so keying them per-panel would
    // have minted four near-identical entries a reword would have to find.
    //
    // `loading` and `saved` also ABSORBED `shared.company.loading` /
    // `shared.company.saved`, which held byte-identical pairs and had exactly
    // one caller each (CompanySettingsSection). Two keys for one string is the
    // duplication this batch was told to avoid, so the old pair is gone and
    // that caller now reads these. Nothing else referenced them.
    loading: { en: "Loading…", ar: "جارٍ التحميل…" },
    tryAgain: { en: "Try again", ar: "إعادة المحاولة" },
    saved: { en: "Saved", ar: "تم الحفظ" },
    note: { en: "Note", ar: "ملاحظة" },
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
      ar: "تم البحث في الصفحات والشاحنات والسائقين والموظفين والعملاء والفواتير والرحلات وقطع الغيار والطلبات والأذونات والوثائق.",
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
    g_exit_permit: { en: "Exit Permits", ar: "أذونات الخروج" },
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
      // `loading` and `saved` used to sit here. Both moved to `common` in Batch
      // 2b — the four other Settings panels print the same two strings, and one
      // panel's namespace is the wrong home for copy five of them share.
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

  // ── Phase 3 Batch 2b — the Settings dialog's five panels ──────────────────
  //
  // NOTHING HERE WAS TRANSLATED. Every `ar` value below was already written, by
  // hand, in the JSX of the panel it belongs to — this batch moved the pairs out
  // of `{ar ? "…" : "…"}` ternaries and out of parallel `labelAr`/`helpAr` object
  // fields, unchanged in both directions. Every `en` value is the exact literal
  // that was on screen before, so English output is byte-identical.
  //
  // WHERE A STRING LIVES. It goes to `common` if it appears in MORE THAN ONE of
  // the five panels, and stays in its panel's block if it appears in exactly one
  // — the same test Batch 1 used, and the reason `common` gained loading /
  // tryAgain / saved / note and nothing else. Panel-local keys are kept even
  // when another namespace already renders the same English word, per the rule
  // `labels`' header states: two keys that happen to match today are still two
  // columns, and collapsing them makes a future reword of one silently reword
  // the other.
  //
  // Reached OUT of this namespace on purpose, because the pair is byte-identical
  // and already exists: `shared.chrome.settings` (the dialog title — the same
  // string the sidebar button that opens it already prints), `common.save`,
  // `common.saving`, `common.cancel`, `common.edit`, `common.type`,
  // `common.status`, `common.note`, `common.loading`, `common.tryAgain`,
  // `common.saved`.
  //
  // `shared.stations.close` was NOT reached for. Close appears in one panel
  // here, so by the rule above it stays local as `settings.close` — the stations
  // modal's copy is that feature's own.
  settings: {
    // Rail labels, keyed by `SectionKey` so SettingsModal can build the path
    // from the value it already has: t(`settings.nav.${s.key}`). Same shape as
    // `nav` and `search.g_*`.
    //
    // A rail label is NOT the panel heading it opens, and Arabic is where that
    // stops being pedantic: this reads "الملف" and the Profile panel's own h2
    // reads "الملف الشخصي". Two strings, deliberately.
    nav: {
      company: { en: "Company", ar: "الشركة" },
      warehouses: { en: "Warehouses", ar: "المستودعات" },
      notifications: { en: "Notifications", ar: "الإشعارات" },
      profile: { en: "Profile", ar: "الملف" },
      issues: { en: "Report a problem", ar: "الإبلاغ عن مشكلة" },
    },
    close: { en: "Close", ar: "إغلاق" },

    notifications: {
      title: { en: "Notifications", ar: "الإشعارات" },
      subtitle: {
        en: "Yours alone — these never change what the other user sees.",
        ar: "تخصّك وحدك — لا تؤثر على المستخدم الآخر.",
      },
      whatShows: { en: "What shows", ar: "ما الذي يظهر" },
      savedInstantly: {
        en: "Saved instantly. Hiding a level does not delete those alerts — it only hides them from you.",
        ar: "يُحفظ فورًا. إخفاء مستوى لا يحذف التنبيهات — يخفيها عنك فقط.",
      },
      whenFire: { en: "When they fire", ar: "متى تظهر" },
      custom: { en: "Custom", ar: "مخصّص" },
      default: { en: "Default", ar: "افتراضي" },
      reset: { en: "Reset to default", ar: "استعادة الافتراضي" },
      // `{n}` is the inherited shared default. Latin numerals in both languages
      // — the standing rule for figures this app formats.
      sharedDefault: {
        en: "Shared default: {n} — leave blank to use it.",
        ar: "الافتراضي المشترك: {n} — اتركه فارغًا لاستخدامه.",
      },
      // `{label}` is the field's own label from the f_* block below. The English
      // half used to interpolate `THRESHOLD_BOUNDS[key].label` while the Arabic
      // half interpolated the component's `labelAr` — two sources for one slot.
      // They are byte-identical strings, which is why one key can now feed both.
      notANumber: { en: "{label}: not a number.", ar: "{label}: قيمة غير صالحة." },

      // The four threshold rows: f_ is the label, h_ the help line under it.
      // Keyed by `ThresholdKey` so FIELDS can hold nothing but a key and a step.
      f_low_runway_trips: { en: "Low balance warning", ar: "تحذير قرب نفاد الرصيد" },
      h_low_runway_trips: {
        en: "Warn when a prepaid wallet holds fewer than this many trips' worth of work.",
        ar: "تنبيه عندما يقل رصيد العميل عن هذا العدد من الرحلات.",
      },
      f_doc_expiry_lead_days: { en: "Document expiry notice", ar: "مهلة انتهاء المستندات" },
      h_doc_expiry_lead_days: {
        en: "How many days before a licence, iqama or registration expires to start warning.",
        ar: "عدد الأيام قبل انتهاء الرخصة أو الإقامة أو الاستمارة لبدء التنبيه.",
      },
      f_maintenance_stuck_days: { en: "Work order stuck after", ar: "أمر الصيانة متعثر بعد" },
      h_maintenance_stuck_days: {
        en: "An open work order older than this is flagged as stuck.",
        ar: "أمر صيانة مفتوح أطول من هذه المدة يُعتبر متعثرًا.",
      },
      f_invoice_overdue_red_days: { en: "Invoice turns red after", ar: "الفاتورة تصبح حمراء بعد" },
      h_invoice_overdue_red_days: {
        en: "Overdue longer than this escalates the invoice alert from yellow to red.",
        ar: "التأخر أكثر من هذه المدة يرفع تنبيه الفاتورة من الأصفر إلى الأحمر.",
      },

      // The three severity toggles, keyed by `Severity`. sev_ is the switch
      // label, sevHint_ the line under it.
      sev_red: { en: "Act today", ar: "عاجل" },
      sevHint_red: { en: "Money and compliance", ar: "المال والامتثال" },
      sev_yellow: { en: "This week", ar: "هذا الأسبوع" },
      sevHint_yellow: { en: "Coming up, not urgent", ar: "قادم وغير عاجل" },
      sev_blue: { en: "For info", ar: "للعلم" },
      sevHint_blue: { en: "Never counted in the badge", ar: "لا تُحتسب في العداد" },
    },

    warehouses: {
      title: { en: "Warehouses", ar: "المستودعات" },
      subtitle: {
        en: "Where parts are stored. Parts, purchase orders, receipts and exit permits are all tracked per warehouse.",
        ar: "أماكن تخزين القطع. تُتتبَّع القطع وأوامر الشراء والاستلامات وأذون الخروج لكل مستودع.",
      },
      add: { en: "Add warehouse", ar: "إضافة مستودع" },
      newTitle: { en: "New warehouse", ar: "مستودع جديد" },
      create: { en: "Create warehouse", ar: "إنشاء المستودع" },
      editTitle: { en: "Edit warehouse", ar: "تعديل المستودع" },
      saveChanges: { en: "Save changes", ar: "حفظ التغييرات" },
      // The section's own client-side guard and its two write failures. The
      // SERVER action's messages stay English — same boundary Batch 1 drew.
      nameRequired: { en: "Warehouse name is required.", ar: "اسم المستودع مطلوب." },
      createFailed: { en: "Could not create warehouse.", ar: "تعذّر إنشاء المستودع." },
      saveFailed: { en: "Could not save changes.", ar: "تعذّر حفظ التغييرات." },
      empty: {
        en: "No warehouses yet. Add one to start tracking parts and stock.",
        ar: "لا توجد مستودعات بعد. أضف واحدًا لبدء تتبع القطع والمخزون.",
      },
      // The QUOTE MARKS DIFFER BY LANGUAGE and that is not a typo to tidy: the
      // English literal has always used curly “ ”, the Arabic straight ". Both
      // are copied exactly as they were, because English output has to be
      // byte-identical and the Arabic was written that way on purpose.
      // `{name}` is the warehouse's own name — user data, substituted through a
      // replacer FUNCTION so a `$&` in a name cannot re-expand.
      confirmDelete: { en: "Delete “{name}”?", ar: "حذف \"{name}\"؟" },
      confirmBody: {
        en: "Nothing points at this warehouse, so it can be removed. This cannot be undone.",
        ar: "لا شيء يشير إلى هذا المستودع، لذا يمكن إزالته. لا يمكن التراجع عن هذا.",
      },
      deleting: { en: "Deleting…", ar: "جارٍ الحذف…" },
      delete: { en: "Delete", ar: "حذف" },
      lockedNote: {
        en: "A warehouse can only be deleted while nothing points at it. Once it has parts, receipts, purchase orders or exit permits, its history keeps it.",
        ar: "يمكن حذف المستودع فقط ما دام لا شيء يشير إليه. بمجرد أن تصبح لديه قطع أو استلامات أو أوامر شراء أو أذون خروج، يبقيه سجلّه.",
      },
      // The four form fields. Type and Note reuse `common`; only the two labels
      // with no `common` twin, plus all four placeholders, live here.
      fName: { en: "Name *", ar: "الاسم *" },
      phName: { en: "e.g. Riyadh Depot", ar: "مثال: مستودع الرياض" },
      fLocation: { en: "Location", ar: "الموقع" },
      phLocation: { en: "e.g. Riyadh", ar: "مثال: الرياض" },
      phType: { en: "e.g. Main depot", ar: "مثال: مستودع رئيسي" },
      phNote: { en: "What is stored here", ar: "ما الذي يُخزَّن هنا" },
    },

    profile: {
      // "الملف الشخصي" here, "الملف" in `nav` above — see that block's note.
      title: { en: "Profile", ar: "الملف الشخصي" },
      subtitle: {
        en: "Yours alone — you are the only one who can see or change this.",
        ar: "تخصّك وحدك — أنت الوحيد الذي يراه أو يعدّله.",
      },
      photoAlt: { en: "Your photo", ar: "صورتك" },
      uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
      changePhoto: { en: "Change photo", ar: "تغيير الصورة" },
      addPhoto: { en: "Add photo", ar: "إضافة صورة" },
      removePhoto: { en: "Remove", ar: "إزالة" },
      // The Arabic size limit is written ٢ — an Arabic-Indic numeral — in the
      // original copy, and it is LIFTED AS IT WAS RATHER THAN LATINISED. The
      // Latin-numerals rule governs figures this app FORMATS from data; this one
      // is a hand-written sentence, and rewriting it here would be re-authoring
      // the panel's Arabic under cover of a mechanical move. Same for the ٥ in
      // `issues.attachHint`.
      //
      // RULED ON — do not re-raise. Arabic-Indic digits STAY in hand-written
      // copy. The Latin-numerals rule covers figures this app FORMATS from data:
      // `notifications.sharedDefault`'s `{n}`, `profile.hNewPassword`'s `{n}`.
      // Those two are substitutions; these two are sentences someone wrote.
      photoHint: {
        en: "JPEG, PNG, WebP or GIF, up to 2 MB. Saved as soon as you pick it.",
        ar: "JPEG أو PNG أو WebP أو GIF، بحد أقصى ٢ ميجابايت. تُحفظ فور اختيارها.",
      },
      gAccount: { en: "Account", ar: "الحساب" },
      fDisplayName: { en: "Display name", ar: "الاسم المعروض" },
      hDisplayName: { en: "Shown in the header, top right.", ar: "يظهر في الشريط العلوي." },
      phDisplayName: { en: "How your name should appear", ar: "كيف تريد أن يظهر اسمك" },
      fLoginEmail: { en: "Login email", ar: "بريد تسجيل الدخول" },
      hLoginEmail: { en: "Not changeable here.", ar: "لا يمكن تغييره من هنا." },
      gPersonal: { en: "Personal info", ar: "معلومات شخصية" },
      fJobTitle: { en: "Job title", ar: "المسمى الوظيفي" },
      hJobTitle: {
        en: "How you describe yourself. It grants no permissions.",
        ar: "وصف تعرّف به نفسك فقط — لا يمنح أي صلاحية.",
      },
      // Lower-case n. `mt.contactNumber` is "Contact Number" with a capital N,
      // so it is a DIFFERENT string and reusing it would change English output.
      fContactNumber: { en: "Contact number", ar: "رقم التواصل" },
      fPersonalEmail: { en: "Personal email", ar: "بريد شخصي" },
      hEmailWarn: {
        en: "That does not look like an email — it will still be saved.",
        ar: "لا يبدو كبريد إلكتروني — سيُحفظ كما هو.",
      },
      gEmergency: { en: "Emergency contact", ar: "جهة اتصال للطوارئ" },
      fEmergencyName: { en: "Name", ar: "الاسم" },
      fEmergencyNumber: { en: "Number", ar: "الرقم" },
      emergencyHint: {
        en: "Shared with colleagues in an emergency. Not the official HR record.",
        ar: "تشاركها مع زملائك للطوارئ — ليست سجل الموارد البشرية الرسمي.",
      },
      fAbout: { en: "About", ar: "نبذة" },
      gPreferences: { en: "Preferences", ar: "التفضيلات" },
      fLandingPage: { en: "Landing page", ar: "صفحة البداية" },
      hLandingPage: { en: "Where you land after signing in.", ar: "الصفحة التي تفتح بعد تسجيل الدخول." },
      // The empty option on BOTH selects below. One key, two call sites — it is
      // the same sentence meaning the same thing in both.
      noPreference: { en: "No preference", ar: "بدون تفضيل" },
      fPreferredLanguage: { en: "Preferred language", ar: "اللغة المفضلة" },
      hPreferredLanguage: {
        en: "A label only. To change the interface language, use the toggle in the header.",
        ar: "ملصق فقط. لتغيير لغة الواجهة استخدم زر اللغة في الأعلى.",
      },
      gPassword: { en: "Password", ar: "كلمة المرور" },
      fCurrentPassword: { en: "Current password", ar: "كلمة المرور الحالية" },
      hCurrentPassword: {
        en: "Required, so an unattended screen cannot change it.",
        ar: "مطلوبة للتأكد أنك أنت.",
      },
      fNewPassword: { en: "New password", ar: "كلمة المرور الجديدة" },
      // `{n}` is MIN_PASSWORD_LENGTH — one definition in lib/profile.ts, so the
      // hint cannot drift from the validator that enforces it.
      hNewPassword: { en: "At least {n} characters.", ar: "{n} أحرف على الأقل." },
      fConfirmPassword: { en: "Confirm new password", ar: "تأكيد كلمة المرور" },
      passwordChanged: { en: "Password changed", ar: "تم تغيير كلمة المرور" },
      changing: { en: "Changing…", ar: "جارٍ التغيير…" },
      changePassword: { en: "Change password", ar: "تغيير كلمة المرور" },
      boundaryNote: {
        en: "This is information you enter yourself. It is not linked to your employee file — no iqama, salary or leave.",
        ar: "هذه معلومات تُدخلها بنفسك. لا ترتبط بملف الموظف — لا إقامة ولا راتب ولا إجازات.",
      },
    },

    issues: {
      title: { en: "Report a problem", ar: "الإبلاغ عن مشكلة" },
      subtitle: {
        en: "A shared list — you both see every report and either can resolve it.",
        ar: "قائمة مشتركة — كلاكما يرى كل البلاغات ويستطيع حلّها.",
      },
      tabReport: { en: "New report", ar: "بلاغ جديد" },
      tabQueue: { en: "Queue", ar: "القائمة" },
      kind: { en: "What kind of problem?", ar: "ما نوع المشكلة؟" },
      fTitle: { en: "Short title *", ar: "عنوان قصير *" },
      phTitle: { en: "e.g. Save button does nothing", ar: "مثال: زر الحفظ لا يستجيب" },
      fDetails: { en: "Details", ar: "التفاصيل" },
      phDetails: {
        en: "What were you trying to do, and what happened instead?",
        ar: "ماذا كنت تحاول أن تفعل؟ وماذا حدث بدلًا من ذلك؟",
      },
      removeAttachment: { en: "Remove attachment", ar: "إزالة المرفق" },
      attach: { en: "Attach a screenshot", ar: "إرفاق لقطة شاشة" },
      // Carries an Arabic-Indic ٥ — see `profile.photoHint` for why it is lifted
      // rather than converted.
      attachHint: {
        en: "Optional. JPEG, PNG, WebP or GIF, up to 5 MB.",
        ar: "اختياري. JPEG أو PNG أو WebP أو GIF، بحد أقصى ٥ ميجابايت.",
      },
      filedAgainst: { en: "Filed against:", ar: "سيُرفق مع البلاغ:" },
      sent: { en: "Sent", ar: "تم الإرسال" },
      seeIt: { en: "See it", ar: "عرضه" },
      sending: { en: "Sending…", ar: "جارٍ الإرسال…" },
      send: { en: "Send report", ar: "إرسال" },
      empty: { en: "No reports. That is the good outcome.", ar: "لا توجد بلاغات. جيد." },
      // Not a name — see this panel's header for why the queue cannot resolve
      // another person's uuid to one.
      you: { en: "You", ar: "أنت" },
      someoneElse: { en: "Someone else", ar: "زميلك" },
      imageLoading: { en: "Loading image…", ar: "جارٍ تحميل الصورة…" },
      attachmentAlt: { en: "Report attachment", ar: "مرفق البلاغ" },
      imageFailed: { en: "The image could not be loaded.", ar: "تعذّر تحميل الصورة." },
      // The note field's other name, shown while the status is needs_info. Its
      // default name is `common.note`.
      needsInfoLabel: { en: "What do you need to know?", ar: "ما المطلوب توضيحه؟" },
      // THE SPACES IN THESE THREE ARE LOAD-BEARING. The resolved stamp is
      // assembled from three JSX fragments around a timestamp — "Resolved " +
      // date + " by you" — so the prefix ends with a space and the two suffixes
      // start with one. Trimming any of them runs the words into the date.
      resolvedPrefix: { en: "Resolved ", ar: "تم الحل في " },
      byYou: { en: " by you", ar: " — بواسطتك" },
      bySomeoneElse: { en: " by someone else", ar: " — بواسطة زميلك" },
    },
  },

  // -------------------------------------------------------------------------
  // DASHBOARD (app/page.tsx, app/DashboardClient.tsx, lib/dashboard.ts).
  //
  // WHY SO MANY NEAR-DUPLICATES. Several English labels here repeat a word
  // that already exists elsewhere in this file while carrying DIFFERENT
  // Arabic, because the author wrote each one for its own context. They are
  // kept apart deliberately — collapsing them would silently retranslate a
  // label Turki approved:
  //   · `nav.dashboard` / `nav.fleet`   rail entries, not page headings
  //   · `status.*`                      the Trips vocabulary, not this page's
  //   · `navLandmark.soon`  "Coming Soon" / "قريبًا"  vs
  //     `dashboard.summaries.comingSoon` "Coming soon" / "قريباً"
  //   · fleetState / driverMix / driverState  all read "Active" in English and
  //     "نشطة" / "في الخدمة" / "نشط" in Arabic — a truck, a headcount and a
  //     single driver are three different things being described.
  //   · actions.heading "يحتاج إلى إجراء" vs headline.open_actions.label
  //     "يحتاج إجراء" — a section heading and a KPI tile.
  // Three separate "no data" pairs exist for the same reason; see each one.
  //
  // `{n}`-style tokens are filled by the CALLER with a replacer function, never
  // by string concatenation — see the `fill()` helper in DashboardClient.
  // -------------------------------------------------------------------------
  dashboard: {
    title: { en: "Dashboard", ar: "لوحة التحكم" },
    subtitle: {
      en: "What needs action, what changed, where things stand",
      ar: "ما يحتاج إلى إجراء، وما استجدّ، والوضع الآن",
    },
    addSummary: { en: "Add summary", ar: "إضافة ملخص" },
    // The error text is appended straight after this, so the trailing space
    // and colon are part of the string. Trimming runs the words together.
    loadFailed: { en: "Failed to load the dashboard: ", ar: "تعذّر تحميل اللوحة: " },
    kpiHeading: { en: "Key figures", ar: "المؤشرات" },
    fullAnalysis: { en: "Full analysis in Reports →", ar: "التحليل الكامل في التقارير ←" },
    overview: { en: "Overview", ar: "نظرة عامة" },
    // Card subtitle prefix — "daily — " + the month title. Trailing space and
    // em dash are the separator, so they travel with the word.
    dailyPrefix: { en: "daily — ", ar: "يومياً — " },
    daily: { en: "daily", ar: "يومياً" },

    /** KPI tiles. Keys mirror `Headline["key"]` so `t()` type-checks. */
    headline: {
      revenue: {
        label: { en: "Revenue", ar: "الإيرادات" },
        sub: { en: "this month, net of VAT", ar: "هذا الشهر، بدون الضريبة" },
      },
      operating_margin: {
        label: { en: "Operating margin", ar: "هامش التشغيل" },
        sub: { en: "this month", ar: "هذا الشهر" },
      },
      net_profit: {
        label: { en: "Net profit", ar: "صافي الربح" },
        sub: { en: "after manual expenses", ar: "بعد المصروفات اليدوية" },
      },
      collections: {
        label: { en: "Collected", ar: "المحصّل" },
        sub: { en: "cash in, this month", ar: "نقد وارد هذا الشهر" },
      },
      receivables_outstanding: {
        label: { en: "Outstanding", ar: "مستحقات" },
        sub: { en: "owed right now", ar: "مستحق الآن" },
      },
      operations: {
        label: { en: "Trips delivered", ar: "الرحلات المسلَّمة" },
        sub: { en: "this month", ar: "هذا الشهر" },
      },
      trips_in_flight: {
        label: { en: "Trips in flight", ar: "رحلات جارية" },
        sub: { en: "right now", ar: "الآن" },
      },
      open_actions: {
        label: { en: "Needs action", ar: "يحتاج إجراء" },
        sub: { en: "items waiting", ar: "عنصر بالانتظار" },
      },
    },

    /** Chart series and axis labels. */
    series: {
      deliveredRevenue: { en: "Delivered revenue", ar: "إيرادات مُسلَّمة" },
      directCost: { en: "Direct cost", ar: "التكلفة المباشرة" },
      // The Arabic keeps its Arabic-Indic ٣ — the author's own, and copy is
      // not subject to the Latin-figures rule (that covers formatted values).
      capacityM3: { en: "Capacity dispatched (m³)", ar: "السعة المُشغَّلة (م٣)" },
      tripsDelivered: { en: "Trips delivered", ar: "الرحلات المسلَّمة" },
      tripsAxis: { en: "trips", ar: "رحلات" },
    },

    revVsCost: {
      title: {
        en: "Delivered revenue vs direct cost",
        ar: "الإيراد المُسلَّم مقابل التكلفة المباشرة",
      },
    },
    costMix: {
      title: { en: "Cost mix", ar: "مزيج التكلفة" },
      sub: { en: "this month — operating cost", ar: "هذا الشهر — تكلفة التشغيل" },
    },
    deliveryOutput: {
      title: { en: "Delivery Output", ar: "ناتج التوصيل" },
    },

    /** Generic chart-card states. "No data yet." here differs in Arabic from
     *  `now.empty` and `summaries.noData`; all three are the author's. */
    chart: {
      readFailed: { en: "Could not read this chart.", ar: "تعذّرت قراءة هذا الرسم." },
      empty: { en: "No data yet.", ar: "لا توجد بيانات بعد." },
    },
    monthStepper: {
      prev: { en: "Previous month", ar: "الشهر السابق" },
      next: { en: "Next month", ar: "الشهر التالي" },
    },

    /** Action-item catalogue — one entry per `kind` from
     *  v_dashboard_action_items. Keys mirror `ActionKind`. */
    action: {
      po_pending_approval: {
        label: { en: "Purchase orders awaiting approval", ar: "أوامر شراء بانتظار الموافقة" },
        hint: { en: "Two matching votes complete each one", ar: "تكتمل بموافقتين متطابقتين" },
      },
      receipt_pending_approval: {
        label: { en: "Stock receipts awaiting approval", ar: "إيصالات استلام بانتظار الموافقة" },
        hint: { en: "Received stock not yet signed off", ar: "مخزون مستلم لم يُعتمد بعد" },
      },
      consumption_pending_approval: {
        label: { en: "Consumption approvals pending", ar: "موافقات استهلاك معلقة" },
        hint: { en: "An overlay — approving moves no stock", ar: "طبقة مراجعة — الموافقة لا تحرّك المخزون" },
      },
      invoice_unpaid: {
        label: { en: "Invoices with money outstanding", ar: "فواتير عليها مبالغ مستحقة" },
        hint: { en: "Confirmed, unpaid, and still owed", ar: "مؤكدة وغير مدفوعة وما زالت مستحقة" },
      },
      trip_overdue: {
        label: { en: "Trips past their day, not delivered", ar: "رحلات تجاوزت يومها ولم تُسلَّم" },
        hint: { en: "Still scheduled, loading or in transit", ar: "ما زالت مجدولة أو تحميل أو في الطريق" },
      },
      work_order_open: {
        label: { en: "Work orders not started", ar: "أوامر عمل لم تبدأ" },
        hint: { en: "Open or waiting on parts", ar: "مفتوحة أو بانتظار قطع" },
      },
      po_awaiting_receipt: {
        label: { en: "Purchase orders awaiting receipt", ar: "أوامر شراء بانتظار الاستلام" },
        hint: { en: "Issued, stock not received yet", ar: "صادرة ولم يُستلم المخزون" },
      },
      outsourced_overdue: {
        label: { en: "Outsourced jobs past their estimate", ar: "أعمال خارجية تجاوزت الموعد المتوقع" },
        hint: { en: "Still running after the expected finish", ar: "ما زالت جارية بعد الموعد المتوقع" },
      },
      permit_return_overdue: {
        label: { en: "Exit permits past their return date", ar: "أذونات خروج تجاوزت موعد الإرجاع" },
        hint: { en: "Parts out and not returned", ar: "قطع خارجة ولم تُرجَع" },
      },
      parts_below_reorder: {
        label: { en: "Parts at or below reorder level", ar: "قطع عند حد إعادة الطلب أو دونه" },
        hint: { en: "Stock low enough to reorder", ar: "المخزون منخفض بما يستدعي إعادة الطلب" },
      },
      expiring_documents: {
        label: { en: "Documents and IDs expiring soon", ar: "وثائق وهويات تنتهي قريباً" },
        // The ٣٠ is the author's Arabic-Indic original and stays.
        hint: { en: "Within 30 days, or already past", ar: "خلال ٣٠ يوماً أو منتهية بالفعل" },
      },
    },

    /** Activity-feed verbs — one per `kind` from v_activity_feed. */
    feed: {
      trip_delivered: { en: "Trip delivered", ar: "تم تسليم رحلة" },
      invoice_confirmed: { en: "Invoice confirmed", ar: "تم تأكيد فاتورة" },
      invoice_paid: { en: "Invoice paid", ar: "تم دفع فاتورة" },
      invoice_voided: { en: "Sales return", ar: "مرتجع مبيعات" },
      work_order_opened: { en: "Work order opened", ar: "فتح أمر عمل" },
      work_order_completed: { en: "Work order completed", ar: "اكتمل أمر عمل" },
      outsourced_opened: { en: "Outsourced job opened", ar: "فتح عمل خارجي" },
      outsourced_completed: { en: "Outsourced job done", ar: "اكتمل عمل خارجي" },
      permit_exited: { en: "Parts left on permit", ar: "خروج قطع بإذن" },
      permit_voided: { en: "Exit permit voided", ar: "إلغاء إذن خروج" },
      consumption_decided: { en: "Consumption decided", ar: "تم البت في استهلاك" },
      po_issued: { en: "Purchase order issued", ar: "صدر أمر شراء" },
      po_approved: { en: "Purchase order approved", ar: "اعتُمد أمر شراء" },
      po_rejected: { en: "Purchase order rejected", ar: "رُفض أمر شراء" },
      stock_received: { en: "Stock received", ar: "استلام مخزون" },
      topup_added: { en: "Balance added", ar: "إضافة رصيد" },
      commission_paid: { en: "Commission paid", ar: "صرف عمولة" },
      expense_recorded: { en: "Expense recorded", ar: "تسجيل مصروف" },
      document_filed: { en: "Document filed", ar: "حفظ وثيقة" },
    },

    /** Trip stages on the project bars — keys mirror `STAGE_BAR`. */
    stage: {
      scheduled: { en: "Scheduled", ar: "مجدولة" },
      loading: { en: "Loading", ar: "تحميل" },
      inTransit: { en: "In transit", ar: "في الطريق" },
      delivered: { en: "Delivered", ar: "مسلَّمة" },
    },

    /** Cost buckets — keys mirror `CostSliceKey` / lib/cost-colors.ts. */
    costType: {
      parts: { en: "Parts", ar: "قطع الغيار" },
      outsourced: { en: "Outsourced", ar: "أعمال خارجية" },
      payroll: { en: "Payroll", ar: "الرواتب" },
      commissions: { en: "Commissions", ar: "العمولات" },
      filling: { en: "Station fill", ar: "تعبئة المحطة" },
      other: { en: "Other expenses", ar: "مصروفات أخرى" },
    },

    projects: {
      heading: { en: "Projects", ar: "المشاريع" },
      window: {
        en: "this month only, by stage — the Kanban board shows a single day",
        ar: "هذا الشهر فقط، حسب المرحلة — لوحة كانبان تعرض يوماً واحداً",
      },
      boardLink: { en: "Trips board →", ar: "لوحة الرحلات ←" },
      readFailed: { en: "Could not read projects.", ar: "تعذّرت قراءة المشاريع." },
      empty: { en: "No active projects.", ar: "لا توجد مشاريع نشطة." },
      noTrips: { en: "No trips yet.", ar: "لا توجد رحلات بعد." },
      // Rendered AFTER the count, with a space between, so these are the bare
      // noun — English inflects, Arabic does not.
      tripOne: { en: "trip", ar: "رحلة" },
      tripMany: { en: "trips", ar: "رحلة" },
      inFlight: { en: "in flight", ar: "قيد التنفيذ" },
    },

    liveTrips: {
      heading: { en: "Active Trips", ar: "الرحلات النشطة" },
      readFailed: { en: "Could not read.", ar: "تعذّر القراءة." },
      empty: { en: "No active trips.", ar: "لا توجد رحلات نشطة." },
      unassigned: { en: "Unassigned", ar: "غير مُسند" },
    },

    driversOps: {
      heading: { en: "Drivers Ops", ar: "حالة السائقين" },
      allLink: { en: "All drivers →", ar: "كل السائقين ←" },
      readFailed: { en: "Could not read drivers.", ar: "تعذّرت قراءة السائقين." },
      empty: { en: "No drivers.", ar: "لا يوجد سائقون." },
      conflict: {
        en: "Holds in-flight trips with no assigned truck — state and trips disagree.",
        ar: "بلا شاحنة مُسندة رغم وجود رحلات جارية — الحالة والرحلات لا تتفقان.",
      },
    },

    /** Driver compliance pills on the Drivers Ops board. */
    compliance: {
      expired: { en: "Expired", ar: "منتهية" },
      expiring_soon: { en: "Expiring", ar: "تنتهي قريباً" },
      not_recorded: { en: "Not recorded", ar: "غير مسجَّلة" },
      ok: { en: "Valid", ar: "سارية" },
    },

    /** ONE driver's derived state. Arabic differs from `driverMix` on purpose
     *  — that one counts a group, this one describes a person. */
    driverState: {
      active: { en: "Active", ar: "نشط" },
      idle: { en: "Idle", ar: "خامل" },
      off_duty: { en: "Off duty", ar: "خارج الدوام" },
      on_leave: { en: "On leave", ar: "في إجازة" },
    },

    driverTruck: {
      none: { en: "No truck", ar: "بلا شاحنة" },
      // Appended after the plate; the em dash is the separator.
      inMaintenance: { en: "— in maintenance", ar: "— في الصيانة" },
      fromTrip: { en: "(from his trip)", ar: "(من رحلته)" },
    },

    actions: {
      heading: { en: "Needs action", ar: "يحتاج إلى إجراء" },
      viewAllCount: { en: "View all ({n})", ar: "عرض الكل ({n})" },
      readFailed: { en: "Could not read the queue.", ar: "تعذّر قراءة قائمة المهام." },
      emptyTitle: { en: "Nothing waiting", ar: "لا شيء معلّق" },
      emptyBody: { en: "Every queue is clear right now.", ar: "كل قوائم الموافقات والمهام فارغة." },
      modalTitle: { en: "Everything that needs action", ar: "كل ما يحتاج إجراء" },
      // A relative timestamp follows immediately, so the trailing space stays.
      oldestPrefix: { en: "oldest ", ar: "الأقدم " },
    },

    now: {
      heading: { en: "Right now", ar: "الوضع الآن" },
      readFailed: { en: "Could not read current state.", ar: "تعذّر قراءة الوضع الحالي." },
      // "No data." — shorter than `chart.empty` in both languages.
      empty: { en: "No data.", ar: "لا توجد بيانات." },
      fleet: { en: "Fleet", ar: "الأسطول" },
      fleetReadFailed: { en: "Could not read fleet state.", ar: "تعذّرت قراءة حالة الأسطول." },
      drivers: { en: "Drivers", ar: "السائقون" },
      tripsInFlight: { en: "Trips in flight", ar: "رحلات جارية" },
      jobsRunning: { en: "Jobs running", ar: "أعمال جارية" },
    },

    /** Truck mix bar. Arabic is feminine (شاحنة) — a truck, not a driver. */
    fleetState: {
      active: { en: "Active", ar: "نشطة" },
      idle: { en: "Idle", ar: "متوقفة" },
      maintenance: { en: "Maintenance", ar: "صيانة" },
    },

    /** Driver mix bar — the headcount view, distinct from `driverState`. */
    driverMix: {
      active: { en: "Active", ar: "في الخدمة" },
      idle: { en: "Idle", ar: "متاح" },
      offDuty: { en: "Off duty", ar: "خارج الخدمة" },
      onLeave: { en: "On leave", ar: "إجازة" },
    },

    activity: {
      heading: { en: "Latest activity", ar: "آخر النشاطات" },
      viewAll: { en: "View all", ar: "عرض الكل" },
      readFailed: { en: "Could not read activity.", ar: "تعذّر قراءة النشاط." },
      empty: { en: "No recorded activity yet.", ar: "لا يوجد نشاط مسجّل بعد." },
      modalTitle: { en: "All activity", ar: "كل النشاطات" },
    },

    /** The driver-state drift guard. Silent unless the two definitions
     *  disagree, so this copy is rarely seen — and must be exact when it is. */
    drift: {
      headline: {
        en: "Driver state disagrees: {n} of {checked} differ between the database view and the app's own rule.",
        ar: "تعارض في حالة السائقين: {n} من {checked} لا تتطابق بين قاعدة البيانات وحساب التطبيق.",
      },
      view: { en: "view", ar: "العرض" },
      app: { en: "app", ar: "التطبيق" },
      fix: {
        en: "v_driver_state_now and lib/driver-state.ts must match — fix the rule in both.",
        ar: "v_driver_state_now و lib/driver-state.ts يجب أن يتطابقا — أصلح القاعدة في الاثنين معاً.",
      },
    },

    utilization: {
      title: { en: "Fleet utilization", ar: "استخدام الأسطول" },
      // Appended to the month title, so the leading space and dash stay.
      monthToDate: { en: " — month to date", ar: " — حتى تاريخه" },
      monthly: { en: "monthly", ar: "شهرياً" },
      worked: { en: "Worked", ar: "أيام عمل" },
      available: { en: "Available", ar: "أيام متاحة" },
      trucks: { en: "Trucks", ar: "شاحنات" },
      note: {
        en: "Days a truck ran at least one delivered trip, over the days it was available. Maintenance and out-of-service days leave the denominator; idle-but-in-service days stay in it — those are the ones this measures.",
        ar: "أيام شغّلت فيها الشاحنة رحلة مسلَّمة واحدة على الأقل، مقسومة على أيام توفّرها. الأيام في الصيانة أو خارج الخدمة مستبعدة من المقام، وأيام التوقف بلا عمل محتسبة.",
      },
    },

    costComposition: {
      title: { en: "Cost composition", ar: "تركيبة التكلفة" },
      sub: { en: "each type's share of the month's cost", ar: "حصة كل نوع من تكلفة الشهر" },
      // Hover title on the unpriced-fills badge. Two whole English variants
      // rather than a spliced plural; the Arabic does not inflect.
      uncostedTitleOne: {
        en: "{n} fill with no price for their water type — cost unknown, not counted",
        ar: "{n} تعبئة بلا سعر لنوع مياهها — تكلفتها غير معروفة وغير محتسبة",
      },
      uncostedTitleMany: {
        en: "{n} fills with no price for their water type — cost unknown, not counted",
        ar: "{n} تعبئة بلا سعر لنوع مياهها — تكلفتها غير معروفة وغير محتسبة",
      },
      unpriced: { en: "{n} unpriced", ar: "{n} بلا سعر" },
      noCost: { en: "No cost recorded", ar: "لا تكلفة مسجَّلة" },
    },

    // -----------------------------------------------------------------------
    // THE FOUR DISCLOSURE BLOCKS.
    //
    // Each is stored as WHOLE SENTENCES, one per plural case, never as
    // fragments spliced around an interpolated figure. English inflects
    // (fill/fills, has/have, its/their, it/them) where Arabic does not, so a
    // fragment-level translation would have to reassemble the sentence in a
    // language whose word order differs — which is how a disclosure ends up
    // saying something the author did not write. The cost is a duplicated
    // Arabic string in each pair; that is the intended trade.
    // -----------------------------------------------------------------------
    dailyCost: {
      lead: {
        en: "Direct cost is not full cost.",
        ar: "التكلفة المباشرة ليست التكلفة الكاملة.",
      },
      bodyWithCommission: {
        en: "It excludes {total} this month ({payroll} payroll, {commission} commission specials, adjustments and bonus) — neither has a daily source; both are monthly figures. Direct cost DOES include station fill.",
        ar: "تستثني {total} هذا الشهر (رواتب {payroll}، وعمولات خاصة وتسويات ومكافآت {commission}) — لا يوجد لأيٍّ منها مصدر يومي، فكلاهما رقم شهري. والتكلفة المباشرة تشمل تعبئة المحطة.",
      },
      body: {
        en: "It excludes {total} this month ({payroll} payroll) — neither has a daily source; both are monthly figures. Direct cost DOES include station fill.",
        ar: "تستثني {total} هذا الشهر (رواتب {payroll}) — لا يوجد لأيٍّ منها مصدر يومي، فكلاهما رقم شهري. والتكلفة المباشرة تشمل تعبئة المحطة.",
      },
      readFailed: {
        en: "Could not read the excluded monthly cost.",
        ar: "تعذّرت قراءة التكلفة الشهرية المستثناة.",
      },
      noneExcluded: {
        en: "Direct cost includes station fill, and excludes payroll and non-trip commission — neither has a daily source.",
        ar: "التكلفة المباشرة تشمل تعبئة المحطة، وتستثني الرواتب والعمولات غير المرتبطة برحلة — لا يوجد لها مصدر يومي.",
      },
    },

    uncostedFills: {
      boldOne: {
        en: "{n} fill this month has no price for its water type,",
        ar: "{n} تعبئة هذا الشهر بلا سعر لنوع مياهها،",
      },
      boldMany: {
        en: "{n} fills this month have no price for their water type,",
        ar: "{n} تعبئة هذا الشهر بلا سعر لنوع مياهها،",
      },
      tailOne: {
        en: "so its cost is unknown — not zero — and is not in {where}.",
        ar: "فتكلفتها غير معروفة — وليست صفراً — ولم تُحتسب {where}.",
      },
      tailMany: {
        en: "so their cost is unknown — not zero — and is not in {where}.",
        ar: "فتكلفتها غير معروفة — وليست صفراً — ولم تُحتسب {where}.",
      },
      // WHICH figure on the card is short. The caller picks, because naming
      // the wrong one is a false statement about what to distrust.
      fromDirectCost: { en: "the direct-cost line above", ar: "ضمن التكلفة المباشرة أعلاه" },
      fromFillSlice: { en: "the Station fill slice above", ar: "ضمن شريحة تعبئة المحطة أعلاه" },
    },

    deliveredRevenue: {
      lead: { en: "Earned, not billed.", ar: "إيراد مُكتسَب، لا مفوتر." },
      body: {
        en: "What the day's completed work was worth at its project's rate, invoiced or not, recorded on the day the trip ran. It does not match Reports and feeds no margin — billed revenue stays in Reports and in the \"Revenue\" tile at the top of this page.",
        ar: "قيمة العمل المنفَّذ في يومه بسعر مشروعه، سواء فُوتر أم لا — يُسجَّل بتاريخ الرحلة. لا يطابق التقارير ولا يدخل في أي هامش؛ الإيراد المفوتر يبقى في التقارير وفي بطاقة «الإيرادات» أعلى الصفحة.",
      },
      unpricedBoldOne: {
        en: "{n} delivered trip this month has no project,",
        ar: "{n} رحلة مُسلَّمة هذا الشهر بلا مشروع،",
      },
      unpricedBoldMany: {
        en: "{n} delivered trips this month have no project,",
        ar: "{n} رحلة مُسلَّمة هذا الشهر بلا مشروع،",
      },
      unpricedTailOne: {
        en: "so it has no rate and is not counted here — no price was assumed for it.",
        ar: "فلا سعر لها ولم تُحتسب هنا — ولم يُفترض لها سعر.",
      },
      unpricedTailMany: {
        en: "so they have no rate and are not counted here — no price was assumed for them.",
        ar: "فلا سعر لها ولم تُحتسب هنا — ولم يُفترض لها سعر.",
      },
    },

    /** The footnote under the Delivery Output chart (`DeliveryOutputNote`).
     *  Named for what it says, like its three siblings above; the chart's own
     *  title lives at `deliveryOutput.title`. */
    dispatchedCapacity: {
      lead: {
        en: "Capacity dispatched, not measured volume.",
        ar: "السعة المُشغَّلة، لا الكمية المقاسة.",
      },
      body: {
        en: "The bars add up the full capacity of every truck that made a delivery, whether or not it ran full — per-trip tank size is unrecorded on every trip, so there is no measured volume to show.",
        ar: "تجمع الأعمدة السعة الكاملة لكل شاحنة نفّذت توصيلاً، سواء خرجت ممتلئة أم لا — فحقل حجم الخزان لكل رحلة غير مُعبَّأ في أي رحلة، فلا توجد كمية مقاسة تُعرض.",
      },
      // No English plural case: the source sentence is written for the many
      // form only, and it is only rendered when the count is above zero.
      noTruckBold: {
        en: "{n} of {total} delivered trips this month have no truck assigned,",
        ar: "{n} من {total} رحلة مسلَّمة هذا الشهر بلا شاحنة مُسندة،",
      },
      noTruckTail: {
        en: "so their capacity is missing from the bars even though they count on the trips line.",
        ar: "فسعتها غير محسوبة ضمن الأعمدة رغم احتسابها ضمن خط الرحلات.",
      },
    },

    summaries: {
      heading: { en: "My summaries", ar: "ملخصاتي" },
      remove: { en: "Remove", ar: "إزالة" },
      // English matches `chart.empty` but the Arabic is shorter — the
      // author's own wording for a tile rather than a chart.
      noData: { en: "No data yet.", ar: "لا توجد بيانات." },
      pickerNote: {
        en: "Every option here reads the same semantic layer Reports reads — no independent numbers.",
        ar: "كل خيار هنا يقرأ من الطبقة الدلالية نفسها التي تقرأ منها التقارير — لا أرقام مستقلة.",
      },
      displayStat: { en: "number", ar: "رقم" },
      displayBars: { en: "bars", ar: "أعمدة" },
      nlTitle: { en: "Describe a summary", ar: "اطلب ملخصاً بالكلمات" },
      // Lower-case "soon" and a different Arabic to `navLandmark.soon`.
      comingSoon: { en: "Coming soon", ar: "قريباً" },
      nlBody: {
        en: "This will fill in the same builder above from a description. Not built yet — nothing you type is sent anywhere.",
        ar: "سيملأ هذا نفس المنشئ أعلاه انطلاقاً من وصفك. لم يُبنَ بعد — لا يُرسل ما تكتبه إلى أي مكان.",
      },
      nlPlaceholder: { en: "Not available yet", ar: "غير متاح بعد" },
    },
  },

  // =========================================================================
  // FLEET — Phase 3 Batch 4. The list page, the truck detail page, and the
  // shared Add/Edit Truck modal.
  //
  // This route had ZERO Arabic before this batch: every `ar` below is new
  // wording, EXCEPT the values explicitly noted as LIFTED, which are copied
  // byte-for-byte from an existing dictionary entry or from
  // MaintenanceCalendar's MONTHS_AR so the two surfaces cannot drift apart.
  //
  // WHAT IS NOT HERE, AND WHY:
  //   · Unit tokens — `33 m³`, `12,000 km`, `SAR`, `VIN` — are app-formatted
  //     figures and stay Latin in both languages. Only ONE unit reaches a
  //     LABEL on this route ("Odometer (km)"), and it keeps `km` Latin so
  //     every unit on the page reads the same way.
  //   · `N/A` is NOT a unit and does NOT stay Latin — it is plain language, so
  //     it translates to `غير متاح` via `common.na`. It lives in `common`
  //     because formatUtilization() writes it for the Dashboard too, and
  //     utilNoteBody1/2 below leave it out of both halves so the sentence and
  //     the cell read the same token in either language.
  //   · app/fleet/actions.ts server errors stay English, as in every prior
  //     batch.
  // =========================================================================
  fleet: {
    // ---- list page chrome -------------------------------------------------
    // The two NUMBERS are facts about the business (CLAUDE.md section 1), not
    // a count of rows — they are carried through untouched, Latin, and only
    // the words around them are translated.
    subtitle: { en: "{n} trucks · Riyadh · 3 stations", ar: "{n} شاحنة · الرياض · 3 محطات" },
    addTruck: { en: "Add Truck", ar: "إضافة شاحنة" },
    loadFailed: { en: "Failed to load fleet:", ar: "تعذّر تحميل الأسطول:" },
    openDetailAria: { en: "{plate} — open truck detail", ar: "{plate} — فتح تفاصيل الشاحنة" },

    kpi: {
      totalTrucks: { en: "Total Trucks", ar: "إجمالي الشاحنات" },
      // Trucks are feminine in Arabic, so these do NOT reuse `status.active` /
      // `status.idle` (نشط / متوقف, masculine).
      //
      // `idle` NO LONGER matches dashboard.fleetState (متوقفة). Turki's wording:
      // an idle truck is في الموقف — parked in the yard — which says WHERE it is
      // rather than that it stopped. It MUST stay equal to truckState.idle
      // below: the KPI card, the filter chip and the table pill all count the
      // same buildTruckStatusMap enum, so a reader seeing three different words
      // would think they were three different facts.
      active: { en: "Active", ar: "نشطة" },
      inMaintenance: { en: "In Maintenance", ar: "في الصيانة" },
      idle: { en: "Idle", ar: "في الموقف" },
      totalCapacity: { en: "Total Capacity", ar: "إجمالي السعة" },
    },

    // TRUCK_OPS_STATE_LABELS (lib/truck-status.ts) rendered for THIS route.
    // That map is plain English and is read by the drivers and trips routes
    // too, so it is not touched — the fleet files key off the same enum and
    // read these instead.
    //
    // `idle` is في الموقف and must stay equal to kpi.idle above — same enum,
    // same source map, three surfaces. `maintenance` / `active` are still the
    // dashboard.fleetState wording.
    truckState: {
      maintenance: { en: "Maintenance", ar: "صيانة" },
      active: { en: "Active", ar: "نشطة" },
      idle: { en: "Idle", ar: "في الموقف" },
    },
    // DRIVER_STATE_LABELS (lib/driver-state.ts), same arrangement. Note the
    // English is "Off duty" / "On leave", which is NOT byte-identical to
    // status.off_duty / status.leave ("Off Duty" / "On Leave"), so those cannot
    // be reused here.
    //
    // `idle` and `off_duty` NO LONGER match dashboard.driverState (خامل /
    // خارج الدوام). Both of those describe the driver; Turki's wording describes
    // his WORKLOAD, which is what the fleet page is actually about:
    //   idle     = has a truck, no active project -> متاح, free to take work
    //   off_duty = has no truck at all            -> غير مكلف, not tasked
    // خارج الدوام was wrong on its own terms — it reads "outside working hours",
    // but the state has nothing to do with the clock.
    //
    // متاح here is the SAME WORD as availability.available below, and the two
    // render side by side in the driver picker (Status column vs Availability
    // column). That is deliberate and Turki's call: a driver free to take work
    // and a driver assignable to this truck are near enough the same thing to a
    // dispatcher. They are still separate KEYS off separate enums, so nothing is
    // coupled — only the word agrees.
    driverState: {
      active: { en: "Active", ar: "نشط" },
      idle: { en: "Idle", ar: "متاح" },
      off_duty: { en: "Off duty", ar: "غير مكلف" },
      on_leave: { en: "On leave", ar: "في إجازة" },
    },

    filters: {
      searchPlaceholder: { en: "Search plate, model…", ar: "ابحث برقم اللوحة أو الطراز…" },
      allStations: { en: "All Stations", ar: "كل المحطات" },
      results: { en: "{n} results", ar: "{n} نتيجة" },
    },

    // Column headers with no exact match in `common` / `status`.
    cols: {
      model: { en: "Model", ar: "الطراز" },
      // Not a literal rendering of "Vehicle ID". The استمارة is the KSA vehicle
      // registration card, and its number is what this column actually shows —
      // Turki's wording names the document a Saudi operator recognises instead
      // of a generic identifier. Distinct from form.vehicleRegistration (رخصة
      // السير) below, which labels the EXPIRY field, not this number.
      vehicleId: { en: "Vehicle ID", ar: "استمارة السيارة" },
      station: { en: "Station", ar: "المحطة" },
      assignedProject: { en: "Assigned Project", ar: "المشروع المُسند" },
      lastService: { en: "Last Service", ar: "آخر صيانة" },
      date: { en: "Date", ar: "التاريخ" },
      id: { en: "ID", ar: "المعرّف" },
      assignedTo: { en: "Assigned to", ar: "مُسند إلى" },
      // LIFTED from dashboard.costType.parts / search.g_part.
      parts: { en: "Parts", ar: "قطع الغيار" },
      availability: { en: "Availability", ar: "التوفر" },
      safety: { en: "Safety", ar: "الأمان" },
      trips30d: { en: "Trips 30d", ar: "الرحلات 30 يوم" },
    },

    // Two whole sentences rather than a stem plus a swapped tail: Arabic does
    // not take the English "No trucks" + " match the filters" split.
    noTrucksFiltered: { en: "No trucks match the filters.", ar: "لا توجد شاحنات مطابقة للتصفية." },
    noTrucksYet: { en: "No trucks yet.", ar: "لا توجد شاحنات بعد." },
    noDriversYet: { en: "No drivers yet.", ar: "لا يوجد سائقون بعد." },

    // ---- utilization ------------------------------------------------------
    util: {
      workedTitle: {
        en: "{worked} of {available} available days worked",
        ar: "{worked} من {available} يوم متاح تم العمل فيها",
      },
      inMaintenance: { en: "{n} in maintenance", ar: "{n} في الصيانة" },
      outOfService: { en: "{n} out of service", ar: "{n} خارج الخدمة" },
      noAvailableDays: { en: "no available days", ar: "لا توجد أيام متاحة" },
      stat30d: { en: "Utilization · 30d", ar: "معدل الاستخدام · 30 يوماً" },
      rolling: {
        en: "{worked} of {available} available days · {from} to {to}",
        ar: "{worked} من {available} يوم متاح · {from} إلى {to}",
      },
      // The four utilizationNaReason() sentences, moved out of
      // lib/utilization.ts. That helper now returns the KIND, and the two
      // fleet files translate it — nothing else in the app ever called it.
      naBoth: {
        en: "No available days — out of service and in maintenance all period.",
        ar: "لا توجد أيام متاحة — خارج الخدمة وفي الصيانة طوال الفترة.",
      },
      naOutOfService: {
        en: "No available days — out of service for the whole period.",
        ar: "لا توجد أيام متاحة — خارج الخدمة طوال الفترة.",
      },
      naMaintenance: {
        en: "No available days — in maintenance for the whole period.",
        ar: "لا توجد أيام متاحة — في الصيانة طوال الفترة.",
      },
      naNone: { en: "No available days in this period.", ar: "لا توجد أيام متاحة في هذه الفترة." },
    },

    // The note under the table. Split at the two <b> runs, and NOWHERE else —
    // each value is a whole clause, and the single spaces between them are
    // supplied by the JSX, so no dictionary value carries an invisible edge
    // space. `N/A` is not in either half: it is `common.na`, the same key the
    // shared formatter prints, so the sentence always names the token actually
    // in the cell — `N/A` in English, `غير متاح` in Arabic.
    utilNoteBold: {
      en: "Utilization is {month}, month to date.",
      ar: "معدل الاستخدام لشهر {month}، حتى تاريخه.",
    },
    utilNoteBody1: {
      en: "Days the truck ran at least one delivered trip, over the days it was available — calendar days minus any time terminated, in maintenance or out of service. A truck with no available days shows",
      ar: "الأيام التي نفّذت فيها الشاحنة رحلة مسلّمة واحدة على الأقل، منسوبةً إلى الأيام التي كانت متاحة فيها — أيام التقويم ناقص أي وقت كانت فيه مشطوبة أو في الصيانة أو خارج الخدمة. الشاحنة التي لا أيام متاحة لها تُظهر",
    },
    utilNoteBody2: {
      en: "rather than 0%, because there is nothing to measure against.",
      ar: "بدلاً من 0%، لأنه لا يوجد ما تُقاس عليه.",
    },

    // ---- health placeholder ----------------------------------------------
    health: {
      aria: { en: "Health {pct}%", ar: "الحالة الفنية {pct}%" },
      notActiveAria: { en: "Health monitoring not active yet", ar: "مراقبة الحالة الفنية غير مفعّلة بعد" },
      awaitingSensors: { en: "Awaiting IoT sensors", ar: "بانتظار حسّاسات إنترنت الأشياء" },
      noteBold: { en: "Health monitoring is not active yet.", ar: "مراقبة الحالة الفنية غير مفعّلة بعد." },
      noteBody: {
        en: "The health bar is a placeholder — it activates once IoT sensors are fitted to the fleet and integrated, at which point each truck reports its own condition.",
        ar: "شريط الحالة الفنية عنصر مؤقت — يعمل بمجرد تركيب حسّاسات إنترنت الأشياء على الأسطول وربطها، وعندها تُبلّغ كل شاحنة عن حالتها بنفسها.",
      },
    },

    // ---- months, for the "Utilization is <Month> <Year>" label ------------
    // LIFTED VERBATIM from MaintenanceCalendar's MONTHS_AR. Copied, not
    // imported: that file is a different route's and is not touched here, and
    // a shared constant would make this dictionary depend on a component.
    months: {
      "1": { en: "January", ar: "يناير" },
      "2": { en: "February", ar: "فبراير" },
      "3": { en: "March", ar: "مارس" },
      "4": { en: "April", ar: "أبريل" },
      "5": { en: "May", ar: "مايو" },
      "6": { en: "June", ar: "يونيو" },
      "7": { en: "July", ar: "يوليو" },
      "8": { en: "August", ar: "أغسطس" },
      "9": { en: "September", ar: "سبتمبر" },
      "10": { en: "October", ar: "أكتوبر" },
      "11": { en: "November", ar: "نوفمبر" },
      "12": { en: "December", ar: "ديسمبر" },
    },

    // ---- assign-driver modal ---------------------------------------------
    assign: {
      title: { en: "Assign Driver — {plate}", ar: "إسناد سائق — {plate}" },
      subtitle: { en: "Select a driver to assign · {plate}", ar: "اختر سائقاً للإسناد · {plate}" },
      assignDriver: { en: "Assign Driver", ar: "إسناد سائق" },
      changeDriver: { en: "Change Driver", ar: "تغيير السائق" },
      changeDriverTitle: { en: "Change driver", ar: "تغيير السائق" },
      unassign: { en: "Unassign", ar: "إلغاء الإسناد" },
      current: { en: "Current", ar: "الحالي" },
      close: { en: "Close", ar: "إغلاق" },
    },

    // The Availability cell. These are keyed off driverAvailability()'s
    // `labelKind` enum, never off the rendered text — see the FleetClient cell
    // and lib/driver-assignment.ts. `available` is deliberately its OWN key:
    // dashboard.utilization.available is also "Available" in English but means
    // "available DAYS" (أيام متاحة), which is not what a free driver is.
    availability: {
      terminated: { en: "Terminated", ar: "مشطوب" },
      assignedElsewhere: { en: "Already assigned · {plate}", ar: "مُسند بالفعل · {plate}" },
      onLeave: { en: "On leave today", ar: "في إجازة اليوم" },
      available: { en: "Available", ar: "متاح" },
    },

    // ---- truck form modal -------------------------------------------------
    form: {
      addTitle: { en: "Add New Truck", ar: "إضافة شاحنة جديدة" },
      editTitle: { en: "Edit Truck", ar: "تعديل الشاحنة" },
      addSubtitle: {
        en: "Register a new water truck. Plate is required.",
        ar: "سجّل شاحنة مياه جديدة. رقم اللوحة مطلوب.",
      },
      editSubtitle: { en: "Update truck details · {plate}", ar: "تحديث بيانات الشاحنة · {plate}" },
      year: { en: "Year", ar: "سنة الصنع" },
      // `km` stays Latin — see this namespace's header.
      odometerKm: { en: "Odometer (km)", ar: "العداد (km)" },
      vin: { en: "VIN", ar: "VIN" },
      vehicleRegistration: { en: "Vehicle Registration", ar: "رخصة السير" },
      registrationExpiry: { en: "Registration expiry", ar: "انتهاء رخصة السير" },
      assignedDriver: { en: "Assigned driver", ar: "السائق المُسند" },
      // LIFTED from dashboard.liveTrips.unassigned.
      unassigned: { en: "Unassigned", ar: "غير مُسند" },
      // The model is a manufacturer's name, so the example stays Latin.
      modelPlaceholder: { en: "e.g. Mercedes-Benz Actros 3340", ar: "مثال: Mercedes-Benz Actros 3340" },
      editTruckTitle: { en: "Edit truck", ar: "تعديل الشاحنة" },
    },

    // ---- detail page ------------------------------------------------------
    detail: {
      back: { en: "Back", ar: "رجوع" },
      backToFleet: { en: "Back to Fleet", ar: "العودة إلى الأسطول" },
      notFound: { en: "Truck not found.", ar: "لم يتم العثور على الشاحنة." },
      loadFailed: { en: "Failed to load: {msg}", ar: "تعذّر التحميل: {msg}" },
      generalInfo: { en: "General Info", ar: "المعلومات العامة" },
      engineHealth: { en: "Engine Component Health", ar: "الحالة الفنية لمكونات المحرك" },
      engineHealthSub: {
        en: "Vibration + sound sensors detect failures before they happen",
        ar: "حسّاسات الاهتزاز والصوت تكتشف الأعطال قبل وقوعها",
      },
      noTelemetry: { en: "No telemetry yet", ar: "لا توجد قياسات بعد" },
      noTelemetrySub: {
        en: "Component readings appear once IoT sensors are connected.",
        ar: "تظهر قراءات المكونات بمجرد ربط حسّاسات إنترنت الأشياء.",
      },
      // LIFTED from nav.predictive — the same subsystem, named the same way.
      // Its own key rather than reading nav's, so a nav rename cannot silently
      // retitle a card on this page.
      predictiveAi: { en: "Predictive AI", ar: "الذكاء التنبؤي" },
      noAlerts: { en: "No active alerts", ar: "لا توجد تنبيهات نشطة" },
      noDriverAssigned: { en: "No driver assigned", ar: "لا يوجد سائق مُسند" },
      safetyScore: { en: "Safety Score:", ar: "درجة الأمان:" },
      trips30d: { en: "Trips 30d:", ar: "الرحلات 30 يوم:" },
      // Two clauses around the plate, so the plate can sit where Arabic wants
      // it. The JSX supplies the single spaces.
      waitingLead: { en: "Waiting for", ar: "بانتظار تحرير" },
      waitingTail: { en: "to be released from maintenance", ar: "من الصيانة" },
    },

    // ---- maintenance history card ----------------------------------------
    mt: {
      historyTitle: { en: "Maintenance History", ar: "سجل الصيانة" },
      allJobs: { en: "{n} all jobs", ar: "{n} من كل الأعمال" },
      noHistory: { en: "No maintenance history", ar: "لا يوجد سجل صيانة" },
      // status.corrective is "Repair" in English, not "Corrective", so it
      // cannot be reused for this map. The other three types DO match exactly
      // and read status.preventive / .inspection / .predictive.
      corrective: { en: "Corrective", ar: "إصلاحية" },
      // LIFTED from mt.delayed / mt.osOverdue — the maintenance route's own
      // words for the same two states, copied so the two pages agree.
      delayed: { en: "Delayed", ar: "متأخرة" },
      overdue: { en: "Overdue", ar: "متأخر" },
      costInternal: { en: "internal", ar: "داخلي" },
      costExternal: { en: "external, incl. VAT", ar: "خارجي، شامل الضريبة" },
    },

    // ---- danger zone ------------------------------------------------------
    // BUSINESS WORDING — reviewed and confirmed by Turki. The type-to-confirm
    // gate compares against truck.plate (data), so none of this is load-bearing.
    //
    // `terminateTruck` / `terminating` keep the شطب family, and the picker's
    // availability.terminated keeps مشطوب — Turki's explicit decision, not an
    // oversight. Do not "align" them with anything.
    //
    // TOTAL LOSS IS DELIBERATELY TWO DIFFERENT WORDS, and the difference is
    // grammatical, not editorial:
    //   totalLoss       تالف   — the button, standing alone, no noun to agree with
    //   reasonTotalLoss تالفة  — lands inside `…على أنها ___`, and أنها is
    //                            feminine because a شاحنة is. Its sibling
    //                            reasonSold is مباعة for exactly this reason.
    // Making them the same word puts a masculine adjective on a feminine noun in
    // the confirm sentence. The English side is likewise two entries ("Total
    // loss" / "total loss"), so this is not new asymmetry.
    term: {
      dangerZone: { en: "Danger zone", ar: "منطقة الخطر" },
      terminateTruck: { en: "Terminate truck", ar: "شطب الشاحنة" },
      removes: {
        en: "Removes {plate} from all active views. Trip history is preserved.",
        ar: "يزيل {plate} من جميع الشاشات النشطة. يُحفظ سجل الرحلات.",
      },
      deactivateSold: { en: "Deactivate — Sold", ar: "إيقاف — مباعة" },
      totalLoss: { en: "Total loss", ar: "تالف" },
      confirmLead: { en: "This will mark", ar: "سيؤدي هذا إلى تعليم" },
      confirmMid: { en: "as", ar: "على أنها" },
      reasonSold: { en: "sold", ar: "مباعة" },
      reasonTotalLoss: { en: "total loss", ar: "تالفة" },
      confirmTail: {
        en: "and remove it from the active fleet. Its trip history is preserved. Restorable later from Archive.",
        ar: "وإزالتها من الأسطول النشط. يُحفظ سجل رحلاتها، ويمكن استعادتها لاحقاً من الأرشيف.",
      },
      // `SAR` stays Latin — see this namespace's header.
      priceSar: { en: "Price (SAR) *", ar: "السعر (SAR) *" },
      releasedDate: { en: "Released date *", ar: "تاريخ الإخراج *" },
      typeToConfirm: { en: 'Type "{plate}" to confirm', ar: 'اكتب "{plate}" للتأكيد' },
      terminating: { en: "Terminating…", ar: "جارٍ الشطب…" },
      confirmSale: { en: "Confirm sale", ar: "تأكيد البيع" },
      confirmTotalLoss: { en: "Confirm total loss", ar: "تأكيد التلف" },
    },
  },
  /**
   * ── Phase 3 Batch 5 — CONSUMPTION ────────────────────────────────────────
   *
   * The Consumption route: the Parts Usage analytics tab, the Exit Permits tab
   * and its five modals, and the Approvals queue. Every `en` below is the EXACT
   * literal that was in the source before this conversion, including the
   * collapsed single-line form of a wrapped JSX text run.
   *
   * `enums` holds the two label maps that live in lib/db-types.ts. They are NOT
   * in the `labels` namespace above, and the difference is the reason that
   * namespace gives for itself: those three enum families are read from FOUR
   * routes, so a route-scoped key would misdescribe them. EXIT_PERMIT_KIND and
   * EXIT_PERMIT_DESTINATION are read by app/consumption/** and nothing else —
   * grep-verified for this batch. If a second route ever reads them, move them
   * up to `labels`; until then a consumption key is the honest description.
   *
   * `*Inline` entries are the LOWER-CASE mid-sentence forms. They exist because
   * two sites used to call `.toLowerCase()` on a rendered label to drop it into
   * a sentence — an English-shaped seam (Arabic has no letter case, so the call
   * is a no-op there and the sentence would carry a Title-Case noun mid-clause).
   * The call sites now key off the ENUM and look up a proper inline form.
   *
   * `weekly` is the weeklySummary() narrative. See the `plural()` helper at the
   * foot of this file for why a bullet with a count has FOUR forms rather than
   * two: Arabic agrees a counted noun differently at 1, 2, 3–10 and 11+. The
   * four English values under such a key are deliberately identical wherever
   * English does not inflect, so the English output is the same string
   * whichever bucket fires. A sentence carrying TWO independent counts is
   * stored as the full 4×4 cross product — writing the head and the tail as
   * separate keys and joining them at render time is exactly the fragment
   * splicing this batch was told not to do.
   */
  consumption: {
    // WORDS MORE THAN ONE FILE IN THIS ROUTE RENDERS.
    //
    // The dictionary's rule at the top of `common` is that a string earns a
    // shared home by appearing in MORE THAN ONE of the files a batch converted.
    // These do — but they are Consumption VOCABULARY, not app chrome, so
    // they land here rather than in `common`, which holds the words every route
    // reuses (Part, Qty, Truck, Status, Cancel — all of which this route reads
    // from `common` and does NOT re-mint below).
    //
    // Two deliberate duplicates, both kept:
    //   - `permit` vs `consumption.approvals.shortExitPermit`. Same English
    //     word, different jobs: this one is a COLUMN HEADER, that one is the
    //     short KIND PILL on the approvals queue. Rewording one must not
    //     reword the other.
    //   - `close` vs the three route-local `close` keys already in this file
    //     (Fleet, Inventory, Maintenance). Centralising all four is a
    //     cross-route change and is not this batch's to make; a fourth copy in
    //     `common` while three route-local ones survive would be the worst of
    //     both, so this one stays scoped to the route that reads it.
    shared: {
      value: { en: "Value", ar: "القيمة" },
      total: { en: "Total", ar: "الإجمالي" },
      destination: { en: "Destination", ar: "الوجهة" },
      permit: { en: "Permit", ar: "إذن" },
      close: { en: "Close", ar: "إغلاق" },
      kind: { en: "Kind", ar: "النوع" },
      // The FIFO unit cost column. The Arabic spells the rule out rather than
      // transliterating "FIFO": «الوارد أولًا» is the same phrase the Inventory
      // route already uses, so a reader meets one name for one rule.
      fifoUnitValue: { en: "FIFO unit value", ar: "قيمة الوحدة بالوارد أولًا" },
      // Row-expander aria labels. Both tables in this route expand a row into a
      // detail panel, and a screen reader should hear the same verb on each.
      expandAria: { en: "Expand", ar: "توسيع" },
      collapseAria: { en: "Collapse", ar: "طي" },

      // --- PROMOTED WHEN ExitPermitModals.tsx CONVERTED ---
      // Each of these was minted route-locally back when ONE file rendered it.
      // The modals render all nine as well, which is exactly the "more than one
      // file in this route" test this namespace exists for — so the
      // single-file copy was deleted and its call site repointed here. The
      // alternative, a second leaf holding byte-identical English, is the drift
      // this namespace was created to prevent: the list column and the modal
      // column ARE the same column, and one edit must move both.
      warehouse: { en: "Warehouse", ar: "المستودع" },
      receiver: { en: "Receiver", ar: "المستلم" },
      items: { en: "Items", ar: "الأصناف" },
      qtyOut: { en: "Qty out", ar: "الكمية الخارجة" },
      outstanding: { en: "Outstanding", ar: "القائم" },
      // The button on the list row, and the title of the modal it opens.
      confirmExit: { en: "Confirm exit", ar: "تأكيد الخروج" },
      voidPermit: { en: "Void permit", ar: "إلغاء الإذن" },
      // The lower-case tag under an unstamped FIFO figure: a draft's cost is a
      // preview, not a promise, and both the list and the form say so.
      previewTag: { en: "preview", ar: "معاينة" },
      // Was `approvals.kindExitPermit`, read by lib/consumption-approvals.ts.
      // The printed permit's own header renders the same two words, so the
      // document a driver carries and the approval queue name it identically.
      exitPermit: { en: "Exit permit", ar: "إذن خروج" },
      // The in-flight label on a button that is writing an event: the approvals
      // queue recording a decision, the return popup recording a return.
      recording: { en: "Recording…", ar: "جارٍ التسجيل…" },
    },

    enums: {
      // ExitPermitKind
      kindReturnable: { en: "Returnable", ar: "قابلة للإرجاع" },
      kindPermanent: { en: "Permanent", ar: "دائمة" },
      // ExitPermitDestinationKind
      destWaterStation: { en: "Water station", ar: "محطة مياه" },
      destProject: { en: "Project", ar: "مشروع" },
      destTruck: { en: "Truck", ar: "شاحنة" },
      destCustomer: { en: "Customer", ar: "عميل" },
      destOther: { en: "Other", ar: "أخرى" },
      // Mid-sentence forms — see this namespace's header.
      destInlineWaterStation: { en: "water station", ar: "محطة مياه" },
      destInlineProject: { en: "project", ar: "مشروع" },
      destInlineTruck: { en: "truck", ar: "شاحنة" },
      destInlineCustomer: { en: "customer", ar: "عميل" },
      destInlineOther: { en: "other", ar: "جهة أخرى" },
    },

    // lib/consumption-approvals.ts — the three label maps plus the fallback
    // title an untitled permit gets in the queue.
    approvals: {
      // NOTE: the exit-permit KIND label is not here — it is
      // `consumption.shared.exitPermit`, because the print view renders the
      // same words. The other two kinds have a single reader and stay local.
      kindWorkOrder: { en: "Work order", ar: "أمر عمل" },
      kindOutsourcedJob: { en: "Outsourced job", ar: "عمل خارجي" },
      shortExitPermit: { en: "Permit", ar: "إذن" },
      shortWorkOrder: { en: "In-house", ar: "داخلي" },
      shortOutsourcedJob: { en: "Outsourced", ar: "خارجي" },
      statusPending: { en: "Pending", ar: "قيد الانتظار" },
      statusApproved: { en: "Approved", ar: "معتمد" },
      statusRejected: { en: "Rejected", ar: "مرفوض" },
      untitledPermit: { en: "Parts leaving the warehouse", ar: "قطع تخرج من المستودع" },
      inlineExitPermit: { en: "exit permit", ar: "إذن الخروج" },
      inlineWorkOrder: { en: "work order", ar: "أمر العمل" },
      inlineOutsourcedJob: { en: "outsourced job", ar: "العمل الخارجي" },
    },

    // lib/parts-usage.ts — the label maps and the "unknown row" fallbacks.
    usage: {
      periodWeek: { en: "Week to week", ar: "أسبوع مقابل أسبوع" },
      periodMonth: { en: "Month to month", ar: "شهر مقابل شهر" },
      periodQuarter: { en: "Quarter to quarter", ar: "ربع مقابل ربع" },
      periodYear: { en: "Year to year", ar: "سنة مقابل سنة" },
      // fmtRange(). `{d}` is a formatDate() result and `{y}`/`{q}` are Latin
      // numerals — figures stay Latin in both languages, the standing rule.
      rangeWeek: { en: "Week of {d}", ar: "أسبوع {d}" },
      rangeQuarter: { en: "Q{q} {y}", ar: "الربع {q} {y}" },
      trendMonth: { en: "Monthly", ar: "شهري" },
      trendQuarter: { en: "Quarterly", ar: "ربع سنوي" },
      trendYear: { en: "Yearly", ar: "سنوي" },
      sourceMaintenance: { en: "Maintenance", ar: "الصيانة" },
      sourceExitPermits: { en: "Exit permits", ar: "أذونات الخروج" },
      unknownTruck: { en: "Unknown truck", ar: "شاحنة غير معروفة" },
      unknownPart: { en: "Unknown part", ar: "قطعة غير معروفة" },
      unknownWarehouse: { en: "Unknown warehouse", ar: "مستودع غير معروف" },
      unassignedWarehouse: { en: "Unassigned", ar: "غير محدد" },
    },

    weekly: {
      quietNoPrev: {
        en: "Nothing left stock this week, and nothing last week either.",
        ar: "لم يخرج أي مخزون هذا الأسبوع، ولا في الأسبوع الماضي أيضاً.",
      },
      // {v} value, {q} units — bucketed on the PREVIOUS week's unit count.
      quietWithPrev: {
        one: {
          en: "Nothing left stock this week — last week it was {v} SAR across {q} units.",
          ar: "لم يخرج أي مخزون هذا الأسبوع — الأسبوع الماضي خرج ما قيمته {v} SAR عبر وحدة واحدة.",
        },
        two: {
          en: "Nothing left stock this week — last week it was {v} SAR across {q} units.",
          ar: "لم يخرج أي مخزون هذا الأسبوع — الأسبوع الماضي خرج ما قيمته {v} SAR عبر وحدتين.",
        },
        few: {
          en: "Nothing left stock this week — last week it was {v} SAR across {q} units.",
          ar: "لم يخرج أي مخزون هذا الأسبوع — الأسبوع الماضي خرج ما قيمته {v} SAR عبر {q} وحدات.",
        },
        many: {
          en: "Nothing left stock this week — last week it was {v} SAR across {q} units.",
          ar: "لم يخرج أي مخزون هذا الأسبوع — الأسبوع الماضي خرج ما قيمته {v} SAR عبر {q} وحدة.",
        },
      },
      totalNoPrev: {
        one: {
          en: "{v} SAR of parts left stock across {q} units — nothing moved last week, so there is no comparison yet.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر وحدة واحدة — لم يتحرك شيء الأسبوع الماضي، فلا مقارنة بعد.",
        },
        two: {
          en: "{v} SAR of parts left stock across {q} units — nothing moved last week, so there is no comparison yet.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر وحدتين — لم يتحرك شيء الأسبوع الماضي، فلا مقارنة بعد.",
        },
        few: {
          en: "{v} SAR of parts left stock across {q} units — nothing moved last week, so there is no comparison yet.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر {q} وحدات — لم يتحرك شيء الأسبوع الماضي، فلا مقارنة بعد.",
        },
        many: {
          en: "{v} SAR of parts left stock across {q} units — nothing moved last week, so there is no comparison yet.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر {q} وحدة — لم يتحرك شيء الأسبوع الماضي، فلا مقارنة بعد.",
        },
      },
      totalUp: {
        one: {
          en: "{v} SAR of parts left stock across {q} units, up {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر وحدة واحدة، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
        two: {
          en: "{v} SAR of parts left stock across {q} units, up {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر وحدتين، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
        few: {
          en: "{v} SAR of parts left stock across {q} units, up {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر {q} وحدات، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
        many: {
          en: "{v} SAR of parts left stock across {q} units, up {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر {q} وحدة، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
      },
      totalDown: {
        one: {
          en: "{v} SAR of parts left stock across {q} units, down {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر وحدة واحدة، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
        two: {
          en: "{v} SAR of parts left stock across {q} units, down {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر وحدتين، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
        few: {
          en: "{v} SAR of parts left stock across {q} units, down {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر {q} وحدات، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
        many: {
          en: "{v} SAR of parts left stock across {q} units, down {d}% in value against last week.",
          ar: "خرجت قطع بقيمة {v} SAR من المخزون عبر {q} وحدة، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
      },
      splitShare: {
        en: "Maintenance took {s}% of the value ({m} SAR); exit permits took the rest ({e} SAR).",
        ar: "استحوذت الصيانة على {s}% من القيمة ({m} SAR)؛ وأخذت أذونات الخروج الباقي ({e} SAR).",
      },
      allMaintenance: {
        en: "Everything consumed this week went to in-house maintenance — no exit permits.",
        ar: "كل ما استُهلك هذا الأسبوع ذهب إلى الصيانة الداخلية — بلا أذونات خروج.",
      },
      allExits: {
        en: "Everything consumed this week left on exit permits — no maintenance draws.",
        ar: "كل ما استُهلك هذا الأسبوع خرج بأذونات خروج — بلا سحب للصيانة.",
      },
      topPart: {
        en: "{p} was the biggest single item at {v} SAR.",
        ar: "{p} كانت أكبر بند منفرد بقيمة {v} SAR.",
      },
      topPartHalf: {
        en: "{p} was the biggest single item at {v} SAR — over half the week's value on its own.",
        ar: "{p} كانت أكبر بند منفرد بقيمة {v} SAR — أكثر من نصف قيمة الأسبوع وحدها.",
      },
      // {n} work orders. Bucket `few` also carries ZERO, which is why its
      // English says "orders" — plural(0) is "few" and English prints "0 work
      // orders", exactly what the old `jobs === 1 ? "" : "s"` printed.
      workOrders: {
        one: { en: "{n} work order drew parts this week.", ar: "أمر عمل واحد سحب قطعاً هذا الأسبوع." },
        two: { en: "{n} work orders drew parts this week.", ar: "أمرا عمل سحبا قطعاً هذا الأسبوع." },
        few: { en: "{n} work orders drew parts this week.", ar: "{n} أوامر عمل سحبت قطعاً هذا الأسبوع." },
        many: { en: "{n} work orders drew parts this week.", ar: "{n} أمر عمل سحب قطعاً هذا الأسبوع." },
      },
      workOrdersUp: {
        one: {
          en: "{n} work order drew parts this week, up {d}% in value on last week.",
          ar: "أمر عمل واحد سحب قطعاً هذا الأسبوع، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
        two: {
          en: "{n} work orders drew parts this week, up {d}% in value on last week.",
          ar: "أمرا عمل سحبا قطعاً هذا الأسبوع، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
        few: {
          en: "{n} work orders drew parts this week, up {d}% in value on last week.",
          ar: "{n} أوامر عمل سحبت قطعاً هذا الأسبوع، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
        many: {
          en: "{n} work orders drew parts this week, up {d}% in value on last week.",
          ar: "{n} أمر عمل سحب قطعاً هذا الأسبوع، بارتفاع {d}% في القيمة عن الأسبوع الماضي.",
        },
      },
      workOrdersDown: {
        one: {
          en: "{n} work order drew parts this week, down {d}% in value on last week.",
          ar: "أمر عمل واحد سحب قطعاً هذا الأسبوع، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
        two: {
          en: "{n} work orders drew parts this week, down {d}% in value on last week.",
          ar: "أمرا عمل سحبا قطعاً هذا الأسبوع، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
        few: {
          en: "{n} work orders drew parts this week, down {d}% in value on last week.",
          ar: "{n} أوامر عمل سحبت قطعاً هذا الأسبوع، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
        many: {
          en: "{n} work orders drew parts this week, down {d}% in value on last week.",
          ar: "{n} أمر عمل سحب قطعاً هذا الأسبوع، بانخفاض {d}% في القيمة عن الأسبوع الماضي.",
        },
      },
      topTruck: {
        one: {
          en: "{plate} drew the most maintenance parts — {v} SAR across {n} job.",
          ar: "{plate} سحبت أكثر قطع الصيانة — {v} SAR عبر عمل واحد.",
        },
        two: {
          en: "{plate} drew the most maintenance parts — {v} SAR across {n} jobs.",
          ar: "{plate} سحبت أكثر قطع الصيانة — {v} SAR عبر عملين.",
        },
        few: {
          en: "{plate} drew the most maintenance parts — {v} SAR across {n} jobs.",
          ar: "{plate} سحبت أكثر قطع الصيانة — {v} SAR عبر {n} أعمال.",
        },
        many: {
          en: "{plate} drew the most maintenance parts — {v} SAR across {n} jobs.",
          ar: "{plate} سحبت أكثر قطع الصيانة — {v} SAR عبر {n} عملاً.",
        },
      },
      repeatTrucks: {
        en: "{list} came back for parts more than once this week.",
        ar: "{list} عادت لطلب قطع أكثر من مرة هذا الأسبوع.",
      },
      noWorkOrder: {
        en: "No work order drew parts this week.",
        ar: "لم يسحب أي أمر عمل قطعاً هذا الأسبوع.",
      },
      noExitPermit: {
        en: "No parts left on an exit permit this week.",
        ar: "لم تخرج أي قطع بإذن خروج هذا الأسبوع.",
      },
      permits: {
        one: { en: "{n} exit permit took stock out.", ar: "إذن خروج واحد أخرج مخزوناً." },
        two: { en: "{n} exit permits took stock out.", ar: "إذنا خروج أخرجا مخزوناً." },
        few: { en: "{n} exit permits took stock out.", ar: "{n} أذونات خروج أخرجت مخزوناً." },
        many: { en: "{n} exit permits took stock out.", ar: "{n} إذن خروج أخرج مخزوناً." },
      },
      permitsTo: {
        one: {
          en: "{n} exit permit took stock out, mostly to {dest} ({v} SAR).",
          ar: "إذن خروج واحد أخرج مخزوناً، معظمه إلى {dest} ({v} SAR).",
        },
        two: {
          en: "{n} exit permits took stock out, mostly to {dest} ({v} SAR).",
          ar: "إذنا خروج أخرجا مخزوناً، معظمه إلى {dest} ({v} SAR).",
        },
        few: {
          en: "{n} exit permits took stock out, mostly to {dest} ({v} SAR).",
          ar: "{n} أذونات خروج أخرجت مخزوناً، معظمه إلى {dest} ({v} SAR).",
        },
        many: {
          en: "{n} exit permits took stock out, mostly to {dest} ({v} SAR).",
          ar: "{n} إذن خروج أخرج مخزوناً، معظمه إلى {dest} ({v} SAR).",
        },
      },
      // Outstanding returnable stock, no overdue permits. Shared by BOTH call
      // sites — the quiet-week tail and the normal-week tail print the exact
      // same English here, so one key is right rather than two.
      stillOut: {
        one: {
          en: "{v} SAR of returnable stock is still out across {q} units.",
          ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة.",
        },
        two: {
          en: "{v} SAR of returnable stock is still out across {q} units.",
          ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين.",
        },
        few: {
          en: "{v} SAR of returnable stock is still out across {q} units.",
          ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات.",
        },
        many: {
          en: "{v} SAR of returnable stock is still out across {q} units.",
          ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة.",
        },
      },
      // TWO counts in one sentence — units and overdue permits — so the whole
      // sentence is stored per (unit bucket, overdue bucket) pair. The quiet-week
      // tail; its English names no noun for the overdue count, and the Arabic
      // keeps that anaphora with "منها".
      stillOutOverdue: {
        one: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — واحد منها تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — اثنان منها تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — {o} منها تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — {o} منها تجاوز موعد الإرجاع." },
        },
        two: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — واحد منها تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — اثنان منها تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — {o} منها تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — {o} منها تجاوز موعد الإرجاع." },
        },
        few: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — واحد منها تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — اثنان منها تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — {o} منها تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — {o} منها تجاوز موعد الإرجاع." },
        },
        many: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — واحد منها تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — اثنان منها تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — {o} منها تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} past its due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — {o} منها تجاوز موعد الإرجاع." },
        },
      },
      // The normal-week tail. DIFFERENT English from `stillOutOverdue` above —
      // it names the permit and switches is/are — so it cannot share those keys
      // even though the two bullets are cousins.
      stillOutPermitOverdue: {
        one: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permit is past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — إذن واحد تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — إذنان تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — {o} أذونات تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدة واحدة — {o} إذناً تجاوز موعد الإرجاع." },
        },
        two: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permit is past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — إذن واحد تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — إذنان تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — {o} أذونات تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر وحدتين — {o} إذناً تجاوز موعد الإرجاع." },
        },
        few: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permit is past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — إذن واحد تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — إذنان تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — {o} أذونات تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدات — {o} إذناً تجاوز موعد الإرجاع." },
        },
        many: {
          one: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permit is past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — إذن واحد تجاوز موعد الإرجاع." },
          two: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — إذنان تجاوزا موعد الإرجاع." },
          few: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — {o} أذونات تجاوزت موعد الإرجاع." },
          many: { en: "{v} SAR of returnable stock is still out across {q} units — {o} permits are past the due-back date.", ar: "{v} SAR من المخزون القابل للإرجاع لا يزال خارج المستودع عبر {q} وحدة — {o} إذناً تجاوز موعد الإرجاع." },
        },
      },
      // Value and quantity moved in different directions. FOUR leaves, not two:
      // `delta === 0` has sign 0, so it clears the "signs differ" guard while
      // still taking the `>= 0` branch — the up/up and down/down pairs are
      // reachable and were reachable before this conversion too.
      mixUpUp: {
        en: "Value went up while quantity went up — the mix shifted toward more expensive parts, not just more of them.",
        ar: "ارتفعت القيمة وارتفعت الكمية — تحوّل المزيج نحو قطع أغلى، لا مجرد عدد أكبر منها.",
      },
      mixUpDown: {
        en: "Value went up while quantity went down — the mix shifted toward more expensive parts, not just more of them.",
        ar: "ارتفعت القيمة بينما انخفضت الكمية — تحوّل المزيج نحو قطع أغلى، لا مجرد عدد أكبر منها.",
      },
      mixDownUp: {
        en: "Value went down while quantity went up — the mix shifted toward cheaper parts, not just more of them.",
        ar: "انخفضت القيمة بينما ارتفعت الكمية — تحوّل المزيج نحو قطع أرخص، لا مجرد عدد أكبر منها.",
      },
      mixDownDown: {
        en: "Value went down while quantity went down — the mix shifted toward cheaper parts, not just more of them.",
        ar: "انخفضت القيمة وانخفضت الكمية — تحوّل المزيج نحو قطع أرخص، لا مجرد عدد أكبر منها.",
      },
    },

    // -----------------------------------------------------------------------
    // PAGE SHELL + EXIT PERMITS TAB — app/consumption/ConsumptionClient.tsx.
    //
    // VOCABULARY RULING — REVERSED at Turki's instruction. An exit permit is a
    // GATE PASS: paper that authorises stock to leave the warehouse for a reason
    // that is not a repair. The Arabic is «إذن خروج» throughout.
    //
    // IT WAS «تصريح خروج», AND THE OLD RULING HERE SAID TO AVOID «إذن» ENTIRELY,
    // because a stores ISSUE note — which is what a maintenance draw is — is
    // «إذن صرف», a different document in a Saudi warehouse. Reversing the ruling
    // did not retire that risk. It SHARPENED it: the two names are now one word
    // apart. «إذن خروج» is the gate pass, «إذن صرف» is the issue note, nothing on
    // this route may say «إذن صرف», and a bare «إذن» here is always the gate pass
    // because the gate pass is the only document this route models.
    //
    // Plural «أذونات»; dual «إذنان», or «إذنا خروج» inside the construct, where
    // the nūn drops. «إذن» is masculine exactly as «تصريح» was, and «أذونات» is a
    // non-human plural exactly as «تصاريح» was, so no verb or adjective agreement
    // moved with the swap — which is why the sweep was safe once the two
    // exceptions above it were pulled out by hand.
    //
    // The FIVE STATE WORDS below are the route's spine, so they sit together:
    // the filter chips, the KPI tiles and the row pill are three views of the
    // same five states. A state renamed here is renamed in all three places
    // rather than in one of them.
    //   - draft   «مسودة»  — written, nothing has moved.
    //   - out     «خارج»   — stock has physically left. NOT «صادر», which reads
    //                        as "issued/dispatched" and would suggest the goods
    //                        are gone for good even on a returnable permit.
    //   - overdue «متأخر»  — a returnable that is past its due-back date.
    //   - voided  «ملغى»   — cancelled after exit; the outstanding quantity went
    //                        back to stock. NOT «محذوف» (deleted): the row and
    //                        its history survive, which is the whole point.
    //
    // `onDate` / `byWho` / `dashReason` are OPTIONAL APPENDAGES, each rendered
    // only when its column is non-null, so the line grows: "Voided" → "Voided on
    // {d}" → "Voided on {d} by {who}". THE LEADING SPACE IS PART OF THE VALUE in
    // both languages — it is what joins the clause to whatever preceded it, and
    // Arabic joins an appositive the same way. They are not sentence fragments
    // being spliced into a grammar; they are independent phrases whose presence
    // is decided by the data.
    // -----------------------------------------------------------------------
    client: {
      tabUsage: { en: "Consumptions", ar: "الاستهلاك" },
      tabPermits: { en: "Exit Permits", ar: "أذونات الخروج" },
      tabApprovals: { en: "Approvals", ar: "الاعتمادات" },

      title: { en: "Consumption", ar: "الاستهلاك" },
      subtitle: {
        en: "Where parts go when they leave the shelf — usage, exit permits and reporting",
        ar: "إلى أين تذهب القطع بعد مغادرتها الرف — الاستهلاك وأذونات الخروج والتقارير",
      },
      newPermit: { en: "New Exit Permit", ar: "إذن خروج جديد" },

      // deleteExitPermitDraft(). A draft has drawn no stock, which is exactly
      // why the confirm can promise that nothing is reversed.
      deleteDraftConfirm: {
        en: "Delete this draft permit? Nothing has left the warehouse, so nothing is reversed.",
        ar: "هل تريد حذف هذه المسودة؟ لم يخرج شيء من المستودع، فلا شيء سيُعكس.",
      },
      fileOpenFailed: { en: "Could not open file.", ar: "تعذّر فتح الملف." },

      kpiDrafts: { en: "Drafts", ar: "المسودات" },
      kpiOut: { en: "Out on permit", ar: "خارج بإذن" },
      kpiOverdue: { en: "Overdue returns", ar: "إرجاعات متأخرة" },
      kpiValueOut: { en: "Value outstanding", ar: "القيمة القائمة" },
      kpiValueOutHint: {
        en: "FIFO cost of what is out and not yet back",
        ar: "تكلفة ما هو خارج ولم يعُد بعد، بالوارد أولًا",
      },

      // The five state words — see this namespace's header.
      statusAll: { en: "All", ar: "الكل" },
      statusDraft: { en: "Draft", ar: "مسودة" },
      statusDrafts: { en: "Drafts", ar: "مسودات" },
      statusOut: { en: "Out", ar: "خارج" },
      statusOverdue: { en: "Overdue", ar: "متأخر" },
      statusVoided: { en: "Voided", ar: "ملغى" },

      // Two WHOLE sentences rather than one with a swapped tail. The old code
      // appended " yet" or " match this filter" to a shared stem — an
      // English-shaped seam: Arabic negates the whole clause, so the two
      // sentences do not share a stem there.
      emptyYet: { en: "No exit permits yet.", ar: "لا توجد أذونات خروج بعد." },
      emptyFiltered: {
        en: "No exit permits match this filter.",
        ar: "لا توجد أذونات خروج تطابق هذه التصفية.",
      },
      emptyHint: {
        en: "A permit is the gate pass for parts leaving for a non-maintenance reason.",
        ar: "الإذن هو وثيقة مرور القطع من البوابة لسبب غير الصيانة.",
      },

      // Receiver / Warehouse / Items / Qty out / Outstanding are NOT here —
      // the modals render the same five headers, so they live in
      // `consumption.shared`. Only the two this file alone renders stay local.
      colValueOut: { en: "Value out", ar: "القيمة الخارجة" },
      colReturned: { en: "Returned", ar: "المُرجَع" },

      // Row detail. `{d}` is a formatDate() result and `{n}` a Latin numeral —
      // figures and dates stay Latin in both languages, the standing rule.
      dueOn: { en: "due {d}", ar: "تُستحق {d}" },
      via: { en: "via {name}", ar: "عبر {name}" },
      qtyOutstanding: { en: "{n} out", ar: "{n} خارج" },
      daysOverdue: { en: "{n}d overdue", ar: "متأخر {n} يوم" },

      // `confirmExit` and `voidPermit` are in `consumption.shared` — each names
      // both the row button HERE and the title of the modal it opens.
      editDraft: { en: "Edit draft", ar: "تعديل المسودة" },
      deleteDraft: { en: "Delete draft", ar: "حذف المسودة" },
      returnBtn: { en: "Return", ar: "إرجاع" },
      printablePermit: { en: "Printable permit", ar: "إذن للطباعة" },

      noPriceTitle: {
        en: "Not enough stock in lots to price this item",
        ar: "لا توجد كمية كافية في الدفعات لتسعير هذا الصنف",
      },
      // The tag under a DRAFT's unit cost — the figure is a FIFO preview, not
      // the stamped cost, because a draft has drawn nothing yet — is
      // `consumption.shared.previewTag`; the draft form says it too.

      // `{n}` is a Latin numeral inside parentheses, so one form serves every
      // count in both languages — no plural bucket is needed for a bare tally.
      returnsHeading: { en: "Returns ({n})", ar: "الإرجاعات ({n})" },
      attachmentsHeading: { en: "Attachments ({n})", ar: "المرفقات ({n})" },
      // One returned line inside a return's summary: "3 × Oil filter".
      returnItem: { en: "{q} × {p}", ar: "{q} × {p}" },
      // The part behind a return line could not be resolved — a deleted line,
      // in practice. Arabic has its own question mark.
      unknownShort: { en: "?", ar: "؟" },

      // Optional appendages — see this namespace's header for the leading space.
      onDate: { en: " on {d}", ar: " في {d}" },
      byWho: { en: " by {who}", ar: " بواسطة {who}" },
      dashReason: { en: " — {reason}", ar: " — {reason}" },
      voidedNote: {
        en: "Only the outstanding quantity was restored; anything already returned had gone back with its own return event.",
        ar: "أُعيدت الكمية القائمة فقط؛ أما ما أُرجع سابقًا فقد عاد بحركة إرجاع خاصة به.",
      },
      issuedBy: { en: "Issued by {who}.", ar: "أصدره {who}." },
      exitedAt: { en: "Exited {d}", ar: "خرج {d}" },
    },

    // -----------------------------------------------------------------------
    // APPROVALS TAB — app/consumption/ApprovalsTab.tsx.
    //
    // VOCABULARY RULING for review, because this screen is the one that reads
    // wrong if the Arabic is picked casually: an approval here is a RECORD of
    // an opinion, not a GATE. Nothing on the screen blocks anything — the
    // parts already left, the job already happened. So the Arabic says
    // «سجل» / «قرار مسجَّل» and never «موافقة مطلوبة» or «بانتظار الإفراج»,
    // which would tell a reader that work is being held up when it is not.
    //
    // «اعتماد» is used for the ACT of approving and «سجل الاعتمادات» for the
    // ledger it lands in, matching archive.approvalsLedger.
    //
    // Counted sentences here use the same four-bucket treatment as `weekly`,
    // even where the count comes from a CONSTANT (APPROVALS_REQUIRED = 2,
    // LEDGER_LOCK_DAYS = 30). A constant is still a number an Arabic noun has
    // to agree with, and bucketing it means changing the constant cannot
    // silently break the grammar. English is written identically across the
    // four buckets, so whichever fires the English byte is unchanged.
    // -----------------------------------------------------------------------
    approvalsTab: {
      // conflictMessage(). Composed in the app rather than taken from the
      // 0097 raise, so it can name WHO voted. Two whole sentences rather than
      // one with a swapped verb: Arabic changes the verb, not a lowercase word.
      conflictApproved: {
        en: "Conflict — {who} already approved this. A second vote has to match theirs; a split decision is not allowed.",
        ar: "تعارض — {who} اعتمد هذا بالفعل. على الصوت الثاني أن يطابق صوته؛ القرار المنقسم غير مسموح.",
      },
      conflictRejected: {
        en: "Conflict — {who} already rejected this. A second vote has to match theirs; a split decision is not allowed.",
        ar: "تعارض — {who} رفض هذا بالفعل. على الصوت الثاني أن يطابق صوته؛ القرار المنقسم غير مسموح.",
      },

      filterAll: { en: "All kinds", ar: "كل الأنواع" },
      // Same text as `consumption.usage.sourceExitPermits` today, deliberately
      // NOT the same key: one names a filter over approval events, the other
      // names where a usage row came from. They are free to diverge and a
      // shared key would silently couple two unrelated rewords.
      filterExitPermits: { en: "Exit permits", ar: "أذونات الخروج" },
      filterWorkOrders: { en: "In-house work orders", ar: "أوامر العمل الداخلية" },
      filterOutsourcedJobs: { en: "Outsourced jobs", ar: "الأعمال الخارجية" },

      kpiPending: { en: "Awaiting a decision", ar: "بانتظار قرار" },
      kpiOneVote: { en: "Have one vote", ar: "لديها صوت واحد" },
      kpiOneVoteHint: { en: "Need a matching second", ar: "تحتاج صوتًا ثانيًا مطابقًا" },
      kpiDecided: { en: "Decided", ar: "محسومة" },
      kpiDecidedHint: { en: "Moved to the Approvals Ledger", ar: "انتقلت إلى سجل الاعتمادات" },
      kpiValue: { en: "Value pending", ar: "قيمة معلّقة" },
      kpiValueHint: {
        en: "Parts and vendor spend not yet ruled on",
        ar: "قطع وإنفاق موردين لم يُبتّ فيها بعد",
      },

      // The Arabic arrow is «←», not «→». In an RTL line the reading order is
      // right-to-left, so a right-pointing arrow would point back at the
      // source. Same char class, mirrored, same meaning.
      explainer: {
        one: {
          en: "Two matching votes decide an event — the second voter must agree with the first, and a differing vote is refused. A decision here is a record, not a gate: it moves no stock and changes nothing about the permit, work order or job. Decided events leave this tab for Archive → Approvals Ledger, where they stay changeable for {n} days.",
          ar: "يُحسم الحدث بصوتين متطابقين — على المصوّت الثاني أن يوافق الأول، ويُرفض أي صوت مخالف. القرار هنا سجل لا بوابة: لا يحرّك مخزونًا ولا يغيّر شيئًا في الإذن أو أمر العمل أو العمل الخارجي. تغادر الأحداث المحسومة هذا التبويب إلى الأرشيف ← سجل الاعتمادات، حيث تبقى قابلة للتغيير يومًا واحدًا.",
        },
        two: {
          en: "Two matching votes decide an event — the second voter must agree with the first, and a differing vote is refused. A decision here is a record, not a gate: it moves no stock and changes nothing about the permit, work order or job. Decided events leave this tab for Archive → Approvals Ledger, where they stay changeable for {n} days.",
          ar: "يُحسم الحدث بصوتين متطابقين — على المصوّت الثاني أن يوافق الأول، ويُرفض أي صوت مخالف. القرار هنا سجل لا بوابة: لا يحرّك مخزونًا ولا يغيّر شيئًا في الإذن أو أمر العمل أو العمل الخارجي. تغادر الأحداث المحسومة هذا التبويب إلى الأرشيف ← سجل الاعتمادات، حيث تبقى قابلة للتغيير يومين.",
        },
        few: {
          en: "Two matching votes decide an event — the second voter must agree with the first, and a differing vote is refused. A decision here is a record, not a gate: it moves no stock and changes nothing about the permit, work order or job. Decided events leave this tab for Archive → Approvals Ledger, where they stay changeable for {n} days.",
          ar: "يُحسم الحدث بصوتين متطابقين — على المصوّت الثاني أن يوافق الأول، ويُرفض أي صوت مخالف. القرار هنا سجل لا بوابة: لا يحرّك مخزونًا ولا يغيّر شيئًا في الإذن أو أمر العمل أو العمل الخارجي. تغادر الأحداث المحسومة هذا التبويب إلى الأرشيف ← سجل الاعتمادات، حيث تبقى قابلة للتغيير {n} أيام.",
        },
        many: {
          en: "Two matching votes decide an event — the second voter must agree with the first, and a differing vote is refused. A decision here is a record, not a gate: it moves no stock and changes nothing about the permit, work order or job. Decided events leave this tab for Archive → Approvals Ledger, where they stay changeable for {n} days.",
          ar: "يُحسم الحدث بصوتين متطابقين — على المصوّت الثاني أن يوافق الأول، ويُرفض أي صوت مخالف. القرار هنا سجل لا بوابة: لا يحرّك مخزونًا ولا يغيّر شيئًا في الإذن أو أمر العمل أو العمل الخارجي. تغادر الأحداث المحسومة هذا التبويب إلى الأرشيف ← سجل الاعتمادات، حيث تبقى قابلة للتغيير {n} يومًا.",
        },
      },

      // THREE empty states, because they mean three different things — a
      // filter that matched nothing, a queue that is genuinely finished, and
      // a queue that has never had anything in it. The Arabic keeps them
      // three; collapsing them would blame a filter for a relocation.
      emptyFiltered: { en: "No events match these filters.", ar: "لا توجد أحداث تطابق هذه المرشّحات." },
      emptyAllDecided: { en: "Everything has been decided.", ar: "حُسم كل شيء." },
      emptyNothingYet: { en: "Nothing to approve yet.", ar: "لا شيء للاعتماد بعد." },
      emptyDecidedHint: {
        en: "Decided events live in Archive → Approvals Ledger.",
        ar: "الأحداث المحسومة تعيش في الأرشيف ← سجل الاعتمادات.",
      },
      emptyNothingYetHint: {
        en: "Exited permits, completed in-house work orders that used parts, and outsourced jobs with a vendor payment all show up here.",
        ar: "تظهر هنا الأذونات التي خرجت، وأوامر العمل الداخلية المكتملة التي استهلكت قطعًا، والأعمال الخارجية التي لها دفعة مورّد.",
      },

      // No colStatus / colPart / colQty / colNote / cancel here: those are
      // generic table-and-form chrome and `common` already holds them, spelled
      // the same way in both languages. No colValue / colTotal either — the
      // Parts Usage tab's tables need the same two words, so they sit in
      // `consumption.shared` at the top of this namespace.
      //
      // The route-scoped copies that DO stay below (colDate, colRepairer,
      // colSubtotal, colVat, colDiscount) exist because their only other home
      // is `mt.*` — the maintenance track's own namespace — and nothing in this
      // repo reads one route's namespace from another. `common.note` /
      // `mt.note` are already a matching pair on exactly that reasoning.
      colReference: { en: "Reference", ar: "المرجع" },
      colWhat: { en: "What", ar: "ماذا" },
      colWhen: { en: "When", ar: "متى" },
      colVotes: { en: "Votes", ar: "الأصوات" },


      awaitingSecond: { en: "awaiting a matching second vote", ar: "بانتظار صوت ثانٍ مطابق" },
      signInToDecide: { en: "Sign in to decide", ar: "سجّل الدخول لتقرّر" },
      approve: { en: "Approve", ar: "اعتماد" },
      approveInstead: { en: "Approve instead", ar: "اعتماد بدلًا من ذلك" },
      reject: { en: "Reject", ar: "رفض" },
      rejectInstead: { en: "Reject instead", ar: "رفض بدلًا من ذلك" },
      youApproved: { en: "You approved this", ar: "أنت اعتمدت هذا" },
      youRejected: { en: "You rejected this", ar: "أنت رفضت هذا" },

      // The expanded-row heading. Three whole labels rather than a kind label
      // plus a " — parts" / " — vendor payment" tail: the tail is an English
      // apposition and Arabic wants the noun phrase built differently.
      detailExitPermit: { en: "Exit permit — parts", ar: "إذن خروج — قطع" },
      detailWorkOrder: { en: "Work order — parts", ar: "أمر عمل — قطع" },
      detailOutsourcedJob: { en: "Outsourced job — vendor payment", ar: "عمل خارجي — دفعة مورّد" },

      colInvoice: { en: "Invoice", ar: "الفاتورة" },
      colDate: { en: "Date", ar: "التاريخ" },
      colRepairer: { en: "Repairer", ar: "الورشة" },
      colSubtotal: { en: "Subtotal", ar: "المجموع الفرعي" },
      colVat: { en: "VAT", ar: "ضريبة القيمة المضافة" },
      colDiscount: { en: "Discount", ar: "الخصم" },


      stillOutNote: {
        en: "Quantities are what is still OUT — anything returned is back on the shelf and is not counted here.",
        ar: "الكميات هي ما زال خارجًا — كل ما أُرجع عاد إلى الرف ولا يُحتسب هنا.",
      },

      // "{n} of {r} votes — needs a matching second to decide". Bucketed on
      // the vote count: Arabic says «صوت واحد» / «صوتان» / «{n} أصوات».
      votesOf: {
        one: {
          en: "{n} of {r} votes — needs a matching second to decide",
          ar: "صوت واحد من {r} — يحتاج صوتًا ثانيًا مطابقًا ليُحسم",
        },
        two: {
          en: "{n} of {r} votes — needs a matching second to decide",
          ar: "صوتان من {r} — يحتاج صوتًا ثانيًا مطابقًا ليُحسم",
        },
        few: {
          en: "{n} of {r} votes — needs a matching second to decide",
          ar: "{n} أصوات من {r} — يحتاج صوتًا ثانيًا مطابقًا ليُحسم",
        },
        many: {
          en: "{n} of {r} votes — needs a matching second to decide",
          ar: "{n} صوتًا من {r} — يحتاج صوتًا ثانيًا مطابقًا ليُحسم",
        },
      },

      signedBy: { en: "by {who}", ar: "بواسطة {who}" },
      signedOn: { en: "on {when}", ar: "في {when}" },
      signedYou: { en: "(you)", ar: "(أنت)" },
      firstDecided: { en: "first decided {when}", ar: "أول قرار في {when}" },

      notRuled: {
        one: { en: "Not yet ruled on — needs {n} approvals.", ar: "لم يُبتّ فيه بعد — يحتاج اعتمادًا واحدًا." },
        two: { en: "Not yet ruled on — needs {n} approvals.", ar: "لم يُبتّ فيه بعد — يحتاج اعتمادين." },
        few: { en: "Not yet ruled on — needs {n} approvals.", ar: "لم يُبتّ فيه بعد — يحتاج {n} اعتمادات." },
        many: { en: "Not yet ruled on — needs {n} approvals.", ar: "لم يُبتّ فيه بعد — يحتاج {n} اعتمادًا." },
      },

      conflictTitle: { en: "Vote not recorded", ar: "لم يُسجَّل الصوت" },
      conflictGotIt: { en: "Got it", ar: "فهمت" },

      rejectTitle: { en: "Reject {ref}", ar: "رفض {ref}" },
      // The SEAM. Was `APPROVAL_KIND_LABELS[kind].toLowerCase()` dropped into
      // the sentence — an English-shaped move (Arabic has no letter case, so
      // it was a no-op and left a Title-Case noun mid-clause). The kind now
      // comes from APPROVAL_KIND_INLINE, a proper inline form per language.
      rejectSubtitle: {
        en: "This records a rejection against {kind} {ref}. Nothing is reversed and no stock moves.",
        ar: "يسجّل هذا رفضًا على {kind} {ref}. لا يُعكس شيء ولا يتحرك أي مخزون.",
      },
      reasonLabel: { en: "Reason *", ar: "السبب *" },
      reasonPlaceholder: { en: "What is wrong with this one?", ar: "ما الخطأ في هذا؟" },
      // `Recording…` is `consumption.shared.recording` — the return popup's
      // submit button carries the same in-flight label.
      recordRejection: { en: "Record rejection", ar: "تسجيل الرفض" },
    },

    // ------------------------------------------------------------------
    // app/consumption/PartsUsageTab.tsx — the analytics tab.
    //
    // PURE READOUT. Every string here is a heading, a hint, a column, an empty
    // state or a chart legend; the only pressable words are the two "view all"
    // links and Close. So the Arabic voice here is DESCRIPTIVE, not
    // imperative — no «اضغط», no «قم بـ».
    //
    // WHAT IS DELIBERATELY NOT MINTED HERE:
    //   - Part / Qty / Truck come from `common`, which already holds them.
    //   - Value / Total / Destination / Permit / Close come from
    //     `consumption.shared` — this tab is not their only reader.
    //   - The two KPI tiles and two of the three source chips say
    //     "Maintenance" and "Exit permits", which is exactly what
    //     lib/parts-usage.ts already labels those two sources, so they read
    //     `consumption.usage.sourceMaintenance` / `sourceExitPermits` rather
    //     than a second copy that could drift from the bars beside them.
    //
    // SAR IS NOT TRANSLATED anywhere in this namespace. It is a currency code
    // and it stays Latin in both languages, the same standing rule that keeps
    // every figure and date on this tab in Latin digits.
    // ------------------------------------------------------------------
    partsUsage: {
      emptyTitle: { en: "No parts have left stock yet.", ar: "لم تخرج أي قطع من المخزون بعد." },
      emptyHint: {
        en: "Consumption appears here once a work order deducts its parts or an exit permit is confirmed.",
        ar: "يظهر الاستهلاك هنا بمجرد أن يخصم أمر عمل قطعه أو يُعتمد إذن خروج.",
      },

      // The line under the period picker. `{cur}` is rendered EMPHASISED, so
      // the tab splits this string on that token and prints the two halves
      // around a <span>. That is why `{cur}` MUST come before `{prev}` in
      // every language: only the tail half has `{prev}` substituted into it.
      showingAgainst: { en: "Showing {cur} against {prev}", ar: "عرض {cur} مقابل {prev}" },

      kpiConsumed: { en: "Consumed this period", ar: "المستهلك في هذه الفترة" },
      kpiOutNotBack: { en: "Out and not back", ar: "خارج ولم يعد" },
      kpiOutNote: { en: "Right now — not period-scoped", ar: "الآن — غير مقيّد بالفترة" },
      deltaInValue: { en: "in value", ar: "في القيمة" },

      srcAll: { en: "Everything", ar: "كل شيء" },
      srcMaintenance: { en: "Maintenance only", ar: "الصيانة فقط" },
      srcExitPermits: { en: "Exit permits only", ar: "أذونات الخروج فقط" },
      fifoNote: {
        en: "Every figure is the FIFO cost stamped when the stock moved.",
        ar: "كل رقم هنا هو تكلفة «الوارد أولاً صادر أولاً» المثبّتة لحظة تحرّك المخزون.",
      },

      trendTitle: { en: "Total consumption over time", ar: "إجمالي الاستهلاك عبر الزمن" },
      trendHint: {
        en: "Everything that left stock — maintenance draws and exit permits together — with a 3-point moving average. Full history, independent of the period picker.",
        ar: "كل ما خرج من المخزون — سحوبات الصيانة وأذونات الخروج معاً — مع متوسط متحرك من ثلاث نقاط. السجل الكامل، مستقل عن مُحدِّد الفترة.",
      },
      monthlyTitle: { en: "Monthly trend — value and quantity", ar: "الاتجاه الشهري — القيمة والكمية" },
      monthlyHint: {
        en: "Both measures side by side on their own axes, over the last 12 months. A month with nothing in it stays on the axis.",
        ar: "المقياسان جنباً إلى جنب، كلٌّ على محوره، خلال آخر 12 شهراً. الشهر الذي لم يحدث فيه شيء يبقى على المحور.",
      },

      weekTitle: { en: "This week in review", ar: "الأسبوع في سطور" },
      weekHint: {
        en: "{w} — rolls over on its own every week, whatever the period picker says",
        ar: "{w} — يتجدد من تلقاء نفسه كل أسبوع مهما كان اختيار مُحدِّد الفترة",
      },

      trucksTitle: { en: "Top 5 costly trucks", ar: "أعلى 5 شاحنات تكلفة" },
      trucksHint: {
        en: "Maintenance parts drawn per truck this period",
        ar: "قطع الصيانة المسحوبة لكل شاحنة في هذه الفترة",
      },
      viewAllTrucks: { en: "View all trucks", ar: "عرض كل الشاحنات" },
      viewAllParts: { en: "View all parts", ar: "عرض كل القطع" },
      truckEmpty: {
        en: "No maintenance parts were drawn this period.",
        ar: "لم تُسحب أي قطع صيانة في هذه الفترة.",
      },
      colVisits: { en: "Times to maintenance", ar: "مرات دخول الصيانة" },
      colTruckValue: { en: "Total maintenance value", ar: "إجمالي قيمة الصيانة" },

      topValueTitle: { en: "Top 5 parts by value", ar: "أعلى 5 قطع بالقيمة" },
      topValueHint: {
        en: "What consumption is costing most this period",
        ar: "ما الأكثر كلفة في استهلاك هذه الفترة",
      },
      topQtyTitle: { en: "Top 5 parts by quantity", ar: "أعلى 5 قطع بالكمية" },
      topQtyHint: { en: "What moves most often this period", ar: "ما الأكثر حركة في هذه الفترة" },
      notUsed: { en: "not used this period", ar: "لم تُستخدم في هذه الفترة" },

      splitTitle: { en: "Maintenance vs exit permits", ar: "الصيانة مقابل أذونات الخروج" },
      splitHint: { en: "Where this period's consumption went", ar: "إلى أين ذهب استهلاك هذه الفترة" },
      warehouseTitle: { en: "By warehouse", ar: "حسب المستودع" },
      warehouseHint: { en: "Which stock room it came out of", ar: "من أي مخزن خرجت" },
      warehouseEmpty: { en: "No warehouse data this period.", ar: "لا توجد بيانات مستودعات لهذه الفترة." },
      destTitle: { en: "By destination", ar: "حسب الوجهة" },
      destHint: {
        en: "Exit permits only — maintenance has no destination",
        ar: "أذونات الخروج فقط — الصيانة بلا وجهة",
      },
      destEmpty: { en: "No exit permits left this period.", ar: "لم تخرج أي أذونات خروج في هذه الفترة." },
      // One key, two call sites: the source-split bars and the top-parts
      // tables print the same sentence when their period is empty.
      nothingConsumed: { en: "Nothing consumed this period.", ar: "لم يُستهلك شيء في هذه الفترة." },

      outTitle: { en: "Currently out and not back", ar: "خارج حالياً ولم يعد" },
      outHint: {
        en: "Returnable permits still holding stock — as of now",
        ar: "الأذونات القابلة للإرجاع التي ما زالت تحتجز مخزوناً — حتى اللحظة",
      },
      outEmpty: {
        en: "Nothing is out — every returnable permit is back.",
        ar: "لا شيء خارج — كل إذن قابل للإرجاع قد عاد.",
      },
      colDueBack: { en: "Due back", ar: "موعد الإرجاع" },

      recordsTitle: {
        en: "In-house maintenance consumption history",
        ar: "سجل استهلاك الصيانة الداخلية",
      },
      recordsHint: {
        en: "Every part each completed work order drew from stock — full history, not period-scoped",
        ar: "كل قطعة سحبها كل أمر عمل مكتمل من المخزون — السجل الكامل، غير مقيّد بالفترة",
      },
      recordsEmpty: {
        en: "No completed work order has consumed parts yet.",
        ar: "لا يوجد أمر عمل مكتمل استهلك قطعاً بعد.",
      },
      colWorkOrder: { en: "Work order", ar: "أمر العمل" },
      colJob: { en: "Job", ar: "العمل" },
      colClosed: { en: "Closed", ar: "تاريخ الإغلاق" },
      colUnitCost: { en: "Unit cost", ar: "تكلفة الوحدة" },
      // The leading "·" is a separator between this tag and the SKU before it,
      // not punctuation belonging to either. It is a neutral character, so the
      // bidi algorithm places it on the correct side of an Arabic run on its
      // own — it does not need mirroring.
      preLedgerTag: { en: "· pre-ledger", ar: "· ما قبل السجل" },
      // The pre-ledger footnote. English inflected three words off ONE count
      // (line/lines, predate/predates, its/their); Arabic inflects the noun
      // four ways and changes the verb with it, so each bucket is written
      // whole. The English is identical in every bucket and is the exact
      // sentence the three inline ternaries printed.
      preLedgerBanner: {
        one: {
          en: "{n} line predates the per-lot consumption ledger, so its cost comes from the work order's own stamped unit price instead of the lot breakdown. The figure is the same one the deduction recorded — there is just no per-lot detail behind it.",
          ar: "سطر واحد يسبق سجل الاستهلاك التفصيلي لكل دفعة، فتأتي تكلفته من سعر الوحدة المثبّت على أمر العمل نفسه بدلاً من تفصيل الدفعات. الرقم هو نفسه الذي سجّله الخصم — لا يوجد خلفه تفصيل لكل دفعة فقط.",
        },
        two: {
          en: "{n} lines predate the per-lot consumption ledger, so their cost comes from the work order's own stamped unit price instead of the lot breakdown. The figure is the same one the deduction recorded — there is just no per-lot detail behind it.",
          ar: "سطران يسبقان سجل الاستهلاك التفصيلي لكل دفعة، فتأتي تكلفتهما من سعر الوحدة المثبّت على أمر العمل نفسه بدلاً من تفصيل الدفعات. الرقم هو نفسه الذي سجّله الخصم — لا يوجد خلفه تفصيل لكل دفعة فقط.",
        },
        few: {
          en: "{n} lines predate the per-lot consumption ledger, so their cost comes from the work order's own stamped unit price instead of the lot breakdown. The figure is the same one the deduction recorded — there is just no per-lot detail behind it.",
          ar: "{n} أسطر تسبق سجل الاستهلاك التفصيلي لكل دفعة، فتأتي تكلفتها من سعر الوحدة المثبّت على أمر العمل نفسه بدلاً من تفصيل الدفعات. الرقم هو نفسه الذي سجّله الخصم — لا يوجد خلفه تفصيل لكل دفعة فقط.",
        },
        many: {
          en: "{n} lines predate the per-lot consumption ledger, so their cost comes from the work order's own stamped unit price instead of the lot breakdown. The figure is the same one the deduction recorded — there is just no per-lot detail behind it.",
          ar: "{n} سطراً تسبق سجل الاستهلاك التفصيلي لكل دفعة، فتأتي تكلفتها من سعر الوحدة المثبّت على أمر العمل نفسه بدلاً من تفصيل الدفعات. الرقم هو نفسه الذي سجّله الخصم — لا يوجد خلفه تفصيل لكل دفعة فقط.",
        },
      },

      modalTrucksTitle: { en: "All trucks by maintenance parts", ar: "كل الشاحنات حسب قطع الصيانة" },
      modalValueTitle: { en: "All parts by value", ar: "كل القطع حسب القيمة" },
      modalQtyTitle: { en: "All parts by quantity", ar: "كل القطع حسب الكمية" },
      modalAllPartsSubtitle: {
        en: "{w} — every part, including those that consumed nothing",
        ar: "{w} — كل قطعة، بما فيها ما لم يُستهلك منه شيء",
      },

      chartEmpty: { en: "No consumption yet.", ar: "لا استهلاك بعد." },
      legendTotal: { en: "Total consumption (SAR)", ar: "إجمالي الاستهلاك (SAR)" },
      // «ترند» is Turki's call: the transliteration, not «الاتجاه». It applies to
      // the LEGEND that names the moving-average line. `monthlyTitle` above still
      // reads «الاتجاه الشهري» — that is a chart TITLE, not a legend, and it is
      // left alone deliberately rather than swept along by the same word.
      legendTrend: { en: "Trend (3-point average)", ar: "ترند (متوسط ثلاث نقاط)" },
      legendValue: { en: "Value (SAR)", ar: "القيمة (SAR)" },
      legendQty: { en: "Quantity (units)", ar: "الكمية (وحدات)" },
      // The bare axis caption under the right-hand scale. Not the counted
      // form below — there is no number beside it.
      axisUnits: { en: "units", ar: "وحدة" },
      // Chart tooltips. The tokens carry data (`{l}` a bucket label, `{v}` a
      // SAR figure, `{q}` the counted-units string) and the dictionary owns the
      // punctuation and the order, so an RTL tooltip is not stuck with an
      // English colon-then-value shape it never chose.
      tipValue: { en: "{l}: {v}", ar: "{l}: {v}" },
      tipQty: { en: "{l}: {q}", ar: "{l}: {q}" },
      tipValueQty: { en: "{l}: {v} · {q}", ar: "{l}: {v} · {q}" },
      // "{n} units" — four sites (the KPI tile, the split bars, and two chart
      // tooltips). `{n}` is ALWAYS a formatted two-decimal figure, so the
      // Arabic keeps the numeral in every bucket and inflects only the noun
      // after it; dropping the numeral for «وحدة واحدة» would throw away the
      // ".00" the English shows. English is identical in all four buckets.
      units: {
        one: { en: "{n} units", ar: "{n} وحدة" },
        two: { en: "{n} units", ar: "{n} وحدة" },
        few: { en: "{n} units", ar: "{n} وحدات" },
        many: { en: "{n} units", ar: "{n} وحدة" },
      },
    },

    // -----------------------------------------------------------------------
    // app/consumption/ExitPermitModals.tsx — the draft form, the three popups
    // that move real stock (confirm exit / return / void), and the printable
    // gate copy.
    //
    // TWO EXACT CROSS-ROUTE DUPLICATES, both kept on purpose. These are the two
    // the duplicate checker reports — same English AND same Arabic as a key
    // that already exists under another route:
    //   - `colOnHand` ("On hand") repeats `mt.onHand`.
    //   - `uploading` ("Uploading…") repeats `settings.profile.uploading`.
    // Cross-route reuse is not something this dictionary does: those keys
    // belong to Maintenance and to Settings, and rewording a column or a
    // spinner there must not silently reword one here.
    //
    // TWO NEAR-MISSES that are NOT duplicates, listed so nobody "dedupes" them:
    //   - `chooseOption` ("Choose…") sits beside `common.selectPlaceholder`
    //     ("Select…"). Same Arabic, DIFFERENT English. The English distinction
    //     is arbitrary — one Arabic word is the honest reading of both — but
    //     the two English strings must stay separately editable.
    //   - `printVoided` ("VOIDED") vs `client.statusVoided` ("Voided"): the
    //     gate copy shouts, the list pill does not.
    //
    // REQUIRED-FIELD ASTERISKS sit OUTSIDE the key wherever the noun is one
    // this route already owns (Kind, Warehouse, Destination, Receiver), so a
    // word is not minted a second time just to carry a star. Where the label is
    // unique to this form the star is inside the value.
    //
    // A COUNTED SENTENCE IS STORED WHOLE, once per bucket. Note that unlike
    // `partsUsage.units` the ENGLISH here does inflect — "1 item" vs "2 items"
    // — so the `one` bucket carries the singular and the other three carry the
    // plural. `plural()` returns `one` only at exactly 1, which is the same
    // test the old `=== 1 ? "" : "s"` ternary made, so the English output is
    // byte-for-byte what it was before.
    // -----------------------------------------------------------------------
    modals: {
      // --- draft form: chrome ---
      formTitleEdit: { en: "Edit draft permit", ar: "تعديل مسودة الإذن" },
      formTitleNew: { en: "New exit permit", ar: "إذن خروج جديد" },
      formSubtitle: {
        en: "A draft moves no stock. Confirming the exit is what deducts it.",
        ar: "المسودة لا تحرّك أي مخزون. تأكيد الخروج هو ما يخصم الكمية.",
      },
      saveDetails: { en: "Save details", ar: "حفظ البيانات" },
      createDraft: { en: "Create draft", ar: "إنشاء مسودة" },
      createFailed: { en: "Could not create the draft.", ar: "تعذّر إنشاء المسودة." },
      sectionDestReceiver: { en: "Destination & receiver", ar: "الوجهة والمستلم" },
      sectionAttachments: { en: "Attachments", ar: "المرفقات" },

      // --- draft form: header fields ---
      // Rendered as `{key} {cond}` so the permanent branch keeps the trailing
      // space the old JSX produced. Do not fold the star into this value.
      labelExpectedReturn: { en: "Expected return", ar: "الإرجاع المتوقع" },
      permanentHint: {
        en: "Permanent items are not expected back.",
        ar: "القطع الدائمة غير متوقع رجوعها.",
      },
      warehouseLockedHint: {
        en: "Locked — items were picked from this warehouse.",
        ar: "مقفل — اختيرت الأصناف من هذا المستودع.",
      },
      labelDestType: { en: "Destination type *", ar: "نوع الوجهة *" },
      destOtherPlaceholder: { en: "Where are these going?", ar: "إلى أين ستذهب؟" },
      chooseOption: { en: "Choose…", ar: "اختر…" },
      receiverStaff: { en: "Staff member", ar: "موظف" },
      receiverExternal: { en: "External (name)", ar: "خارجي (بالاسم)" },
      receiverNamePlaceholder: { en: "Receiver name", ar: "اسم المستلم" },
      labelCarrier: { en: "Carrier / driver", ar: "الناقل / السائق" },
      carrierPlaceholder: { en: "Who is taking them", ar: "من سيأخذها" },

      // --- draft form: the add-an-item row ---
      choosePart: { en: "Choose a part…", ar: "اختر قطعة…" },
      // The picker's option line. `{sku}` and `{n}` are Latin in both
      // languages — a SKU is an identifier and a count is a figure.
      partOption: { en: "{sku} · {name} ({n} on hand)", ar: "{sku} · {name} (المتوفر {n})" },
      labelItemNote: { en: "Item note", ar: "ملاحظة الصنف" },
      noActiveParts: {
        en: "This warehouse has no active parts.",
        ar: "لا توجد قطع نشطة في هذا المستودع.",
      },
      // Items typed before the draft row exists. The Arabic names the button
      // («إنشاء مسودة») inside the sentence, matching `createDraft` above.
      pendingItems: {
        one: {
          en: "{n} item will be saved with the permit when you press Create draft.",
          ar: "سيُحفظ صنف واحد مع الإذن عند الضغط على إنشاء مسودة.",
        },
        two: {
          en: "{n} items will be saved with the permit when you press Create draft.",
          ar: "سيُحفظ صنفان مع الإذن عند الضغط على إنشاء مسودة.",
        },
        few: {
          en: "{n} items will be saved with the permit when you press Create draft.",
          ar: "ستُحفظ {n} أصناف مع الإذن عند الضغط على إنشاء مسودة.",
        },
        many: {
          en: "{n} items will be saved with the permit when you press Create draft.",
          ar: "سيُحفظ {n} صنفًا مع الإذن عند الضغط على إنشاء مسودة.",
        },
      },

      // --- draft form: the items table ---
      colOnHand: { en: "On hand", ar: "المتوفر" },
      colItemValue: { en: "Item value", ar: "قيمة الصنف" },
      // The fallback when a line points at a part the page did not load. NOT
      // `usage.unknownPart` ("Unknown part") — this one sits in a Part column
      // where the noun is already the header, so it stays the bare adjective.
      unknownPart: { en: "Unknown", ar: "غير معروف" },
      titleLotsShort: {
        en: "Lots cannot cover this quantity",
        ar: "الدفعات لا تغطي هذه الكمية",
      },
      removeItem: { en: "Remove item", ar: "إزالة الصنف" },
      totalUnitsValue: { en: "Total units value", ar: "إجمالي قيمة الوحدات" },
      // Items the lots cannot price are EXCLUDED from the total and counted
      // here, rather than silently added as zero.
      notPriceable: {
        one: { en: "({n} item not priceable)", ar: "(صنف واحد غير قابل للتسعير)" },
        two: { en: "({n} items not priceable)", ar: "(صنفان غير قابلين للتسعير)" },
        few: { en: "({n} items not priceable)", ar: "({n} أصناف غير قابلة للتسعير)" },
        many: { en: "({n} items not priceable)", ar: "({n} صنفًا غير قابل للتسعير)" },
      },

      // --- draft form: attachments ---
      removeFile: { en: "Remove file", ar: "إزالة الملف" },
      notUploadedYet: { en: "not uploaded yet", ar: "لم يُرفع بعد" },
      uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
      attachFile: { en: "Attach photo or file", ar: "إرفاق صورة أو ملف" },
      stagedFiles: {
        one: {
          en: "{n} file will upload when you press Create draft.",
          ar: "سيُرفع ملف واحد عند الضغط على إنشاء مسودة.",
        },
        two: {
          en: "{n} files will upload when you press Create draft.",
          ar: "سيُرفع ملفان عند الضغط على إنشاء مسودة.",
        },
        few: {
          en: "{n} files will upload when you press Create draft.",
          ar: "ستُرفع {n} ملفات عند الضغط على إنشاء مسودة.",
        },
        many: {
          en: "{n} files will upload when you press Create draft.",
          ar: "سيُرفع {n} ملفًا عند الضغط على إنشاء مسودة.",
        },
      },

      // --- confirm exit: the money moment ---
      confirmSubtitle: {
        en: "This deducts stock and assigns the permit number. It cannot be undone — only voided.",
        ar: "هذا يخصم المخزون ويمنح الإذن رقمه. لا يمكن التراجع عنه — يمكن إلغاؤه فقط.",
      },
      confirming: { en: "Confirming…", ar: "جارٍ التأكيد…" },
      notEnoughStock: { en: "Not enough stock", ar: "المخزون غير كافٍ" },
      // One shortfall line. `{name}` can be blank when the part did not load —
      // the old JSX rendered nothing there, so the token is filled with "".
      shortLine: { en: "{name}: need {q}, {n} on hand", ar: "{name}: المطلوب {q}، المتوفر {n}" },
      colOnHandNow: { en: "On hand now", ar: "المتوفر الآن" },
      colAfter: { en: "After", ar: "بعد الخروج" },
      returnableDueBack: {
        en: "Returnable — due back {d}.",
        ar: "قابلة للإرجاع — تُستحق في {d}.",
      },
      willLeave: {
        one: {
          en: "{n} item will leave the warehouse. Cost is stamped at FIFO from the oldest stock first.",
          ar: "سيخرج صنف واحد من المستودع. تُثبَّت التكلفة بالوارد أولًا من أقدم مخزون.",
        },
        two: {
          en: "{n} items will leave the warehouse. Cost is stamped at FIFO from the oldest stock first.",
          ar: "سيخرج صنفان من المستودع. تُثبَّت التكلفة بالوارد أولًا من أقدم مخزون.",
        },
        few: {
          en: "{n} items will leave the warehouse. Cost is stamped at FIFO from the oldest stock first.",
          ar: "ستخرج {n} أصناف من المستودع. تُثبَّت التكلفة بالوارد أولًا من أقدم مخزون.",
        },
        many: {
          en: "{n} items will leave the warehouse. Cost is stamped at FIFO from the oldest stock first.",
          ar: "سيخرج {n} صنفًا من المستودع. تُثبَّت التكلفة بالوارد أولًا من أقدم مخزون.",
        },
      },

      // --- record a return ---
      returnTitle: { en: "Record a return", ar: "تسجيل إرجاع" },
      returnSubtitle: {
        en: "Permit {n} — enter what came back. Partial returns are fine.",
        ar: "إذن {n} — أدخل ما عاد. الإرجاع الجزئي مقبول.",
      },
      // `Recording…` is NOT here — it is `consumption.shared.recording`, which
      // this modal's submit button reads. A second copy sat here until the
      // duplicate checker found it byte-identical and unreferenced.
      recordReturn: { en: "Record return", ar: "تسجيل الإرجاع" },
      labelReturnedOn: { en: "Returned on", ar: "تاريخ الإرجاع" },
      colItem: { en: "Item", ar: "الصنف" },
      colReturning: { en: "Returning", ar: "المُرجَع الآن" },
      // A caption under the part name, appended to the SKU — it opens with the
      // separator, so the leading space and the "·" are part of the value.
      alreadyBackCaption: { en: " · {r} of {q} already back", ar: " · عاد {r} من {q}" },
      onlyNOut: { en: "only {n} out", ar: "القائم {n} فقط" },
      titleLineLotsShort: {
        en: "This line's lot history cannot cover that quantity",
        ar: "سجل دفعات هذا السطر لا يغطي تلك الكمية",
      },
      returnFooter: {
        en: "Returned stock goes back to the exact price lots it came from, so cost stays accurate.",
        ar: "يعود المخزون المُرجَع إلى دفعات السعر نفسها التي خرج منها، فتبقى التكلفة دقيقة.",
      },

      // --- void ---
      voidTitle: { en: "Void this permit", ar: "إلغاء هذا الإذن" },
      voidSubtitle: {
        en: "Permit {n} — the record is kept, marked voided.",
        ar: "إذن {n} — يُحفظ السجل ويُعلَّم كملغى.",
      },
      voiding: { en: "Voiding…", ar: "جارٍ الإلغاء…" },
      voidNothingToRestore: {
        en: "Everything on this permit has already been returned, so voiding it moves no stock — it only marks the record as void.",
        ar: "عاد كل ما في هذا الإذن بالفعل، فإلغاؤه لا يحرّك أي مخزون — إنما يعلّم السجل كملغى فقط.",
      },
      voidRestoreIntro: {
        en: "These quantities go back to stock:",
        ar: "تعود هذه الكميات إلى المخزون:",
      },
      colRestoring: { en: "Restoring", ar: "المُعاد" },
      labelReason: { en: "Reason", ar: "السبب" },
      voidReasonPlaceholder: { en: "Why is this being voided?", ar: "ما سبب الإلغاء؟" },
      // The English swaps " has"/"s have", so the two halves of the verb move
      // with the noun. Stored whole per bucket rather than spliced.
      alreadyPartlyReturned: {
        one: {
          en: "{n} item has already been partly returned. Those quantities were restored by their own return event and are NOT restored again here.",
          ar: "عاد صنف واحد جزئيًا بالفعل. أُعيدت تلك الكميات إلى المخزون بحدث إرجاعها الخاص ولا تُعاد هنا مرة أخرى.",
        },
        two: {
          en: "{n} items have already been partly returned. Those quantities were restored by their own return event and are NOT restored again here.",
          ar: "عاد صنفان جزئيًا بالفعل. أُعيدت تلك الكميات إلى المخزون بحدث إرجاعها الخاص ولا تُعاد هنا مرة أخرى.",
        },
        few: {
          en: "{n} items have already been partly returned. Those quantities were restored by their own return event and are NOT restored again here.",
          ar: "عادت {n} أصناف جزئيًا بالفعل. أُعيدت تلك الكميات إلى المخزون بحدث إرجاعها الخاص ولا تُعاد هنا مرة أخرى.",
        },
        many: {
          en: "{n} items have already been partly returned. Those quantities were restored by their own return event and are NOT restored again here.",
          ar: "عاد {n} صنفًا جزئيًا بالفعل. أُعيدت تلك الكميات إلى المخزون بحدث إرجاعها الخاص ولا تُعاد هنا مرة أخرى.",
        },
      },

      // --- the printable gate copy ---
      // `{n}` is the permit number and is EMPTY on a draft, which is why the
      // token sits at the end with a space before it: the old template
      // produced "Exit permit " in exactly that case.
      printTitle: { en: "Exit permit {n}", ar: "إذن خروج {n}" },
      printSubtitle: {
        en: "Print and send this with the carrier.",
        ar: "اطبع هذا وأرسله مع الناقل.",
      },
      printBtn: { en: "Print", ar: "طباعة" },
      printDraft: { en: "DRAFT", ar: "مسودة" },
      printDueBack: { en: " · due back {d}", ar: " · تُستحق في {d}" },
      printIssued: { en: "Issued", ar: "صدر في" },
      printVoided: { en: "VOIDED", ar: "ملغى" },
      printFromWarehouse: { en: "From warehouse", ar: "من مستودع" },
      // `{kind}` arrives ALREADY TRANSLATED from the caller, which resolves the
      // destination enum through EXIT_PERMIT_DESTINATION_TKEY.
      printTo: { en: "To ({kind})", ar: "إلى ({kind})" },
      colSku: { en: "SKU", ar: "الرمز" },
      // The unit rides in the header when every line shares one. `{u}` is the
      // part's own unit string from the database, so it is not translated.
      colQtyUnit: { en: "Qty ({u})", ar: "الكمية ({u})" },
      printInternalValue: {
        en: "Internal value at FIFO cost: {v}",
        ar: "القيمة الداخلية بتكلفة الوارد أولًا: {v}",
      },
      printRoleIssuedBy: { en: "Issued by", ar: "المُصدِر" },
      printRoleReceivedBy: { en: "Received by", ar: "المُستلِم" },
      printRoleGate: { en: "Gate / security", ar: "البوابة / الأمن" },
      signatureLine: { en: "{role} — name & signature", ar: "{role} — الاسم والتوقيع" },
    },
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

/**
 * Which grammatical form a counted noun takes.
 *
 * English has two: one / not-one. Arabic has four, and they are not a stylistic
 * preference — a counted noun changes NUMBER and CASE with the count:
 *
 *   1        وحدة واحدة        singular, the numeral usually dropped
 *   2        وحدتان / وحدتين    DUAL, a form English does not have at all
 *   3–10     ثلاث وحدات        plural, genitive
 *   11+      إحدى عشرة وحدة    singular again, accusative
 *
 * ZERO takes the 3–10 shape (صفر وحدات), which is why it maps to `few` and not
 * to a bucket of its own. That also happens to be what English wants: "0 work
 * orders", the same word the old `n === 1 ? "" : "s"` produced.
 *
 * ONE SELECTOR SERVES BOTH LANGUAGES. It is deliberately not wrapped in a
 * `lang === "ar"` branch: every English value under a bucketed key is written
 * identically across `two`, `few` and `many`, so whichever bucket fires the
 * English string is the same one it printed before this conversion. A language
 * branch in the SELECTOR would have meant two code paths to keep byte-identical
 * instead of one — and the render provers can only diff a path that runs.
 *
 * The `% 100` is what makes 111 behave like 11 rather than like 11-and-a-bit:
 * Arabic agreement follows the last two digits, so 103 is `few` and 113 is
 * `many`. Negatives and fractions are normalised away first; no caller passes
 * one today, and a bucket lookup is the wrong place to discover that.
 */
export type PluralBucket = "one" | "two" | "few" | "many";

export function plural(n: number): PluralBucket {
  const a = Math.abs(Math.trunc(n));
  if (a === 1) return "one";
  if (a === 2) return "two";
  const mod = a % 100;
  if (a === 0 || (mod >= 3 && mod <= 10)) return "few";
  return "many";
}
