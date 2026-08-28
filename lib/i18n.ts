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
    // The in-flight label on a button that is WRITING AN EVENT — not saving an
    // edit, which is `common.saving`. Lived at `consumption.shared.recording`
    // and was already documented there as covering the Archive balance-return
    // popup; Batch 8 made that reader real, and a THIRD file in a SECOND route
    // is what `common` is for. Moving it beat the alternatives: a duplicate
    // leaf, or `app/archive/` importing a `consumption.*` key.
    recording: { en: "Recording…", ar: "جارٍ التسجيل…" },
    // Added in Phase 3 Batch 6, on the same test the groups above were added
    // under. `Delete` is the accessible name of an icon button in BOTH of the
    // files in this batch that have one — the expenses modal's row action and
    // the daily side-log's — and it was `reports.expenses.delete` only while
    // one of them existed. A second caller is what promotes it.
    //
    // `mt.delete` stays where it is: the maintenance track was not converted in
    // this batch, so folding it in would move a key out of a file this commit
    // does not otherwise touch, for no reader's benefit.
    delete: { en: "Delete", ar: "حذف" },
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
    // CommissionMode. Added in Phase 3 Batch 8 for the archived-customer
    // popup, which renders COMMISSION_MODE_LABELS the same way this block's
    // other three maps are rendered. It belongs HERE and not under `archive`
    // for the reason in this block's header: the English lives in a
    // db-types.ts label map, and a map read from one route today is read from
    // three tomorrow. `comm` prefix because `fixed`/`scalable` on their own
    // would collide with the next enum that has a "fixed" member.
    commFixed: { en: "Fixed", ar: "ثابتة" },
    commScalable: { en: "Scalable", ar: "تصاعدية" },
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
      // `Recording…` moved to `common.recording` in Batch 8. It was always
      // shared with the Archive balance-return popup — the note that used to
      // sit here said so — and once that popup actually read it, the leaf was
      // being pulled across a route boundary from a namespace named for the
      // other route.
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
      // `Recording…` is `common.recording` — the return popup's submit button
      // carries the same in-flight label.
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
      // `Recording…` is NOT here — it is `common.recording`, which this modal's
      // submit button reads. A second copy sat here until the duplicate checker
      // found it byte-identical and unreferenced.
      //
      // NOR IS THIS LEAF THE ARCHIVE ONE. `archive.ret.submit` is also
      // "Record return" in English and is a DIFFERENT SENTENCE: this returns
      // PARTS to a warehouse ("تسجيل الإرجاع"), that returns a customer's MONEY
      // ("تسجيل إعادة الرصيد"). The English collision is the whole reason to
      // say so here.
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

  // ===========================================================================
  // REPORTS
  // ===========================================================================
  // The accounting vocabulary here is the standard Saudi/IFRS Arabic, not a
  // fresh translation: الإيرادات / التكاليف التشغيلية / الربح التشغيلي / صافي
  // الربح / هامش التشغيل / الذمم المدينة / ضريبة القيمة المضافة / الزكاة. Where
  // the same concept is already keyed elsewhere in this file the site points at
  // THAT key rather than restating it — dashboard.costType.* for the five cost
  // buckets, mt.vat / mt.subtotal / mt.discount for the money vocabulary, and
  // nav.* for the nine statement names.
  //
  // What is NOT translated, deliberately:
  //   · every figure — money, percent, dates — stays Latin through the existing
  //     formatters, which are pinned to en-US;
  //   · period labels ("Aug 2026", "Q3 2026") are produced by the VIEW
  //     (to_char in 0100), not by this app;
  //   · report_metrics prose is database content (0098).
  reports: {
    // --- the page shell ----------------------------------------------------
    // The page TITLE and the second tab both say "Reports" and both point at
    // nav.reports; the first tab says "Overview" and points at
    // dashboard.overview. Same word, same meaning, already keyed.
    shell: {
      subtitle: {
        en: "Revenue, cost and profit — every figure from one shared definition",
        ar: "الإيرادات والتكاليف والأرباح — كل رقم من تعريف واحد مشترك",
      },
      period: { en: "Period", ar: "الفترة" },
      metricsDictionary: { en: "Metrics dictionary", ar: "قاموس المقاييس" },
    },

    // The period grain. `key` is the enum ("month"), `label` is this.
    grain: {
      month: { en: "Monthly", ar: "شهري" },
      quarter: { en: "Quarterly", ar: "ربع سنوي" },
      year: { en: "Yearly", ar: "سنوي" },
    },

    // --- the semantic layer's own vocabulary --------------------------------
    // ONE NAME PER METRIC, read by BOTH consumers: the custom-report builder's
    // catalogue (BUILDER_METRICS, which is keyed by `${metric_key}::${field}` —
    // data, not this label; see metricId()) and the Overview's stat cards and
    // chart series. It sat under `builder` for one draft, which described only
    // half of who reads it: "Net profit" is the same words on a KPI card as in
    // a generated column, and two entries for one metric is how a name drifts.
    metric: {
      revenue: { en: "Revenue", ar: "الإيرادات" },
      revenueAllocated: { en: "Revenue (allocated)", ar: "الإيرادات (موزَّعة)" },
      partsCost: { en: "Parts cost", ar: "تكلفة قطع الغيار" },
      osCost: { en: "Outsourced cost", ar: "تكلفة الأعمال الخارجية" },
      payroll: { en: "Payroll", ar: "الرواتب" },
      commissions: { en: "Commissions", ar: "العمولات" },
      fillingCost: { en: "Water filling cost", ar: "تكلفة تعبئة المياه" },
      operatingCost: { en: "Operating cost", ar: "التكاليف التشغيلية" },
      operatingProfit: { en: "Operating profit", ar: "الربح التشغيلي" },
      netProfit: { en: "Net profit", ar: "صافي الربح" },
      otherExpenses: { en: "Other expenses", ar: "مصروفات أخرى" },
      operatingMargin: { en: "Operating margin", ar: "هامش التشغيل" },
      collections: { en: "Collections", ar: "المتحصّلات" },
      purchasingSpend: { en: "Purchasing spend", ar: "إنفاق المشتريات" },
      tripsDelivered: { en: "Trips delivered", ar: "الرحلات المسلَّمة" },
      invoices: { en: "Invoices", ar: "الفواتير" },
      outstandingPeriod: {
        en: "Outstanding on period invoices",
        ar: "المستحق على فواتير الفترة",
      },
      maintParts: { en: "Maintenance parts", ar: "قطع غيار الصيانة" },
      maintOs: { en: "Outsourced repairs", ar: "إصلاحات خارجية" },
      maintTotal: { en: "Total maintenance", ar: "إجمالي الصيانة" },
    },

    // --- the `basis` enum, in words -----------------------------------------
    // WHAT A FIGURE IS MEASURED ON, and the one distinction the report builder
    // exists to protect (0100). It lived under `glossary` while the dictionary
    // popup was the only surface that printed it; THREE now do — the popup's
    // group headings, the builder's metric picker, and the generated report's
    // column sub-heading — so it sits beside `metric` where both belong to the
    // semantic layer rather than to any one component.
    //
    // ENGLISH IS BYTE-IDENTICAL TO THE COLUMN VALUE, lower-case, because every
    // one of those three sites renders the raw enum today and uppercases it in
    // CSS. The ENUM → key lookup is basisLabel() in lib/reports, one copy for
    // all three, and a miss falls through to the raw string there — so a fifth
    // basis added by a future migration still appears.
    basis: {
      accrual: { en: "accrual", ar: "الاستحقاق" },
      cash: { en: "cash", ar: "النقدي" },
      state: { en: "state", ar: "المركز" },
      operational: { en: "operational", ar: "التشغيلي" },
    },

    // --- ONE WORD PER COLUMN, for every table on the route ------------------
    // The Overview held seven of these (`thTrips`, `thTotal`, …) while it was
    // the only converted tab. The statements print the SAME words — a
    // Receivables table with its own "Customer" and the Overview's oldest-unpaid
    // table with another is two entries for one column, and that is how a
    // heading drifts. Lifted here on the same argument that moved
    // `builder.metric` up to `reports.metric`.
    //
    // `Truck`, `Revenue`, `Cost`, `Driver`, `Status`, `Note`, `Actions` are NOT
    // here — they are already in `common`, and `Trips delivered` is already
    // `reports.metric.tripsDelivered`. A column whose word exists elsewhere
    // reads it from there.
    //
    // The bare `%` header on the P&L variance column is left as a literal in
    // the JSX: it is a symbol, identical in both languages, and keying it would
    // mint an entry that can never differ.
    th: {
      amount: { en: "Amount", ar: "المبلغ" },
      band: { en: "Band", ar: "الشريحة" },
      basis: { en: "Basis", ar: "الأساس" },
      category: { en: "Category", ar: "الفئة" },
      commission: { en: "Commission", ar: "العمولة" },
      commissionEarned: { en: "Commission earned", ar: "العمولة المكتسبة" },
      completion: { en: "Completion", ar: "الإنجاز" },
      completionRate: { en: "Completion rate", ar: "نسبة الإنجاز" },
      // The DATE an invoice was confirmed, not a yes/no flag — the column holds
      // a date, so the Arabic says so rather than leaving it to be inferred.
      confirmed: { en: "Confirmed", ar: "تاريخ التأكيد" },
      customer: { en: "Customer", ar: "العميل" },
      date: { en: "Date", ar: "التاريخ" },
      days: { en: "Days", ar: "الأيام" },
      delivered: { en: "Delivered", ar: "المسلَّمة" },
      enteredBy: { en: "Entered by", ar: "أدخلها" },
      fills: { en: "Fills", ar: "التعبئات" },
      invoice: { en: "Invoice", ar: "الفاتورة" },
      invoices: { en: "Invoices", ar: "الفواتير" },
      measure: { en: "Measure", ar: "المقياس" },
      month: { en: "Month", ar: "الشهر" },
      net: { en: "Net", ar: "الصافي" },
      notDelivered: { en: "Not delivered", ar: "غير مسلَّمة" },
      // Two English spellings of one idea — the by-month table abbreviates
      // because eight columns share the width. Arabic has no abbreviation to
      // match, so both read the same there; the keys stay separate because the
      // English differs and byte-identity is per-key.
      osJobs: { en: "OS jobs", ar: "أعمال خارجية" },
      outsourced: { en: "Outsourced", ar: "أعمال خارجية" },
      outstanding: { en: "Outstanding", ar: "المستحق" },
      paid: { en: "Paid", ar: "المسدد" },
      parts: { en: "Parts", ar: "قطع الغيار" },
      permits: { en: "Permits", ar: "التصاريح" },
      projectsServed: { en: "Projects served", ar: "المشاريع المخدومة" },
      reason: { en: "Reason", ar: "السبب" },
      // Sales-Returns-only header, despite living in the shared `th` block:
      // StatementViews.tsx:220 is its ONE call site (the reversed-invoicing
      // table). Scope was checked before the Arabic moved from "المعكوس".
      reversed: { en: "Reversed", ar: "المرتجع" },
      salary: { en: "Salary", ar: "الراتب" },
      share: { en: "Share", ar: "الحصة" },
      shareDelivered: { en: "Share of delivered trips", ar: "حصة الرحلات المسلَّمة" },
      shareScheduled: { en: "Share of scheduled trips", ar: "حصة الرحلات المجدولة" },
      source: { en: "Source", ar: "المصدر" },
      station: { en: "Station", ar: "المحطة" },
      total: { en: "Total", ar: "الإجمالي" },
      trips: { en: "Trips", ar: "الرحلات" },
      tripsScheduled: { en: "Trips scheduled", ar: "الرحلات المجدولة" },
      // Beside `common.truck`, not instead of it: this is a COLUMN HEADING and
      // the headings in this block are definite ("العميل", "الفاتورة"), while
      // common.truck is the bare noun read mid-sentence. Same English, so the
      // split costs nothing and keeps the Arabic table reading as a table.
      truck: { en: "Truck", ar: "الشاحنة" },
      trucks: { en: "Trucks", ar: "الشاحنات" },
      uncosted: { en: "Uncosted", ar: "غير مكلَّفة" },
      variance: { en: "Variance", ar: "الفرق" },
      value: { en: "Value", ar: "القيمة" },
      waterType: { en: "Water type", ar: "نوع المياه" },
      wos: { en: "WOs", ar: "أوامر العمل" },
    },

    // Said by the Overview's receivables panel and by the Receivables
    // statement, in those exact words, so it is keyed once above both.
    nothingOutstanding: {
      en: "Nothing outstanding — every confirmed invoice is paid.",
      ar: "لا شيء مستحق — كل فاتورة مؤكدة مسددة.",
    },
    // Two modals on this route close themselves. It sat under `glossary` while
    // that was the only one converted.
    close: { en: "Close", ar: "إغلاق" },

    // --- tab 1, the Overview (OverviewTab.tsx) ------------------------------
    // The four KPI cards, the six supporting stats and three of the five chart
    // series take their NAMES from reports.metric.* above — the same words the
    // report builder offers, because they are the same figures. What is keyed
    // here is everything that is only ever said on this tab.
    overview: {
      empty: {
        title: { en: "No periods to report on yet", ar: "لا توجد فترات للتقرير عنها بعد" },
        body: {
          en: "The month spine builds itself from real activity. Once there is a confirmed invoice, a trip or a parts consumption, this page fills in.",
          ar: "يبني عمود الأشهر نفسه من النشاط الفعلي. وبمجرد وجود فاتورة مؤكدة أو رحلة أو استهلاك قطع، تمتلئ هذه الصفحة.",
        },
      },

      // The partial-month banner. Three leaves because the first clause is
      // <strong> and the last is conditional on a prior month existing; the
      // spaces between them are JSX, not part of any value.
      inProgress: {
        strong: { en: "{p} is still in progress.", ar: "{p} لم تنتهِ بعد." },
        body: {
          en: "Costs accrue day by day, but revenue is only recognised when an invoice is confirmed — usually at the end of the period. Expect this month to look cost-heavy until then.",
          ar: "تتراكم التكاليف يومًا بيوم، بينما لا يُعترف بالإيراد إلا عند تأكيد الفاتورة — عادةً في نهاية الفترة. فتوقّع أن يبدو هذا الشهر ثقيل التكلفة حتى ذلك الحين.",
        },
        switch: {
          en: "For a complete picture, switch the period to {p}.",
          ar: "للحصول على صورة كاملة، بدّل الفترة إلى {p}.",
        },
      },

      // Card names that exist nowhere else. The other eight point at
      // reports.metric.*.
      outstandingReceivables: { en: "Outstanding receivables", ar: "الذمم المدينة المستحقة" },
      trucksActive: { en: "Trucks active", ar: "الشاحنات النشطة" },
      stockPurchased: { en: "Stock purchased", ar: "المخزون المشترى" },

      // The small print under each KPI.
      note: {
        revenue: {
          en: "Confirmed invoices, net of VAT",
          ar: "فواتير مؤكدة، بعد استبعاد ضريبة القيمة المضافة",
        },
        operatingProfit: { en: "Before other expenses", ar: "قبل المصروفات الأخرى" },
        collections: {
          en: "Cash received, VAT included",
          ar: "نقد محصَّل، شامل ضريبة القيمة المضافة",
        },
        receivables: {
          en: "As of today, not the picked period",
          ar: "كما هو اليوم، لا الفترة المختارة",
        },
      },

      // FOUR COUNT FAMILIES, each its own noun phrase rather than one long
      // sentence: the revenue card prints "{invoices} · {customers}" and the
      // separator is a bullet, not grammar, so the two halves inflect
      // independently in both languages. English pluralises with a bare "s",
      // which is why its `one` differs and its other three do not.
      invoiceCount: {
        one: { en: "{n} invoice", ar: "فاتورة واحدة" },
        two: { en: "{n} invoices", ar: "فاتورتان" },
        few: { en: "{n} invoices", ar: "{n} فواتير" },
        many: { en: "{n} invoices", ar: "{n} فاتورة" },
      },
      customerCount: {
        one: { en: "{n} customer", ar: "عميل واحد" },
        two: { en: "{n} customers", ar: "عميلان" },
        few: { en: "{n} customers", ar: "{n} عملاء" },
        many: { en: "{n} customers", ar: "{n} عميلًا" },
      },
      unpaidInvoices: {
        one: { en: "{n} unpaid invoice", ar: "فاتورة واحدة غير مسددة" },
        two: { en: "{n} unpaid invoices", ar: "فاتورتان غير مسددتين" },
        few: { en: "{n} unpaid invoices", ar: "{n} فواتير غير مسددة" },
        many: { en: "{n} unpaid invoices", ar: "{n} فاتورة غير مسددة" },
      },
      workOrders: {
        one: { en: "{n} work order", ar: "أمر عمل واحد" },
        two: { en: "{n} work orders", ar: "أمرا عمل" },
        few: { en: "{n} work orders", ar: "{n} أوامر عمل" },
        many: { en: "{n} work orders", ar: "{n} أمر عمل" },
      },

      // {v} is a percentage, {n} a count — both already formatted, both Latin.
      marginFoot: { en: "Margin {v}", ar: "الهامش {v}" },
      ofRevenue: { en: "{v} of revenue", ar: "{v} من الإيرادات" },
      ofTotal: { en: "of {n} total", ar: "من {n} إجمالًا" },
      expensesNone: { en: "none recorded — add", ar: "لا شيء مسجَّل — أضف" },
      expensesManage: { en: "manage", ar: "إدارة" },
      notPnlCost: { en: "not a P&L cost", ar: "ليست تكلفة في قائمة الأرباح والخسائر" },
      // NOT reports.metric.otherExpenses with a suffix bolted on: the cost
      // panel's last row exists to say this figure sits OUTSIDE the operating
      // cost it is printed under, and "(separate)" is that whole claim.
      otherExpensesSeparate: { en: "Other expenses (separate)", ar: "مصروفات أخرى (منفصلة)" },
      noChange: { en: "no change", ar: "لا تغيير" },
      vs: { en: "vs {p}", ar: "مقابل {p}" },

      // {p} is the month label the app formats — "Aug 2026", Latin.
      section: {
        revCostMargin: { en: "Revenue, cost and margin", ar: "الإيرادات والتكاليف والهامش" },
        whereMoneyWent: { en: "Where the money went · {p}", ar: "أين ذهب المال · {p}" },
        earnedVsCollected: { en: "Earned vs collected", ar: "المكتسب مقابل المحصَّل" },
        revenueByTruck: { en: "Revenue by truck · {p}", ar: "الإيرادات حسب الشاحنة · {p}" },
        maintByTruck: {
          en: "Maintenance cost by truck · {p}",
          ar: "تكلفة الصيانة حسب الشاحنة · {p}",
        },
        aging: { en: "Receivables aging", ar: "أعمار الذمم المدينة" },
        oldestUnpaid: { en: "Oldest unpaid invoices", ar: "أقدم الفواتير غير المسددة" },
      },

      // Chart series names. THEY ARE LABELS ONLY NOW: the revenue/cost/margin
      // tooltip used to pick its formatter by comparing the series NAME to
      // "Margin", which would have sent every margin through the SAR formatter
      // the moment that name became translatable. It reads `dataKey` instead.
      series: {
        revenueEarned: { en: "Revenue earned", ar: "الإيرادات المكتسبة" },
        cashCollected: { en: "Cash collected", ar: "النقد المحصَّل" },
      },
      // The table headers this tab prints — Trips, Parts, Outsourced, Total,
      // Invoice, Customer, Days — and the word the aging tooltip labels its
      // series with are all reports.th.*, shared with the statements.

      noTruckRevenue: {
        en: "No invoiced trips reached a truck this period.",
        ar: "لم تصل أي رحلة مفوترة إلى شاحنة في هذه الفترة.",
      },
      noTruckMaint: {
        en: "No maintenance spend reached a truck this period.",
        ar: "لم يصل أي إنفاق صيانة إلى شاحنة في هذه الفترة.",
      },

      // The caveats the semantic layer exposed on purpose.
      payroll: {
        // The <strong> lands on ONE word, and it is not the same word in the
        // same place: English emphasises "current" before the noun, Arabic
        // after it. Three leaves is what lets each language put it where its
        // own grammar does.
        before: { en: "Payroll uses each person's", ar: "تستخدم الرواتب راتب كل شخص" },
        current: { en: "current", ar: "الحالي" },
        after: {
          en: "salary applied to whoever was employed that month — salaries are not effective-dated, so a raise changes past periods too.",
          ar: "مطبَّقًا على من كان موظفًا في ذلك الشهر — الرواتب ليست مؤرَّخة السريان، فالزيادة تغيّر الفترات السابقة أيضًا.",
        },
        // English inflects THREE times in one sentence (person/people, has/have,
        // counts/count), which is exactly why it is stored whole.
        missing: {
          one: {
            en: "{n} employed person has no salary recorded and counts as zero.",
            ar: "موظف واحد لا راتب مسجَّل له ويُحتسب صفرًا.",
          },
          two: {
            en: "{n} employed people have no salary recorded and count as zero.",
            ar: "موظفان لا راتب مسجَّل لهما ويُحتسبان صفرًا.",
          },
          few: {
            en: "{n} employed people have no salary recorded and count as zero.",
            ar: "{n} موظفين لا راتب مسجَّل لهم ويُحتسبون صفرًا.",
          },
          many: {
            en: "{n} employed people have no salary recorded and count as zero.",
            ar: "{n} موظفًا لا راتب مسجَّل لهم ويُحتسبون صفرًا.",
          },
        },
      },
      allocationNote: {
        en: "An allocation, not a measurement: a trip carries no rate of its own in this schema, so each invoice's revenue is split equally across its trips and follows them to their trucks.",
        ar: "توزيع لا قياس: الرحلة لا تحمل سعرًا خاصًا بها في هذا المخطط، فتُقسَّم إيرادات كل فاتورة بالتساوي على رحلاتها وتتبعها إلى شاحناتها.",
      },
      maintNote: {
        en: "Parts are the FIFO cost of what each truck's work orders consumed; outsourced is what outside workshops were paid for that truck. Labour on in-house work orders is not costed anywhere in this schema, so it is in neither column.",
        ar: "قطع الغيار هي تكلفة الوارد أولًا صادر أولًا لما استهلكته أوامر عمل كل شاحنة؛ والأعمال الخارجية هي ما دُفع للورش الخارجية عن تلك الشاحنة. أما العمالة على أوامر العمل الداخلية فغير مكلَّفة في هذا المخطط، فلا ترد في أي من العمودين.",
      },
      maintSplit: {
        en: "This period outsourced spend is {o} against {p} of parts — a parts-only view would show roughly {s} of the real cost.",
        ar: "إنفاق الأعمال الخارجية هذه الفترة {o} مقابل {p} من قطع الغيار — والعرض المقتصر على القطع سيُظهر نحو {s} من التكلفة الحقيقية.",
      },
      basesNote: {
        en: "These are different bases on purpose. Revenue is earned when an invoice is confirmed and excludes VAT; collections are cash banked when it is paid and include VAT. They are never added together.",
        ar: "هذان أساسان مختلفان عن قصد. يُكتسب الإيراد عند تأكيد الفاتورة ولا يشمل ضريبة القيمة المضافة؛ والمتحصّلات نقد يُودع عند السداد ويشمل الضريبة. ولا يُجمعان أبدًا.",
      },
      topupsNote: {
        en: "Prepaid top-ups of {v} this month are cash in but are neither revenue nor an invoice payment, so they appear in neither line.",
        ar: "شحنات الرصيد المدفوع مقدمًا هذا الشهر وقدرها {v} نقد وارد لكنها ليست إيرادًا ولا سداد فاتورة، فلا تظهر في أي من الخطين.",
      },
      agingNote: {
        en: "Aged from the date each invoice was confirmed — this schema has no payment-terms column to age from a due date.",
        ar: "تُحتسب الأعمار من تاريخ تأكيد كل فاتورة — لا يوجد في هذا المخطط عمود لشروط السداد ليُحتسب العمر من تاريخ استحقاق.",
      },
    },

    // --- tab 2: the statement pack's own chrome -----------------------------
    // The names of the nine statements, the two controls above them, and the
    // one-line title the builder's output carries. Everything a statement SAYS
    // is under `pnl` / `vat` below or in its own namespace; this is only what
    // the pack around them says.
    statements: {
      // `revenue` is NOT here — the tab is the same word as the metric, so
      // STATEMENTS points at reports.metric.revenue. Same call ReportsClient
      // makes for its own two tabs. `custom` IS here rather than reading
      // settings' identical leaf: that one names a threshold preset, and one
      // word shared by accident is not one word shared on purpose.
      tab: {
        pnl: { en: "P&L", ar: "الأرباح والخسائر" },
        receivables: { en: "Receivables", ar: "الذمم المدينة" },
        cost: { en: "Costs", ar: "التكاليف" },
        operations: { en: "Operations", ar: "العمليات" },
        daily: { en: "Daily Trips", ar: "الرحلات اليومية" },
        payslips: { en: "Payslips", ar: "قسائم الرواتب" },
        narrative: { en: "Narrative", ar: "السرد" },
        custom: { en: "Custom", ar: "مخصص" },
      },
      nothingToReport: { en: "Nothing to report yet", ar: "لا شيء لعرضه بعد" },
      periodsAppear: {
        en: "Periods appear once there is activity to summarise.",
        ar: "تظهر الفترات بمجرد وجود نشاط يمكن تلخيصه.",
      },
      manageExpenses: { en: "Manage expenses", ar: "إدارة المصروفات" },
      print: { en: "Print", ar: "طباعة" },

      // Keyed by GRAIN. English spliced the raw `periodType` enum into the
      // sentence — which is the trap: an Arabic reader got "الشهر السابق"
      // spelled `month`. Arabic also inflects the noun, so the sentence is
      // stored whole three times rather than token-filled.
      priorNote: {
        month: {
          en: "Prior-period columns show the immediately preceding month. Per-category expenses are listed for the current period only — the comparison is made on the section total, since categories come and go between periods.",
          ar: "تعرض أعمدة الفترة السابقة الشهر السابق مباشرة. وتُدرج المصروفات حسب الفئة للفترة الحالية فقط — وتُجرى المقارنة على إجمالي القسم، لأن الفئات تظهر وتختفي بين الفترات.",
        },
        quarter: {
          en: "Prior-period columns show the immediately preceding quarter. Per-category expenses are listed for the current period only — the comparison is made on the section total, since categories come and go between periods.",
          ar: "تعرض أعمدة الفترة السابقة الربع السابق مباشرة. وتُدرج المصروفات حسب الفئة للفترة الحالية فقط — وتُجرى المقارنة على إجمالي القسم، لأن الفئات تظهر وتختفي بين الفترات.",
        },
        year: {
          en: "Prior-period columns show the immediately preceding year. Per-category expenses are listed for the current period only — the comparison is made on the section total, since categories come and go between periods.",
          ar: "تعرض أعمدة الفترة السابقة السنة السابقة مباشرة. وتُدرج المصروفات حسب الفئة للفترة الحالية فقط — وتُجرى المقارنة على إجمالي القسم، لأن الفئات تظهر وتختفي بين الفترات.",
        },
      },

      // The generated report's own title. `{g}` is a lower-cased grouping name
      // and `{p}` the view's period label. Keyed by grain for the by-period
      // branch, same reason as priorNote.
      customTitle: {
        month: { en: "{g} · every month", ar: "{g} · كل شهر" },
        quarter: { en: "{g} · every quarter", ar: "{g} · كل ربع" },
        year: { en: "{g} · every year", ar: "{g} · كل سنة" },
        forPeriod: { en: "{g} · {p}", ar: "{g} · {p}" },
      },
    },

    // --- the P&L statement --------------------------------------------------
    // MONEY VOCABULARY, AND THE ARABIC IS THE STANDARD SAUDI/IFRS TERM WHERE
    // ONE EXISTS — flagged for Turki's reading pass rather than invented.
    // Nothing here changes a figure: every leaf is a LABEL beside a number the
    // views already produced.
    pnl: {
      title: { en: "Profit & Loss", ar: "الأرباح والخسائر" },
      // `{p}` is the prior period's own label — "Jul 2026", Latin on purpose.
      comparedWith: { en: "· compared with {p}", ar: "· مقارنة بـ {p}" },
      inProgress: {
        en: "This period is still in progress — costs accrue daily, while revenue is recognised when invoices are confirmed.",
        ar: "هذه الفترة لم تنتهِ بعد — تتراكم التكاليف يوميًا، بينما لا يُعترف بالإيراد إلا عند تأكيد الفواتير.",
      },

      // The statement's own line labels. Revenue, Payroll, Commissions,
      // Operating profit and Operating margin are NOT here — those five say
      // exactly what reports.metric.* already says, and the P&L reads them
      // from there. What is left is the four lines this statement words
      // differently on purpose ("Parts consumed", not "Parts cost": the P&L
      // records the moment stock LEAVES, which is the FIFO rule 0098 exists
      // to state) plus the three that only a statement has.
      //
      // `lineOs` reads the same two English words as reports.metric.maintOs and
      // is still its own leaf: that one labels `os_payments_per_truck`, a
      // PER-TRUCK metric in the builder, and this one is the period-wide
      // operating-cost bucket. Same words, different grain — and the VAT
      // footnotes below quote THIS one by name, so it is the one that has to
      // stay stable. Same call as statements.tab.custom vs settings' custom.
      lineParts: { en: "Parts consumed", ar: "قطع الغيار المستهلكة" },
      lineOs: { en: "Outsourced repairs", ar: "الإصلاحات الخارجية" },
      lineFilling: { en: "Station fill", ar: "تعبئة المحطة" },
      lineOperatingCost: { en: "Total operating cost", ar: "إجمالي التكاليف التشغيلية" },
      lineExpenses: { en: "Total other expenses", ar: "إجمالي المصروفات الأخرى" },
      // The suffix is a POSITION marker, not a rename — the metric is still
      // net_profit and the dictionary still defines it that way.
      lineNetProfit: { en: "Net profit — profit before Zakat", ar: "صافي الربح — الربح قبل الزكاة" },
      lineZakat: { en: "Zakat (2.5%, indicative)", ar: "الزكاة (2.5%، استرشادية)" },
      lineAfterZakat: { en: "Estimated profit after Zakat", ar: "الربح المقدَّر بعد الزكاة" },

      headCostOfOps: { en: "Cost of operations", ar: "تكلفة العمليات" },
      headOtherExpenses: { en: "Other expenses (recorded manually)", ar: "مصروفات أخرى (مسجَّلة يدويًا)" },
      headZakat: { en: "Zakat — indicative estimate", ar: "الزكاة — تقدير استرشادي" },

      // Whole sentence per bucket. English spliced two words at once
      // ("fill has"/"fills have" AND "its"/"their"); Arabic changes the noun,
      // the verb and the possessive, so nothing is spliced here at all.
      uncosted: {
        one: {
          en: "{n} fill has no price for its water type in this period — that cost is unknown, not zero, and is not in the figures above.",
          ar: "تعبئة واحدة بلا سعر لنوع مياهها في هذه الفترة — تلك التكلفة مجهولة لا صفر، وهي ليست ضمن الأرقام أعلاه.",
        },
        two: {
          en: "{n} fills have no price for their water type in this period — that cost is unknown, not zero, and is not in the figures above.",
          ar: "تعبئتان بلا سعر لنوع مياههما في هذه الفترة — تلك التكلفة مجهولة لا صفر، وهي ليست ضمن الأرقام أعلاه.",
        },
        few: {
          en: "{n} fills have no price for their water type in this period — that cost is unknown, not zero, and is not in the figures above.",
          ar: "{n} تعبئات بلا سعر لنوع مياهها في هذه الفترة — تلك التكلفة مجهولة لا صفر، وهي ليست ضمن الأرقام أعلاه.",
        },
        many: {
          en: "{n} fills have no price for their water type in this period — that cost is unknown, not zero, and is not in the figures above.",
          ar: "{n} تعبئة بلا سعر لنوع مياهها في هذه الفترة — تلك التكلفة مجهولة لا صفر، وهي ليست ضمن الأرقام أعلاه.",
        },
      },

      noExpenses: {
        en: "None recorded for this period — net profit therefore equals operating profit.",
        ar: "لا شيء مسجَّل لهذه الفترة — لذا يساوي صافي الربح الربح التشغيلي.",
      },

      // THE CAVEAT IS PART OF THE FIGURE, not decoration around it (§7): the
      // estimate must never print without it.
      zakatNote: {
        en: "Estimate only — actual Zakat is assessed on your ZATCA balance-sheet base (capital, reserves and long-term liabilities, less deductible long-term assets), not on profit.",
        ar: "تقدير فقط — تُربط الزكاة الفعلية على وعاء الميزانية لدى هيئة الزكاة والضريبة والجمارك (رأس المال والاحتياطيات والالتزامات طويلة الأجل، ناقصًا الأصول طويلة الأجل القابلة للحسم)، لا على الربح.",
      },
      zakatLoss: {
        en: "This period is a loss, so the estimate is shown as zero: a negative Zakat credit does not exist.",
        ar: "هذه الفترة خسارة، فيُعرض التقدير صفرًا: لا وجود لرصيد زكاة سالب.",
      },

      footer: {
        en: "Revenue is confirmed invoices net of VAT. Parts are costed FIFO at the moment they leave stock — stock purchases are not a cost here, they become one when consumed. Payroll applies current salaries to whoever was employed in the period, as salaries are not effective-dated. Margin is computed from this period's own revenue, never averaged from its months.",
        ar: "الإيراد هو الفواتير المؤكدة صافية من ضريبة القيمة المضافة. وتُكلَّف قطع الغيار بطريقة «الوارد أولًا صادر أولًا» لحظة خروجها من المخزون — فمشتريات المخزون ليست تكلفة هنا، وإنما تصبح تكلفة عند الاستهلاك. وتطبّق الرواتب المرتبات الحالية على من كان موظفًا في الفترة، إذ إن المرتبات ليست مؤرَّخة السريان. ويُحسب الهامش من إيراد الفترة نفسها، ولا يُؤخذ كمتوسط لأشهرها.",
      },

      // Margin's "variance" is a POINT difference, not a percent. `{v}` is the
      // signed figure, Latin in both languages like every formatted number.
      pts: { en: "{v} pts", ar: "{v} نقطة" },
    },

    // --- the VAT panel under the P&L ----------------------------------------
    // DISPLAY ONLY, and every leaf here exists to keep it that way (§7). There
    // is no total leaf, no net leaf and no "payable to ZATCA" leaf, because
    // there is no such row and there must not be one.
    vat: {
      title: { en: "VAT by source", ar: "ضريبة القيمة المضافة حسب المصدر" },
      intro: {
        en: "Every VAT amount the period recorded, listed beside where it came from. Nothing here is totalled or netted, and none of it forms part of the profit above.",
        ar: "كل مبلغ ضريبة سجّلته الفترة، مدرَجًا بجانب مصدره. لا شيء هنا يُجمع أو يُقاصّ، ولا يدخل أي منه في الربح أعلاه.",
      },

      rowSales: { en: "Sales invoices", ar: "فواتير المبيعات" },
      rowOrdered: { en: "Purchase orders raised", ar: "أوامر الشراء المُصدرة" },
      rowReceived: { en: "Stock received", ar: "المخزون المستلَم" },
      rowRepairs: { en: "Workshop — outsourced repairs", ar: "الورشة — الإصلاحات الخارجية" },
      rowOrderedRejected: { en: "Rejected purchase orders", ar: "أوامر الشراء المرفوضة" },
      rowReceivedRejected: { en: "Rejected stock receipts", ar: "إيصالات المخزون المرفوضة" },

      // The document count AND the date basis, so any line can be taken to the
      // screen it came from and checked. FOUR families, not six: the two
      // rejected lines count the same documents as the two above them, so they
      // read the same hint rather than minting a duplicate.
      hintSales: {
        one: { en: "{n} confirmed invoice · by confirmation date", ar: "فاتورة مؤكدة واحدة · بتاريخ التأكيد" },
        two: { en: "{n} confirmed invoices · by confirmation date", ar: "فاتورتان مؤكدتان · بتاريخ التأكيد" },
        few: { en: "{n} confirmed invoices · by confirmation date", ar: "{n} فواتير مؤكدة · بتاريخ التأكيد" },
        many: { en: "{n} confirmed invoices · by confirmation date", ar: "{n} فاتورة مؤكدة · بتاريخ التأكيد" },
      },
      hintOrders: {
        one: { en: "{n} order · by request date", ar: "أمر واحد · بتاريخ الطلب" },
        two: { en: "{n} orders · by request date", ar: "أمران · بتاريخ الطلب" },
        few: { en: "{n} orders · by request date", ar: "{n} أوامر · بتاريخ الطلب" },
        many: { en: "{n} orders · by request date", ar: "{n} أمرًا · بتاريخ الطلب" },
      },
      hintReceipts: {
        one: { en: "{n} receipt · by received date", ar: "إيصال واحد · بتاريخ الاستلام" },
        two: { en: "{n} receipts · by received date", ar: "إيصالان · بتاريخ الاستلام" },
        few: { en: "{n} receipts · by received date", ar: "{n} إيصالات · بتاريخ الاستلام" },
        many: { en: "{n} receipts · by received date", ar: "{n} إيصالًا · بتاريخ الاستلام" },
      },
      hintRepairs: {
        one: { en: "{n} vendor invoice · by invoice date", ar: "فاتورة مورد واحدة · بتاريخ الفاتورة" },
        two: { en: "{n} vendor invoices · by invoice date", ar: "فاتورتا مورد · بتاريخ الفاتورة" },
        few: { en: "{n} vendor invoices · by invoice date", ar: "{n} فواتير موردين · بتاريخ الفاتورة" },
        many: { en: "{n} vendor invoices · by invoice date", ar: "{n} فاتورة مورد · بتاريخ الفاتورة" },
      },

      rejectedHead: {
        en: "Rejected — listed separately, not included above",
        ar: "مرفوضة — مدرجة على حدة، غير مشمولة أعلاه",
      },

      // The four footnotes. Each `*Bold` leaf is a COMPLETE SENTENCE that the
      // paragraph opens with, so splitting there is a sentence boundary and not
      // a fragment — Arabic keeps its own word order on both sides.
      note1Bold: { en: "These lines are not added together.", ar: "هذه البنود لا تُجمع معًا." },
      note1: {
        en: "Sales VAT is money charged TO customers; the other three are VAT paid TO suppliers. And an order that has since been delivered appears on both “Purchase orders raised” and “Stock received” — the same purchase at two stages, ordered and delivered, not two purchases. A total across this list would be a number that means nothing.",
        ar: "ضريبة المبيعات مال يُحصَّل مِن العملاء؛ والثلاثة الأخرى ضريبة تُدفع إلى الموردين. كما أن الأمر الذي سُلِّم لاحقًا يظهر في «أوامر الشراء المُصدرة» و«المخزون المستلَم» معًا — وهو الشراء نفسه في مرحلتين، طلبًا وتسليمًا، لا شراءان. وأي إجمالي عبر هذه القائمة سيكون رقمًا بلا معنى.",
      },
      note2Bold: { en: "Not a ZATCA return.", ar: "ليس إقرارًا لهيئة الزكاة والضريبة والجمارك." },
      note2: {
        en: "Nothing here is netted and no amount payable or reclaimable is computed. Sales VAT is the VAT on the same confirmed invoices the Revenue statement reports, so those two always agree.",
        ar: "لا شيء هنا يُقاصّ، ولا يُحتسب مبلغ مستحق الدفع أو قابل للاسترداد. وضريبة المبيعات هي ضريبة الفواتير المؤكدة نفسها التي تعرضها قائمة الإيرادات، فالاثنتان متطابقتان دائمًا.",
      },
      note3: {
        en: "Each line is filtered on the date its own source records, matching the statement that already reports those documents: purchase orders by request date, stock receipts by received date (the Costs statement's basis for purchasing spend), repair invoices by supplier invoice date and by entry date where the supplier gave none (the basis behind “Outsourced repairs” above), sales invoices by confirmation date.",
        ar: "يُصفّى كل بند على التاريخ الذي يسجله مصدره، مطابقًا للقائمة التي تعرض تلك المستندات أصلًا: أوامر الشراء بتاريخ الطلب، وإيصالات المخزون بتاريخ الاستلام (وهو أساس إنفاق المشتريات في قائمة التكاليف)، وفواتير الإصلاح بتاريخ فاتورة المورد وبتاريخ الإدخال حين لا يعطي المورد تاريخًا (وهو الأساس خلف «الإصلاحات الخارجية» أعلاه)، وفواتير المبيعات بتاريخ التأكيد.",
      },
      // The one place a `<strong>` sits MID-sentence. Split in three so Arabic
      // places the emphasised word itself — "هنا فقط ولا مكان آخر" puts it
      // after the adverb, where English puts it before.
      note4Before: { en: "Repair VAT appears here and", ar: "تظهر ضريبة الإصلاحات هنا" },
      note4Strong: { en: "only", ar: "فقط" },
      note4After: {
        en: "here — the P&L expenses those invoices net of VAT, so “Outsourced repairs” above does not carry it. One caveat does remain: stock receipts carry no supplier invoice date, so a purchase falls in the month the goods arrived rather than the month the tax invoice was issued.",
        ar: "ولا مكان آخر — إذ تُحمّل قائمة الأرباح والخسائر تلك الفواتير صافية من الضريبة، فبند «الإصلاحات الخارجية» أعلاه لا يحملها. ويبقى تحفظ واحد: إيصالات المخزون لا تحمل تاريخ فاتورة المورد، فتقع المشتريات في شهر وصول البضاعة لا في شهر إصدار الفاتورة الضريبية.",
      },
    },

    // --- the print band, on every statement ---------------------------------
    // `Bin Slimah Group` above it is NOT keyed and carries `translate="no"`:
    // it is the identification a filed sheet has when nothing else on the paper
    // says whose statement it is, and a translated company name defeats that.
    // `{d}` is todayKey() — a Riyadh-local ISO date, Latin in both languages.
    print: {
      generated: { en: "Generated {d}", ar: "صدر في {d}" },
    },

    // --- the REVENUE statement ----------------------------------------------
    revenue: {
      title: { en: "Revenue statement", ar: "قائمة الإيرادات" },
      empty: {
        en: "No invoices were confirmed in this period.",
        ar: "لم تُؤكَّد أي فاتورة في هذه الفترة.",
      },
      returnsHead: {
        en: "Sales returns (reversed invoicing)",
        ar: "مردودات المبيعات (فواتير المرتجعة)",
      },
      noneInPeriod: { en: "None in this period.", ar: "لا شيء في هذه الفترة." },
      totalReversed: { en: "Total reversed", ar: "إجمالي المرتجع" },
      note: {
        en: "Revenue is net of VAT and counts every invoice that has been confirmed, including those since paid. Sales returns are shown on their own line and are already excluded from the revenue above — the two are never netted silently. Outstanding is the amount still due, which on a prepaid account can be less than the invoice value because part was covered by balance.",
        ar: "الإيراد صافٍ من ضريبة القيمة المضافة ويشمل كل فاتورة مؤكدة، بما فيها المسددة لاحقًا. وتُعرض مردودات المبيعات في بند مستقل وهي مستبعَدة أصلًا من الإيراد أعلاه — فلا تُصافى الاثنتان بصمت. والمستحق هو المبلغ الباقي، وقد يقل في الحساب المدفوع مقدَّمًا عن قيمة الفاتورة لأن جزءًا منها غُطِّي من الرصيد.",
      },
    },

    // --- the RECEIVABLES statement ------------------------------------------
    // `nothingOutstanding` above serves the empty state — the Overview's
    // receivables panel says the same sentence in the same words.
    receivables: {
      title: { en: "Receivables statement", ar: "قائمة الذمم المدينة" },
      asOfToday: { en: "As of today", ar: "حتى تاريخ اليوم" },
      // `{b}` is the aging bucket EXACTLY as the view publishes it — "0-30",
      // "90+". Digits and punctuation only, so it is not translated and not
      // reformatted; only the word beside it is keyed.
      bandDays: { en: "{b} days", ar: "{b} يومًا" },
      openInvoices: { en: "Open invoices, oldest first", ar: "الفواتير المفتوحة، الأقدم أولًا" },
      note: {
        en: "A position as of today, not a figure for the selected period — the period picker does not apply to it. Invoices age from the date they were confirmed, because this schema has no payment-terms column to age from a due date.",
        ar: "هذا مركز حتى تاريخ اليوم، لا رقم للفترة المختارة — فمُحدِّد الفترة لا ينطبق عليه. وتُحتسب أعمار الفواتير من تاريخ تأكيدها، لأن هذا المخطط لا يتضمن عمودًا لشروط السداد يُحتسب منه تاريخ الاستحقاق.",
      },
    },

    // --- the COST statements ------------------------------------------------
    // MONEY VOCABULARY. Same rule as the P&L above: the Arabic is the standard
    // Saudi/IFRS term where one exists, flagged for Turki rather than invented,
    // and every leaf labels a number the views already produced.
    costs: {
      title: { en: "Cost statements", ar: "قوائم التكاليف" },

      // --- station fill (0112) ---
      fillHead: { en: "Station fill cost", ar: "تكلفة التعبئة بالمحطات" },
      // ENGLISH NEVER INFLECTS HERE — the source says "fills costed" whatever
      // the count is — so all four English buckets are the SAME string and only
      // the Arabic moves. That is the invariant working as intended, not a
      // duplicate: `plural()` is an Arabic-shaped function and English opting
      // out of three of its four buckets is what opting out looks like.
      //
      // `{n}` stays RAW at the call site. This count was interpolated directly
      // and never passed through formatNum, so routing it through one now would
      // put a thousands separator into a phrase that never had one.
      fillsCosted: {
        one: { en: "{n} fills costed", ar: "تعبئة واحدة مكلَّفة" },
        two: { en: "{n} fills costed", ar: "تعبئتان مكلَّفتان" },
        few: { en: "{n} fills costed", ar: "{n} تعبئات مكلَّفة" },
        many: { en: "{n} fills costed", ar: "{n} تعبئة مكلَّفة" },
      },
      // The SECOND two-word splice in this batch — English switched "fill
      // has"/"fills have" AND "its"/"their" off one `=== 1` test. Stored whole
      // per bucket rather than assembled, same call as reports.pnl.uncosted.
      uncosted: {
        one: {
          en: "{n} fill has no price for its water type — cost unknown, not zero, and not included above",
          ar: "تعبئة واحدة بلا سعر لنوع مياهها — التكلفة مجهولة لا صفر، وغير مُدرجة أعلاه",
        },
        two: {
          en: "{n} fills have no price for their water type — cost unknown, not zero, and not included above",
          ar: "تعبئتان بلا سعر لنوع مياههما — التكلفة مجهولة لا صفر، وغير مُدرجة أعلاه",
        },
        few: {
          en: "{n} fills have no price for their water type — cost unknown, not zero, and not included above",
          ar: "{n} تعبئات بلا سعر لنوع مياهها — التكلفة مجهولة لا صفر، وغير مُدرجة أعلاه",
        },
        many: {
          en: "{n} fills have no price for their water type — cost unknown, not zero, and not included above",
          ar: "{n} تعبئة بلا سعر لنوع مياهها — التكلفة مجهولة لا صفر، وغير مُدرجة أعلاه",
        },
      },
      noFills: { en: "No fills in this period.", ar: "لا توجد تعبئات في هذه الفترة." },
      byWaterType: { en: "By water type", ar: "حسب نوع المياه" },
      byStation: { en: "By station", ar: "حسب المحطة" },
      // A station whose key no longer resolves to a name. The cost still counts,
      // so the row is LABELLED rather than dropped — `{k}` is the immutable
      // station_key (0014), data, and stays Latin.
      stationRemoved: { en: "{k} (removed)", ar: "{k} (محذوفة)" },

      // --- maintenance ---
      maintHead: { en: "Maintenance by truck", ar: "الصيانة حسب الشاحنة" },
      noMaint: {
        en: "No maintenance spend reached a truck in this period.",
        ar: "لم يصل أي إنفاق صيانة إلى شاحنة في هذه الفترة.",
      },
      maintNote: {
        en: "Three separate measures, never blended into one figure. Parts is the FIFO cost of what each truck's work orders consumed; outsourced is what outside workshops were paid for that truck. Labour on in-house work orders is not costed anywhere in this schema, so it is in neither column.",
        ar: "ثلاثة مقاييس منفصلة، لا تُدمج أبدًا في رقم واحد. فقطع الغيار هي تكلفة «الوارد أولًا صادر أولًا» لما استهلكته أوامر عمل كل شاحنة؛ والأعمال الخارجية هي ما دُفع للورش الخارجية عن تلك الشاحنة. أما أجور العمل على أوامر العمل الداخلية فلا تُكلَّف في أي موضع من هذا المخطط، فهي ليست في أي من العمودين.",
      },

      // --- payroll ---
      staffSalaries: { en: "Staff salaries", ar: "رواتب الموظفين" },
      driverSalaries: { en: "Driver salaries", ar: "رواتب السائقين" },
      totalPayroll: { en: "Total payroll", ar: "إجمالي الرواتب" },
      // Split at the one MID-sentence <strong>. English emphasises the term
      // before the preposition; Arabic keeps the same slot, so a three-part
      // split is enough and no reordering is needed.
      payrollNoteBefore: {
        en: "Two things to know about this figure. Salaries are",
        ar: "أمران يجب معرفتهما عن هذا الرقم. الرواتب",
      },
      payrollNoteStrong: { en: "not effective-dated", ar: "غير مؤرَّخة بتاريخ سريان" },
      payrollNoteAfter: {
        en: "in this schema, so a past period is costed at each person's current salary — a raise changes history. Only the employment window is historical.",
        ar: "في هذا المخطط، فتُكلَّف الفترة الماضية براتب كل شخص الحالي — والزيادة تغيّر التاريخ. ونافذة التوظيف وحدها هي التاريخية.",
      },
      // A THREE-word English splice off one `=== 1` test — "person has"/"people
      // have" and "counts"/"count". Whole sentence per bucket.
      missingSalary: {
        one: {
          en: "And in at least one month of this period, {n} employed person has no salary recorded and counts as zero. That is a per-month state, so it is reported as the highest month rather than added up.",
          ar: "وفي شهر واحد على الأقل من هذه الفترة، هناك موظف واحد بلا راتب مسجَّل ويُحتسب صفرًا. وهذه حالة شهرية، فتُعرض بأعلى شهر لا بالجمع.",
        },
        two: {
          en: "And in at least one month of this period, {n} employed people have no salary recorded and count as zero. That is a per-month state, so it is reported as the highest month rather than added up.",
          ar: "وفي شهر واحد على الأقل من هذه الفترة، هناك موظفان بلا راتب مسجَّل ويُحتسبان صفرًا. وهذه حالة شهرية، فتُعرض بأعلى شهر لا بالجمع.",
        },
        few: {
          en: "And in at least one month of this period, {n} employed people have no salary recorded and count as zero. That is a per-month state, so it is reported as the highest month rather than added up.",
          ar: "وفي شهر واحد على الأقل من هذه الفترة، هناك {n} موظفين بلا راتب مسجَّل ويُحتسبون صفرًا. وهذه حالة شهرية، فتُعرض بأعلى شهر لا بالجمع.",
        },
        many: {
          en: "And in at least one month of this period, {n} employed people have no salary recorded and count as zero. That is a per-month state, so it is reported as the highest month rather than added up.",
          ar: "وفي شهر واحد على الأقل من هذه الفترة، هناك {n} موظفًا بلا راتب مسجَّل ويُحتسبون صفرًا. وهذه حالة شهرية، فتُعرض بأعلى شهر لا بالجمع.",
        },
      },

      // --- commissions ---
      commissionsHead: { en: "Commissions — earned and paid", ar: "العمولات — المكتسبة والمدفوعة" },
      // The two column heads ARE the basis distinction 0100 exists to protect,
      // said in the table rather than left to the reader. The word in brackets
      // is the enum, so it reads what reports.basis.* reads.
      earnedAccrual: { en: "Earned (accrual)", ar: "المكتسبة (الاستحقاق)" },
      paidCash: { en: "Paid (cash)", ar: "المدفوعة (النقدي)" },
      tripCommission: { en: "Trip commission", ar: "عمولة الرحلات" },
      specials: { en: "Specials", ar: "المدفوعات الخاصة" },
      adjustments: { en: "Adjustments", ar: "التسويات" },
      bonuses: { en: "Bonuses", ar: "المكافآت" },
      totalEarned: { en: "Total earned", ar: "إجمالي المكتسب" },
      payouts: { en: "Payouts", ar: "الدفعات" },
      totalPaid: { en: "Total paid", ar: "إجمالي المدفوع" },
      // The <strong> opens no sentence here, so the split is mid-sentence and
      // the AFTER part starts with a full stop — no separator space belongs
      // between it and the emphasis, and the JSX adds none.
      commissionsNoteBefore: { en: "Side by side, and", ar: "تُعرضان جنبًا إلى جنب، ويجب" },
      commissionsNoteStrong: { en: "never added together", ar: "ألا تُجمعا أبدًا" },
      commissionsNoteAfter: {
        en: ". A payout's base is the same trip commission already counted as earned, so summing the two would count it twice. Earned lands in the month the work was done; paid lands when the payout was made. Adjustments are signed and are often negative deductions, which correctly reduce the earned total.",
        ar: ". فأساس الدفعة هو نفس عمولة الرحلات المحتسبة أصلًا كمكتسبة، وجمعهما يحتسبها مرتين. المكتسب يقع في شهر إنجاز العمل؛ والمدفوع يقع عند صرف الدفعة. والتسويات موقَّعة وكثيرًا ما تكون خصومًا سالبة، فتخفض إجمالي المكتسب عن حق.",
      },

      // --- purchasing ---
      // `&amp;` in the JSX was ESCAPING, not content: this has always rendered a
      // literal "P&L". The heading shouts NOT because the whole point of the
      // section is that a purchase is inventory, not an expense.
      purchasingHead: {
        en: "Purchasing — procurement and cash, NOT a P&L cost",
        ar: "المشتريات — توريد ونقد، وليست تكلفة في الأرباح والخسائر",
      },
      stockReceived: { en: "Stock received", ar: "المخزون المستلم" },
      receipts: { en: "Receipts", ar: "الإيصالات" },
      purchasingNoteBefore: {
        en: "A procurement and cash view only. This is deliberately",
        ar: "هذا عرض للتوريد والنقد فقط. وهو عمدًا",
      },
      purchasingNoteStrong: { en: "not", ar: "ليس" },
      purchasingNoteAfter: {
        en: "a P&L line: a purchase is inventory until it is consumed, and expensing both the purchase and the consumption would double-count. That cost reaches the P&L later, as parts consumed, when the stock is actually used.",
        ar: "بندًا في الأرباح والخسائر: فالشراء مخزون حتى يُستهلك، وتحميل الشراء والاستهلاك معًا يحتسب التكلفة مرتين. وتلك التكلفة تبلغ الأرباح والخسائر لاحقًا، كقطع غيار مستهلكة، عند استخدام المخزون فعلًا.",
      },
    },

    // --- the OPERATIONS statement -------------------------------------------
    ops: {
      title: { en: "Operational performance", ar: "الأداء التشغيلي" },
      noTrips: {
        en: "No trips were recorded in this period, so there is nothing to break down by driver.",
        ar: "لم تُسجَّل أي رحلات في هذه الفترة، فلا يوجد ما يُفصَّل حسب السائق.",
      },
      // THE NO-DRIVER BUCKET, named. It is app chrome and not a driver record:
      // the view keeps the row (grouping before the join) so the driver figures
      // still foot to the period total, and the UI names it rather than
      // dropping it. Read TWICE — the table cell and the footnote's emphasis —
      // from this one leaf, because two spellings of one bucket is how a
      // reader stops believing they are the same row.
      //
      // NOTHING BRANCHES ON THIS STRING. The sort and the footnote's condition
      // both test `key === "__unassigned__"`, which is data, so translating the
      // label cannot move a row or hide a note.
      unassigned: { en: "Unassigned", ar: "غير مُسنَدة" },
      deliveryByDriver: { en: "Delivery by driver", ar: "التسليم حسب السائق" },
      // Only ever rendered when trucksUsed > 1, so the `one` bucket is
      // unreachable — it still carries the same English as its siblings, both
      // because the invariant asks for it and because an unreachable leaf that
      // disagrees is a trap for whoever makes it reachable.
      droveTrucks: {
        one: { en: "drove {n} trucks", ar: "قاد شاحنة واحدة" },
        two: { en: "drove {n} trucks", ar: "قاد شاحنتين" },
        few: { en: "drove {n} trucks", ar: "قاد {n} شاحنات" },
        many: { en: "drove {n} trucks", ar: "قاد {n} شاحنة" },
      },
      deliveryNote: {
        en: "Each driver's completion rate is computed from that driver's own scheduled and delivered counts — never averaged, and never inherited from the period figure below. The plate beside a name is the truck that driver was in; it is context only and is never measured per driver. Drivers are grouped by record, not by name, so two people sharing a first name stay on separate rows — the plate is what tells them apart.",
        ar: "تُحتسب نسبة إنجاز كل سائق من أعداد رحلاته المجدولة والمسلَّمة وحدها — لا تُتوسَّط أبدًا، ولا تُورَّث من رقم الفترة أدناه. واللوحة بجانب الاسم هي شاحنة ذلك السائق؛ وهي سياق فقط ولا تُقاس أبدًا لكل سائق. ويُجمَّع السائقون حسب السجل لا حسب الاسم، فيبقى شخصان يتشاركان الاسم الأول في صفين منفصلين — واللوحة هي ما يميّز بينهما.",
      },
      utilisationHead: { en: "Fleet utilisation by driver", ar: "استغلال الأسطول حسب السائق" },
      utilisationNote: {
        en: "Workload shares, so they measure the DRIVER. A truck-level figure never appears in a driver row — trucks that moved and maintenance activity stay in the period summary below. Shares are computed against the period totals and add to 100%.",
        ar: "هذه حصص من عبء العمل، فهي تقيس السائق. ولا يظهر أي رقم على مستوى الشاحنة في صف سائق — فالشاحنات التي تحركت ونشاط الصيانة يبقيان في ملخص الفترة أدناه. وتُحتسب الحصص مقابل إجماليات الفترة ويبلغ مجموعها 100%.",
      },
      unassignedNoteBefore: { en: "One row is", ar: "أحد الصفوف" },
      unassignedNoteAfter: {
        en: ": trips recorded with no driver. It is kept so the driver rows still add up to the period total rather than quietly falling short.",
        ar: ": رحلات سُجِّلت بلا سائق. ويُبقى عليه كي تظل صفوف السائقين تبلغ إجمالي الفترة بدل أن تقصر عنه بصمت.",
      },
      periodSummary: { en: "Period summary", ar: "ملخص الفترة" },
      deliveryCompletionRate: { en: "Delivery completion rate", ar: "نسبة إنجاز التسليم" },
      trucksThatMoved: { en: "Trucks that moved", ar: "الشاحنات التي تحركت" },
      // Only on a multi-month period, and it is the honest qualifier on a
      // NON-ADDITIVE measure — see countsNote below for the rule it applies.
      mostInAnyMonth: { en: "— most in any one month", ar: "— الأعلى في أي شهر منفرد" },
      workOrders: { en: "Work orders", ar: "أوامر العمل" },
      outsourcedJobs: { en: "Outsourced jobs", ar: "الأعمال الخارجية" },
      maintenanceEvents: { en: "Maintenance events", ar: "أحداث الصيانة" },
      exitPermits: { en: "Exit permits", ar: "تصاريح الخروج" },
      byMonth: { en: "By month", ar: "حسب الشهر" },
      // The <strong> here OPENS a complete sentence, so the split is at a
      // sentence boundary and both languages read naturally either side.
      countsNoteBefore: {
        en: "Trips, work orders, outsourced jobs and permits are event counts, so they add across months.",
        ar: "الرحلات وأوامر العمل والأعمال الخارجية والتصاريح أعداد أحداث، فتُجمع عبر الأشهر.",
      },
      countsNoteStrong: {
        en: "Trucks that moved does not.",
        ar: "أما الشاحنات التي تحركت فلا تُجمع.",
      },
      countsNoteAfter: {
        en: "It is a distinct count, and a truck working in two months would be counted twice by a sum — so a multi-month period reports the highest single month. A true period-level distinct count cannot be recovered from monthly rows.",
        ar: "فهي عدد مميَّز، والشاحنة العاملة في شهرين يحتسبها الجمع مرتين — لذا تعرض الفترة متعددة الأشهر أعلى شهر منفرد. ولا يمكن استخراج عدد مميَّز حقيقي على مستوى الفترة من صفوف شهرية.",
      },
      // TWO mid-sentence emphases in one sentence, so five leaves. The middle
      // one ends in "وكذلك" rather than a bare "و" — the JSX puts a space
      // before the emphasis, and Arabic will not take a space after a
      // prefixed conjunction.
      absentNote1: {
        en: "Two measures are deliberately absent because the data cannot support them honestly yet:",
        ar: "مقياسان غائبان عمدًا لأن البيانات لا تدعمهما بأمانة بعد:",
      },
      absentStrong1: { en: "idle trucks", ar: "الشاحنات المتوقفة" },
      absentNote2: {
        en: "needs the fleet roster alongside these counts, and",
        ar: "تحتاج إلى سجل الأسطول إلى جانب هذه الأعداد، وكذلك",
      },
      absentStrong2: { en: "fleet availability", ar: "جاهزية الأسطول" },
      absentNote3: {
        en: "needs the distinct trucks under maintenance in the period. Neither is estimated here.",
        ar: "تحتاج إلى العدد المميَّز للشاحنات تحت الصيانة في الفترة. ولا يُقدَّر أي منهما هنا.",
      },
    },

    // --- the CUSTOM report's own chrome --------------------------------------
    // The COLUMNS it prints are named by reports.metric.* and their sub-heading
    // by basisLabel(); the NOTES under it come from reports.builder.note. What
    // is here is only what this component itself writes.
    custom: {
      title: { en: "Custom report", ar: "تقرير مخصص" },
      noColumns: { en: "No columns selected.", ar: "لم تُختر أي أعمدة." },
      noMatch: { en: "Nothing matched this selection.", ar: "لا شيء يطابق هذا الاختيار." },
      note: {
        en: "Built from defined metrics only, reading the same views as every other report on this page. There is deliberately no total across columns — metrics on different bases must never be added.",
        ar: "مبني من مقاييس معرَّفة فقط، ويقرأ نفس العروض التي يقرأها كل تقرير آخر في هذه الصفحة. ولا يوجد عمدًا إجمالي عبر الأعمدة — فالمقاييس على أسس مختلفة يجب ألا تُجمع أبدًا.",
      },
      changeSelection: { en: "Change selection", ar: "تغيير الاختيار" },
    },

    // --- PAYSLIPS (0115) — the register and the document --------------------
    payslips: {
      empty: {
        en: "No drivers on the payroll for this period.",
        ar: "لا يوجد سائقون على كشف الرواتب لهذه الفترة.",
      },
      count: {
        one: { en: "{n} payslip", ar: "قسيمة راتب واحدة" },
        two: { en: "{n} payslips", ar: "قسيمتا راتب" },
        few: { en: "{n} payslips", ar: "{n} قسائم رواتب" },
        many: { en: "{n} payslips", ar: "{n} قسيمة راتب" },
      },
      issuedCount: {
        one: { en: "{n} issued", ar: "واحدة صادرة" },
        two: { en: "{n} issued", ar: "اثنتان صادرتان" },
        few: { en: "{n} issued", ar: "{n} صادرة" },
        many: { en: "{n} issued", ar: "{n} صادرة" },
      },
      totalNet: { en: "Total net", ar: "إجمالي الصافي" },

      // The chip that says paid vs earned IN WORDS rather than leaving it to a
      // colour. Its own two leaves, NOT reports.th.paid: that one heads a money
      // column ("المسدد"), this one is a state on a commission figure.
      chipPaid: { en: "Paid", ar: "مدفوعة" },
      chipEarned: { en: "Earned", ar: "مكتسبة" },
      chipPaidTitle: {
        en: "Settled — this commission was actually paid out in this month",
        ar: "مسوّاة — صُرفت هذه العمولة فعلًا في هذا الشهر",
      },
      chipEarnedTitle: {
        en: "Earned but not yet paid. It will appear again as PAID on the payslip for the month it is settled in.",
        ar: "مكتسبة ولم تُدفع بعد. وستظهر مرة أخرى كمدفوعة في قسيمة الشهر الذي تُسوّى فيه.",
      },

      // The four STATUS words, in the priority the register applies them. The
      // priority test is on data (`doc`, `terminated`, `hire_date_missing`,
      // `isRunning`), never on these words.
      statusTerminated: { en: "Terminated", ar: "منتهية خدمته" },
      statusNoHireDate: { en: "No hire date", ar: "بلا تاريخ تعيين" },
      statusMonthInProgress: { en: "Month in progress", ar: "الشهر جارٍ" },
      statusNotIssued: { en: "Not issued", ar: "غير صادرة" },
      // `{d}` is a stored ISO date, Latin. The suffix is appended with a space
      // added in code, not carried on the value.
      leftOn: { en: "Left the company on {d}", ar: "غادر الشركة في {d}" },
      leftOnNoHire: {
        en: "· no hire date recorded, so no payslip can be issued",
        ar: "· لا يوجد تاريخ تعيين مسجَّل، فلا يمكن إصدار قسيمة",
      },
      registerNote: {
        en: "An unissued row is a PREVIEW: its salary is today's salary, and it will change if the salary changes. Issuing freezes the figures and numbers the document — from then on the payslip shows what it showed on the day it was issued, whatever happens to the salary afterwards.",
        ar: "الصف غير الصادر معاينة: راتبه هو راتب اليوم، وسيتغير إذا تغير الراتب. والإصدار يجمّد الأرقام ويرقّم المستند — ومن تلك اللحظة تعرض القسيمة ما عرضته يوم إصدارها، مهما حدث للراتب بعدها.",
      },

      // --- the document ---
      // The arrow is INSIDE the value: in an RTL line the reading order runs
      // right to left, so a left-pointing arrow would point away from where
      // "back" is. Same call as the consumption explainer's →.
      allPayslips: { en: "← All payslips", ar: "→ كل قسائم الرواتب" },
      // `{d}` is an ISO date; `{b}` is the issuer's name — entity data, not
      // chrome, and it has no `_ar` column to read.
      issuedBy: { en: "Issued {d} by {b}", ar: "صدرت في {d} بواسطة {b}" },
      issuing: { en: "Issuing…", ar: "جارٍ الإصدار…" },
      issuePayslip: { en: "Issue payslip", ar: "إصدار قسيمة" },
      noHireTitle: {
        en: "This driver has no hire date, so a payslip period cannot be established. Set the hire date on the driver first.",
        ar: "هذا السائق بلا تاريخ تعيين، فلا يمكن تحديد فترة قسيمة. حدّد تاريخ التعيين على السائق أولًا.",
      },
      runningTitle: {
        en: "This month has not finished yet. A payslip can only be issued for a completed month.",
        ar: "هذا الشهر لم ينتهِ بعد. ولا تُصدر القسيمة إلا عن شهر مكتمل.",
      },
      // The word alone — the payslip NUMBER beside it is monospace data.
      payslipWord: { en: "Payslip", ar: "قسيمة راتب" },
      payslipNotIssued: { en: "Payslip (not issued)", ar: "قسيمة راتب (غير صادرة)" },
      blockedNoHire: {
        en: "This driver has no hire date recorded, so there is no employment period a payslip could cover. Set the hire date on the driver, then issue. The figures below are shown for reference only.",
        ar: "هذا السائق بلا تاريخ تعيين مسجَّل، فلا توجد فترة توظيف يمكن أن تغطيها قسيمة. حدّد تاريخ التعيين على السائق ثم أصدرها. والأرقام أدناه معروضة للاسترشاد فقط.",
      },
      blockedRunning: {
        en: "This month is still running. A payslip can only be issued once the month has finished, so the figures below are not final.",
        ar: "هذا الشهر ما زال جاريًا. ولا تُصدر القسيمة إلا بعد انتهاء الشهر، فالأرقام أدناه ليست نهائية.",
      },
      notIssuedBefore: {
        en: "Not issued yet. Salary is shown at",
        ar: "لم تصدر بعد. الراتب معروض بسعر",
      },
      notIssuedStrong: { en: "today's", ar: "اليوم" },
      notIssuedAfter: {
        en: "rate — issuing freezes these figures and assigns the payslip number.",
        ar: "— والإصدار يجمّد هذه الأرقام ويسند رقم القسيمة.",
      },

      // --- the confirm panel (irreversible, so it asks first) ---
      confirmTitle: { en: "Issue this payslip?", ar: "إصدار هذه القسيمة؟" },
      // FOUR FRAGMENTS AROUND THREE BOLD DATA SLOTS — the driver's name, the
      // month and the net figure — and the slot ORDER is the same in both
      // languages, so this is a sentence with three inline values rather than
      // a grammatical unit spliced from parts.
      //
      // `confirmAfterName` is the ONE value in this dictionary that carries
      // edge whitespace, and it is deliberate: English attaches "'s" to the
      // name with NO space and Arabic needs one, so the difference IS the
      // translation. Putting a `{" "}` in the JSX would break English; leaving
      // it out would break Arabic. The space lives on the Arabic value.
      confirmBefore: { en: "This freezes", ar: "يُجمِّد هذا راتب" },
      confirmAfterName: { en: "'s pay for", ar: " عن" },
      confirmAfterMonth: { en: "at", ar: "عند" },
      confirmTail: {
        en: "net and gives it a permanent payslip number.",
        ar: "صافيًا، ويمنحه رقم قسيمة دائمًا.",
      },
      confirmUndoStrong: { en: "It cannot be undone from here.", ar: "لا يمكن التراجع عنه من هنا." },
      confirmUndoAfter: {
        en: "The figures stop following the driver's salary from this moment — that is the point of issuing, and it is why there is no edit or delete afterwards.",
        ar: "تتوقف الأرقام عن تتبّع راتب السائق من هذه اللحظة — وهذا هو الغرض من الإصدار، ولهذا لا يوجد تعديل ولا حذف بعده.",
      },
      yesIssueIt: { en: "Yes, issue it", ar: "نعم، أصدرها" },

      // --- the figures table ---
      // `Commission` is reports.th.commission and `Adjustments` is
      // reports.costs.adjustments — the same words the cost statement uses for
      // the same money. What is here is what only a payslip says.
      basicSalary: { en: "Basic salary", ar: "الراتب الأساسي" },
      specialPayments: { en: "Special payments", ar: "مدفوعات خاصة" },
      bonus: { en: "Bonus", ar: "مكافأة" },
      deductions: { en: "Deductions", ar: "الخصومات" },
      netPay: { en: "Net pay", ar: "صافي الراتب" },
      // The `one` branch carries NO number in English — the source says
      // "Settled by payout", not "Settled by 1 payout" — which is exactly the
      // freedom EN[one] has. fill() simply finds no token to replace.
      settledBy: {
        one: { en: "Settled by payout", ar: "سُوِّيت بدفعة واحدة" },
        two: { en: "Settled by {n} payouts", ar: "سُوِّيت بدفعتين" },
        few: { en: "Settled by {n} payouts", ar: "سُوِّيت بـ {n} دفعات" },
        many: { en: "Settled by {n} payouts", ar: "سُوِّيت بـ {n} دفعة" },
      },
      covers: {
        one: { en: "Covers {n} trip worked", ar: "تغطي رحلة واحدة أُنجزت" },
        two: { en: "Covers {n} trips worked", ar: "تغطي رحلتين أُنجزتا" },
        few: { en: "Covers {n} trips worked", ar: "تغطي {n} رحلات أُنجزت" },
        many: { en: "Covers {n} trips worked", ar: "تغطي {n} رحلة أُنجزت" },
      },
      earlierMonth: {
        en: "Some of that work was done in an earlier month; it is paid here because that is when it was settled.",
        ar: "جزء من ذلك العمل أُنجز في شهر سابق؛ ويُدفع هنا لأن التسوية تمت في هذا الشهر.",
      },
      earnedNoteBefore: { en: "This commission is", ar: "هذه العمولة" },
      earnedNoteStrong: { en: "earned but not yet paid", ar: "مكتسبة ولم تُدفع بعد" },
      earnedNoteAfter: {
        en: ". When it is settled it will appear again, as PAID, on the payslip for the month it is paid in — that is a record of two different events, not the same money counted twice.",
        ar: ". وعند تسويتها ستظهر مرة أخرى، كمدفوعة، في قسيمة الشهر الذي تُدفع فيه — وهذا تسجيل لحدثين مختلفين، لا احتساب لنفس المال مرتين.",
      },
      noSalaryRecorded: {
        en: "No salary is recorded for this driver, so basic salary reads 0.",
        ar: "لا يوجد راتب مسجَّل لهذا السائق، فالراتب الأساسي يقرأ 0.",
      },
    },

    // --- COMMISSION REVIEW (0116) — display only ----------------------------
    // It sits under the payslip register and reports a DIFFERENT basis on
    // purpose, so the same driver legitimately shows two totals on one screen.
    // The heading, the subtitle and the footnote all say "work month" out loud
    // rather than leaving it to be inferred — which is why `workMonth` is one
    // leaf read by all three.
    commissionReview: {
      title: { en: "Commission earned by driver", ar: "العمولة المكتسبة حسب السائق" },
      workMonth: { en: "work month", ar: "شهر العمل" },
      subtitleAfterMonth: {
        en: "— what each driver earned from the trips he drove in this period,",
        ar: "— ما كسبه كل سائق من الرحلات التي قادها في هذه الفترة،",
      },
      subtitleStrong: {
        en: "whether or not it has been paid out yet",
        ar: "سواء صُرفت له بعد أم لا",
      },
      printThisTable: { en: "Print this table", ar: "طباعة هذا الجدول" },

      // THE DISTINCTION, STATED WHERE THE NUMBERS ARE. Five emphasised words
      // inside one paragraph, each a whole grammatical unit occupying the same
      // slot in both languages.
      distinct1: { en: "This is", ar: "هذا" },
      distinctNot: { en: "not", ar: "ليس" },
      distinct2: {
        en: "the payslip figure above. The payslip register shows what was",
        ar: "رقم القسيمة أعلاه. سجل القسائم يعرض ما",
      },
      distinctSettled: { en: "settled", ar: "سُوِّي" },
      distinct3: {
        en: "in this month; this table shows what was",
        ar: "في هذا الشهر؛ وهذا الجدول يعرض ما",
      },
      distinctEarned: { en: "earned", ar: "اكتُسب" },
      distinct4: {
        en: "in the month the work was done. A driver whose June trips were paid in July appears here under",
        ar: "في الشهر الذي أُنجز فيه العمل. فالسائق الذي دُفعت رحلات يونيو الخاصة به في يوليو يظهر هنا تحت",
      },
      // Two MONTH NAMES used as an example, not as data — they are part of the
      // sentence and are translated with it.
      distinctJune: { en: "June", ar: "يونيو" },
      distinct5: { en: "and on his payslip under", ar: "وفي قسيمته تحت" },
      distinctJuly: { en: "July", ar: "يوليو" },
      distinct6: {
        en: ", so the two totals differing is expected, not an error.",
        ar: "، فاختلاف الإجماليين متوقع لا خطأ.",
      },

      noDeliveredTrips: {
        en: "No delivered trips in this period.",
        ar: "لا توجد رحلات مسلَّمة في هذه الفترة.",
      },
      // A NULL project is a direct-customer trip — real work with real
      // commission, kept by the view rather than dropped. Read TWICE, like
      // ops.unassigned: the project chip and the footnote's emphasis.
      directCustomer: { en: "Direct customer", ar: "عميل مباشر" },
      reviewNote: {
        en: "Delivered trips only — commission is earned on delivery, so a scheduled or in-transit trip has earned nothing yet and is not counted here. The small number beside each project is that project's trip count. Trips taken for a direct customer rather than a project are grouped as",
        ar: "الرحلات المسلَّمة فقط — فالعمولة تُكتسب عند التسليم، والرحلة المجدولة أو الجارية لم تكسب شيئًا بعد ولا تُحتسب هنا. والرقم الصغير بجانب كل مشروع هو عدد رحلات ذلك المشروع. أما الرحلات المنفَّذة لعميل مباشر لا لمشروع فتُجمَّع تحت",
      },
    },

    // --- Daily Trips (DailyTripsTab + lib/daily-trips) -----------------------
    // The one statement in the pack that fetches its own data, owns its own
    // period control, and has a WRITE surface (the manual side-log, 0166).
    //
    // Most of what it says is already keyed and is read from there rather than
    // copied: the on-screen heading is reports.statements.tab.daily (one
    // statement, one spelling), the table headings are reports.th.* and
    // common.* — the same leaves the cost and revenue tables read — and Print /
    // Cancel / Saving… / Add / Edit / Delete / Loading… / Try again are shared
    // chrome. What is below is only what this tab alone writes.
    //
    // `Revenue` reads common.revenue, whose Arabic is "الإيرادات"; this tab
    // said "الإيراد" before this commit. One spelling, and it is the one the
    // rest of Reports already prints.
    //
    // NOT KEYED, DELIBERATELY: validateDeferred()'s six messages and the two
    // load/save fallbacks. That validator runs on BOTH sides — the form calls
    // it and so does the server action, which returns its string to the client
    // as `error`. Translating the client half alone would make one validation
    // failure read Arabic when caught locally and English when caught by the
    // server. Server strings are out of this batch's scope; flagged instead.
    daily: {
      // The print-only band. Different words from the on-screen heading on
      // purpose: on paper there is no tab strip around the table, so the record
      // has to name itself as a REPORT.
      printTitle: { en: "Daily Trips Report", ar: "تقرير الرحلات اليومي" },
      subtitle: {
        en: "A printable daily record — every active project, every assigned driver.",
        ar: "سجل يومي قابل للطباعة — كل مشروع نشط، وكل سائق مُسنَد.",
      },

      // THE FIVE SEGMENTED PERIOD BUTTONS. These were `en`/`ar` COLUMNS on
      // DAILY_PERIODS in lib/daily-trips.ts — display text living in a lib that
      // displays nothing, which is the shape CLAUDE.md §7 records for
      // DailyOps.revenue. That list is keys now and the names are read here.
      //
      // Indefinite ("شهر", not reports.th.month's "الشهر"): these NAME period
      // lengths on a toggle, they do not head a column.
      period: {
        day: { en: "Day", ar: "يوم" },
        week: { en: "Week", ar: "أسبوع" },
        month: { en: "Month", ar: "شهر" },
        quarter: { en: "Quarter", ar: "ربع" },
        year: { en: "Year", ar: "سنة" },
      },

      // No trailing space in the value — the gap before the period is a JSX
      // `{" "}` at the call site, so neither language stores edge whitespace.
      showing: { en: "Showing:", ar: "الفترة:" },
      // Lowercase, and NOT common.loading: this one is spliced mid-line after a
      // bullet ("· loading…"), where a standalone "Loading…" would read as the
      // start of a new sentence. The bullet is punctuation and stays in the JSX.
      loadingInline: { en: "loading…", ar: "جارٍ التحميل…" },
      noActiveProjects: { en: "No active projects.", ar: "لا توجد مشاريع نشطة." },
      // An assigned driver who drove nothing STILL GETS A ROW — on a printout
      // an absent name and an idle driver must not look the same. This marks
      // the difference between them.
      noTrips: { en: "(no trips)", ar: "(لم يقد)" },
      // WHOLE SENTENCE PER COUNT BUCKET. English spliced only the noun off a
      // `=== 1` test and Arabic used one form for every count — the splice this
      // batch exists to remove. `{n}` goes in RAW at the call site: it was
      // interpolated directly and formatNum would add a thousands separator the
      // line never had.
      assignedDrivers: {
        one: { en: "{n} assigned driver", ar: "سائق مُسنَد واحد" },
        two: { en: "{n} assigned drivers", ar: "سائقان مُسنَدان" },
        few: { en: "{n} assigned drivers", ar: "{n} سائقين مُسنَدين" },
        many: { en: "{n} assigned drivers", ar: "{n} سائقًا مُسنَدًا" },
      },
      projectTotal: { en: "Project total", ar: "إجمالي المشروع" },

      // THE UNPRICED MARKER. A delivered trip with no rate contributes 0 to
      // revenue, so the money beside it is short by an unknown amount whenever
      // one exists — the same reasoning the cost statement's uncosted count
      // uses. English writes "trip(s)" and never inflects, so all four buckets
      // carry the same string; that is the EN invariant working, not a copy.
      unpricedTitle: {
        one: {
          en: "{n} delivered trip(s) with no rate — contributing 0 revenue",
          ar: "رحلة واحدة بدون سعر — لا تضيف إيرادًا",
        },
        two: {
          en: "{n} delivered trip(s) with no rate — contributing 0 revenue",
          ar: "رحلتان بدون سعر — لا تضيفان إيرادًا",
        },
        few: {
          en: "{n} delivered trip(s) with no rate — contributing 0 revenue",
          ar: "{n} رحلات بدون سعر — لا تضيف إيرادًا",
        },
        many: {
          en: "{n} delivered trip(s) with no rate — contributing 0 revenue",
          ar: "{n} رحلة بدون سعر — لا تضيف إيرادًا",
        },
      },
      // NO count buckets, and that is not an oversight: the chip names no noun
      // to inflect in either language — "unpriced" / "بدون سعر" reads the same
      // beside 1 as beside 40.
      unpricedChip: { en: "{n} unpriced", ar: "{n} بدون سعر" },

      // --- the manual side-log (deferred_deliveries, 0166) ---
      // Hand-typed figures carrying none of the provenance the money model
      // depends on. They appear HERE and nowhere else, and are totalled
      // separately — 0166's own self-assert fails if any view reads that table.
      deferredTitle: { en: "Deferred location", ar: "توصيلات خارج المشاريع" },
      deferredNote: {
        en: "Manual log — diesel transport, ad-hoc customer filling. Appears in this report only; never counted into P&L, revenue or commission.",
        ar: "سجل يدوي — نقل ديزل، تعبئة عملاء متفرقة. يظهر في هذا التقرير فقط ولا يدخل في الأرباح أو العمولات.",
      },
      // "Add entry" OPENS the form; the form's own submit button says just
      // "Add" (common.add). Two controls, two English strings, so the opener
      // keeps a leaf of its own even though the Arabic coincides.
      addEntry: { en: "Add entry", ar: "إضافة" },
      // "Choose…", not common.selectPlaceholder's "Select…" — same Arabic,
      // different English, and byte-identity is per key.
      choose: { en: "Choose…", ar: "اختر…" },
      description: { en: "Description", ar: "الوصف" },
      // An EXAMPLE of what to type, not one of a fixed list — the same shape as
      // the expenses modal's category placeholder.
      descriptionPlaceholder: { en: "e.g. diesel transport", ar: "مثال: نقل ديزل" },
      update: { en: "Update", ar: "تحديث" },
      noManualEntries: {
        en: "No manual entries for this period.",
        ar: "لا توجد إدخالات لهذه الفترة.",
      },
      // The inline delete confirm's tick. Its cross is common.cancel, and the
      // row's two resting icons are common.edit and common.delete.
      confirmDelete: { en: "Confirm delete", ar: "تأكيد الحذف" },
      manualTotal: { en: "Manual total", ar: "الإجمالي اليدوي" },
      // SEPARATE TOTALS, NEVER COMBINED — 0166's isolation rule, said on
      // screen. The Arabic stopped at the project totals before this commit and
      // dropped the English clause about financial reports, which is the half
      // that matters most; it carries both now.
      separateNote: {
        en: "Totalled separately. These figures are never added into the project totals above, or into any financial report.",
        ar: "يُحتسب هذا الجدول بشكل منفصل، ولا تُضاف أرقامه إلى إجماليات المشاريع أعلاه ولا إلى أي تقرير مالي.",
      },
    },

    // --- the custom report builder ------------------------------------------
    // TWO consumers, split by what they say rather than by where they live:
    // `grouping` and `note` are read by lib/report-builder.ts (the engine),
    // everything after them by CustomReportModal (the chrome). Kept in one
    // namespace because the modal's own footer prints a grouping name too, and
    // a second copy of "By customer" is exactly what one namespace prevents.
    builder: {
      grouping: {
        period: { en: "By period", ar: "حسب الفترة" },
        customer: { en: "By customer", ar: "حسب العميل" },
        truck: { en: "By truck", ar: "حسب الشاحنة" },
      },

      // The honest notes printed under a generated report.
      note: {
        // Keyed by GRAIN rather than token-filled: English drops the enum value
        // in ("Every month is listed"), Arabic needs a different plural noun for
        // each grain, so the sentence is stored whole three times.
        everyPeriod: {
          month: {
            en: "Every month is listed, newest first — the period picker does not filter a by-period report.",
            ar: "تُدرج كل الأشهر، الأحدث أولًا — منتقي الفترة لا يصفّي تقريرًا حسب الفترة.",
          },
          quarter: {
            en: "Every quarter is listed, newest first — the period picker does not filter a by-period report.",
            ar: "تُدرج كل الأرباع، الأحدث أولًا — منتقي الفترة لا يصفّي تقريرًا حسب الفترة.",
          },
          year: {
            en: "Every year is listed, newest first — the period picker does not filter a by-period report.",
            ar: "تُدرج كل السنوات، الأحدث أولًا — منتقي الفترة لا يصفّي تقريرًا حسب الفترة.",
          },
        },
        // `{p}` is the VIEW's own period label — "Aug 2026". Latin on purpose.
        rowsCover: { en: "Rows cover {p} only.", ar: "تغطي الصفوف {p} فقط." },
        noPeriod: { en: "No period selected.", ar: "لم تُحدَّد فترة." },
        outstandingPeriodOnly: {
          en: "Outstanding is measured on this period's own invoices, not the all-time receivables position.",
          ar: "يُقاس المستحق على فواتير هذه الفترة وحدها، لا على مركز الذمم المدينة الكلي.",
        },
        outstandingPrepaid: {
          en: "Outstanding reflects the customer's current prepaid balance, capped at each invoice's own amount due — it can never exceed the document.",
          ar: "يعكس المستحق رصيد العميل المدفوع مقدمًا كما هو الآن، محدودًا بالمبلغ المستحق على كل فاتورة — فلا يتجاوز المستند أبدًا.",
        },
        allocation: {
          en: "Revenue per truck is an allocation: each invoice's revenue is split equally across its trips.",
          ar: "الإيراد لكل شاحنة توزيع: تُقسَّم إيرادات كل فاتورة بالتساوي على رحلاتها.",
        },
        mixedBases: {
          en: "Columns use different bases (accrual, cash, operational). They are shown side by side and are never added together — each column stands on its own.",
          ar: "تستخدم الأعمدة أُسسًا مختلفة (الاستحقاق، النقدي، التشغيلي). تُعرض جنبًا إلى جنب ولا تُجمع أبدًا — كل عمود قائم بذاته.",
        },
        ratios: {
          en: "Ratio columns are computed from each row's own totals, never averaged from smaller periods.",
          ar: "تُحسب أعمدة النسب من إجماليات كل صف نفسه، ولا تُؤخذ كمتوسط لفترات أصغر.",
        },
      },

      // --- the modal's own chrome ------------------------------------------
      // `title` is said in THREE places — the modal heading, the button on the
      // statements tab that opens it, and the heading of the report it
      // generates — so it is one leaf, not three.
      title: { en: "Custom report", ar: "تقرير مخصص" },
      intro: {
        en: "Combine defined metrics into a table. Everything here reads the same views the rest of the page does, so it cannot disagree with them.",
        ar: "اجمع مقاييس معرَّفة في جدول واحد. كل ما هنا يقرأ العروض نفسها التي تقرأها بقية الصفحة، فلا يمكن أن يخالفها.",
      },
      // The three numbered steps. `·` is punctuation, identical in both, and
      // the DIGIT stays Latin like every other figure the app writes.
      step1: { en: "1 · Group rows by", ar: "1 · تجميع الصفوف حسب" },
      step2: { en: "2 · Columns", ar: "2 · الأعمدة" },
      step3: { en: "3 · Period", ar: "3 · الفترة" },

      // Why a disabled control is disabled — the reason a vanished control
      // could not have given.
      groupingUnavailable: {
        en: "The metrics you picked cannot be grouped this way",
        ar: "المقاييس التي اخترتها لا يمكن تجميعها بهذه الطريقة",
      },
      // `{g}` is a reports.builder.grouping.* value, lower-cased AFTER the
      // lookup at the call site — English needs "by customer" mid-sentence,
      // and Arabic has no case to change, so the same call is a no-op there.
      notAvailable: { en: "Not available {g}", ar: "غير متاح {g}" },

      // Keyed by GRAIN, not token-filled. English drops the raw enum straight
      // into the sentence ("every month as a row") — which is also the trap
      // this fixes, since that enum was rendering English in Arabic — and
      // Arabic needs a different noun per grain, so the sentence is stored
      // whole three times. Same shape as note.everyPeriod above.
      byPeriodNote: {
        month: {
          en: "A by-period report lists every month as a row, so it is not filtered to one.",
          ar: "التقرير حسب الفترة يُدرج كل شهر كصف، فلا يُصفّى إلى شهر واحد.",
        },
        quarter: {
          en: "A by-period report lists every quarter as a row, so it is not filtered to one.",
          ar: "التقرير حسب الفترة يُدرج كل ربع كصف، فلا يُصفّى إلى ربع واحد.",
        },
        year: {
          en: "A by-period report lists every year as a row, so it is not filtered to one.",
          ar: "التقرير حسب الفترة يُدرج كل سنة كصف، فلا يُصفّى إلى سنة واحدة.",
        },
      },

      // Said BEFORE generating, where note.mixedBases above is printed UNDER
      // the finished report. Two different moments and two different sentences
      // — this one warns, that one records. Not folded into one leaf.
      mixedBases: {
        en: "You have mixed bases selected. They will appear as separate columns and are never added together — accrual and cash answer different questions.",
        ar: "لديك أُسس مختلطة في التحديد. ستظهر كأعمدة منفصلة ولا تُجمع أبدًا — الاستحقاق والنقدي يجيبان عن سؤالين مختلفين.",
      },

      // The footer's running count. `{n}` is the raw column count and `{g}` a
      // lower-cased grouping name. Whole sentence per bucket, not an "s"
      // spliced onto a noun.
      columnsCount: {
        one: { en: "{n} column · {g}", ar: "عمود واحد · {g}" },
        two: { en: "{n} columns · {g}", ar: "عمودان · {g}" },
        few: { en: "{n} columns · {g}", ar: "{n} أعمدة · {g}" },
        many: { en: "{n} columns · {g}", ar: "{n} عمودًا · {g}" },
      },
      pickOne: { en: "Pick at least one column.", ar: "اختر عمودًا واحدًا على الأقل." },
      generate: { en: "Generate", ar: "إنشاء" },

      // --- the natural-language seam, deliberately not wired ----------------
      nl: {
        heading: { en: "Ask in plain language", ar: "اسأل بلغة عادية" },
        comingSoon: { en: "Coming soon", ar: "قريبًا" },
        placeholder: {
          en: "e.g. Revenue and outstanding for each customer last quarter",
          ar: "مثال: الإيرادات والمستحق لكل عميل في الربع الماضي",
        },
        disabledTitle: {
          en: "Natural-language reports are not wired up yet",
          ar: "التقارير باللغة العادية غير مفعَّلة بعد",
        },
        interpret: { en: "Interpret", ar: "تفسير" },
        notWired: {
          en: "Not wired up — nothing typed here is sent anywhere. When it is switched on, its only job will be to fill in the builder on the left. It will never write its own query, so a generated report can only ever say what the builder can already say correctly.",
          ar: "غير مفعَّل — لا يُرسل ما يُكتب هنا إلى أي جهة. وعند تفعيله ستكون مهمته الوحيدة تعبئة المُنشئ على اليسار. ولن يكتب استعلامه الخاص أبدًا، فالتقرير المُنشأ لا يقول إلا ما يستطيع المُنشئ قوله بصورة صحيحة أصلًا.",
        },
      },
    },

    // --- the generated narrative (buildNarrative in lib/reports.ts) ---------
    // Every bullet is stored as a WHOLE sentence per branch. Where English
    // splices a word into the middle of a sentence — "up"/"down"/"level", the
    // "— a 12.4% margin" clause, the "s" on trucks and work orders — the branch
    // gets its own leaf instead, because Arabic changes more than that one word.
    narrative: {
      // {p} = the view's period label.
      inProgress: {
        en: "{p} is still running. Costs accumulate daily while revenue is only recognised when an invoice is confirmed, so the figures below understate how the period will finish.",
        ar: "{p} لم تنتهِ بعد. تتراكم التكاليف يوميًا بينما لا يُعترف بالإيراد إلا عند تأكيد الفاتورة، فالأرقام أدناه أقل مما ستنتهي إليه الفترة.",
      },
      noRevenue: {
        en: "No revenue was recognised in {p} — no invoice was confirmed. Costs of {c} still landed.",
        ar: "لم يُعترف بأي إيراد في {p} — لم تُؤكَّد أي فاتورة. ومع ذلك وقعت تكاليف قدرها {c}.",
      },
      revenueUp: { en: "Revenue was {v}, up {d} on {p}.", ar: "بلغت الإيرادات {v}، بارتفاع {d} عن {p}." },
      revenueDown: { en: "Revenue was {v}, down {d} on {p}.", ar: "بلغت الإيرادات {v}، بانخفاض {d} عن {p}." },
      revenueFlat: { en: "Revenue was {v}, level {d} on {p}.", ar: "بلغت الإيرادات {v}، بثبات {d} عن {p}." },
      revenueBare: { en: "Revenue was {v}.", ar: "بلغت الإيرادات {v}." },
      revenueVsNothing: {
        en: "Revenue was {v}, against nothing in {p}.",
        ar: "بلغت الإيرادات {v}، مقابل لا شيء في {p}.",
      },
      profitWithMargin: {
        en: "Operating profit was {v} — a {m} margin, after {c} of operating cost.",
        ar: "بلغ الربح التشغيلي {v} — بهامش {m}، بعد تكاليف تشغيلية قدرها {c}.",
      },
      profitNoMargin: {
        en: "Operating profit was {v}, after {c} of operating cost.",
        ar: "بلغ الربح التشغيلي {v}، بعد تكاليف تشغيلية قدرها {c}.",
      },
      loss: {
        en: "The period ran at a loss of {l}: {c} of cost against {r} of revenue.",
        ar: "أُغلقت الفترة بخسارة قدرها {l}: تكاليف {c} مقابل إيرادات {r}.",
      },
      // {b} arrives ALREADY TRANSLATED from narrativeBucket below.
      largestCostWithShare: {
        en: "The largest cost was {b} at {v}, {s} of operating cost.",
        ar: "أكبر بند تكلفة كان {b} بمبلغ {v}، أي {s} من التكاليف التشغيلية.",
      },
      largestCost: {
        en: "The largest cost was {b} at {v}.",
        ar: "أكبر بند تكلفة كان {b} بمبلغ {v}.",
      },
      expenses: {
        en: "Manually recorded expenses of {e} bring net profit to {n}. These are tracked separately from the four operational buckets.",
        ar: "مصروفات مسجَّلة يدويًا قدرها {e} تُنزل صافي الربح إلى {n}. وتُتابَع هذه منفصلة عن بنود التشغيل الأربعة.",
      },
      collected: {
        en: "{v} of cash was collected in the period. Collections are VAT-inclusive and land when an invoice is paid, so they will not equal revenue.",
        ar: "حُصِّل {v} نقدًا خلال الفترة. المتحصّلات شاملة لضريبة القيمة المضافة وتقع عند سداد الفاتورة، فلن تساوي الإيرادات.",
      },
      noCash: {
        en: "No cash was collected against invoices in this period.",
        ar: "لم يُحصَّل أي مبلغ نقدي مقابل الفواتير في هذه الفترة.",
      },
      outstanding: {
        en: "{v} remains outstanding across all unpaid invoices. This is a position as of today, not a figure for the period.",
        ar: "لا يزال {v} مستحقًا على مجموع الفواتير غير المسددة. وهذا مركز كما هو اليوم، لا رقم يخص الفترة.",
      },
      // English says "days" at every count; Arabic does not, so the age clause
      // is bucketed. The four English values are identical on purpose.
      outstandingAged: {
        one: {
          en: "{v} remains outstanding across all unpaid invoices, the oldest {d} days since confirmation. This is a position as of today, not a figure for the period.",
          ar: "لا يزال {v} مستحقًا على مجموع الفواتير غير المسددة، وأقدمها مضى على تأكيدها يوم واحد. وهذا مركز كما هو اليوم، لا رقم يخص الفترة.",
        },
        two: {
          en: "{v} remains outstanding across all unpaid invoices, the oldest {d} days since confirmation. This is a position as of today, not a figure for the period.",
          ar: "لا يزال {v} مستحقًا على مجموع الفواتير غير المسددة، وأقدمها مضى على تأكيدها يومان. وهذا مركز كما هو اليوم، لا رقم يخص الفترة.",
        },
        few: {
          en: "{v} remains outstanding across all unpaid invoices, the oldest {d} days since confirmation. This is a position as of today, not a figure for the period.",
          ar: "لا يزال {v} مستحقًا على مجموع الفواتير غير المسددة، وأقدمها مضى على تأكيدها {d} أيام. وهذا مركز كما هو اليوم، لا رقم يخص الفترة.",
        },
        many: {
          en: "{v} remains outstanding across all unpaid invoices, the oldest {d} days since confirmation. This is a position as of today, not a figure for the period.",
          ar: "لا يزال {v} مستحقًا على مجموع الفواتير غير المسددة، وأقدمها مضى على تأكيدها {d} يومًا. وهذا مركز كما هو اليوم، لا رقم يخص الفترة.",
        },
      },
      salesReturns: {
        en: "{v} of previously confirmed invoicing was reversed as sales returns. Revenue above already excludes it — the two are never netted silently.",
        ar: "عُكس {v} من فوترة مؤكدة سابقًا كمردودات مبيعات. والإيراد أعلاه يستبعده أصلًا — ولا يُصافى الطرفان بصمت أبدًا.",
      },
      // {d} of {t} trips … {k} truck(s) … {w} work order(s).
      //
      // TWO counted nouns in one sentence, so the family is NESTED: the outer
      // bucket is the truck count, the inner the work-order count. English
      // inflects both ("truck"/"trucks", "work order"/"work orders") and Arabic
      // inflects them differently again, which is why nothing here is spliced.
      // The leading clause states the trip counts as a PREDICATE
      // (الرحلات المسلَّمة {d} من {t}) — a construction that does not inflect,
      // so the trip count does not add a third axis.
      ops: {
        one: {
          en: "{d} of {t} trips were delivered, across at most {k} truck in any single month.",
          ar: "الرحلات المسلَّمة {d} من {t}، وشاحنة واحدة على الأكثر في أي شهر واحد.",
        },
        two: {
          en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month.",
          ar: "الرحلات المسلَّمة {d} من {t}، وشاحنتان على الأكثر في أي شهر واحد.",
        },
        few: {
          en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month.",
          ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنات على الأكثر في أي شهر واحد.",
        },
        many: {
          en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month.",
          ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنة على الأكثر في أي شهر واحد.",
        },
      },
      opsWo: {
        one: {
          one: {
            en: "{d} of {t} trips were delivered, across at most {k} truck in any single month, with {w} work order raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنة واحدة على الأكثر في أي شهر واحد، مع أمر عمل واحد صادر.",
          },
          two: {
            en: "{d} of {t} trips were delivered, across at most {k} truck in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنة واحدة على الأكثر في أي شهر واحد، مع أمرَي عمل صادرين.",
          },
          few: {
            en: "{d} of {t} trips were delivered, across at most {k} truck in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنة واحدة على الأكثر في أي شهر واحد، مع {w} أوامر عمل صادرة.",
          },
          many: {
            en: "{d} of {t} trips were delivered, across at most {k} truck in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنة واحدة على الأكثر في أي شهر واحد، مع {w} أمر عمل صادرًا.",
          },
        },
        two: {
          one: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work order raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنتان على الأكثر في أي شهر واحد، مع أمر عمل واحد صادر.",
          },
          two: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنتان على الأكثر في أي شهر واحد، مع أمرَي عمل صادرين.",
          },
          few: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنتان على الأكثر في أي شهر واحد، مع {w} أوامر عمل صادرة.",
          },
          many: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، وشاحنتان على الأكثر في أي شهر واحد، مع {w} أمر عمل صادرًا.",
          },
        },
        few: {
          one: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work order raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنات على الأكثر في أي شهر واحد، مع أمر عمل واحد صادر.",
          },
          two: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنات على الأكثر في أي شهر واحد، مع أمرَي عمل صادرين.",
          },
          few: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنات على الأكثر في أي شهر واحد، مع {w} أوامر عمل صادرة.",
          },
          many: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنات على الأكثر في أي شهر واحد، مع {w} أمر عمل صادرًا.",
          },
        },
        many: {
          one: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work order raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنة على الأكثر في أي شهر واحد، مع أمر عمل واحد صادر.",
          },
          two: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنة على الأكثر في أي شهر واحد، مع أمرَي عمل صادرين.",
          },
          few: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنة على الأكثر في أي شهر واحد، مع {w} أوامر عمل صادرة.",
          },
          many: {
            en: "{d} of {t} trips were delivered, across at most {k} trucks in any single month, with {w} work orders raised.",
            ar: "الرحلات المسلَّمة {d} من {t}، و{k} شاحنة على الأكثر في أي شهر واحد، مع {w} أمر عمل صادرًا.",
          },
        },
      },
      topCustomerWithShare: {
        en: "{n} was the largest customer at {v}, {s} of revenue.",
        ar: "{n} أكبر عميل بمبلغ {v}، أي {s} من الإيرادات.",
      },
      topCustomer: {
        en: "{n} was the largest customer at {v}.",
        ar: "{n} أكبر عميل بمبلغ {v}.",
      },
      // The four buckets the "largest cost" line names. Lower-case in English
      // because they sit mid-sentence; the five-bucket CHART labels are
      // dashboard.costType.* and are capitalised.
      bucket: {
        payroll: { en: "payroll", ar: "الرواتب" },
        os: { en: "outsourced repairs", ar: "الإصلاحات الخارجية" },
        parts: { en: "parts", ar: "قطع الغيار" },
        commissions: { en: "commissions", ar: "العمولات" },
      },

      // --- the statement's own CHROME, not the generated sentences ---------
      // Everything above is buildNarrative's output — sentences the engine
      // composes from the period's figures. These four are the page furniture
      // around them, keyed here rather than in a ninth namespace because they
      // are only ever read by NarrativeStatement.
      //
      // The four STAT LABELS under the bullets are NOT here: Revenue,
      // Operating cost and Operating profit read reports.metric.*, and Margin
      // reads common.margin. They name the same figures the P&L names, and a
      // second spelling of "Operating profit" is exactly the drift the metric
      // namespace exists to stop.
      stmt: {
        // {p} = the period label, which arrives already formatted.
        title: { en: "{p} in review", ar: "{p} في مراجعة" },
        period: {
          en: "Computed from the period's own figures",
          ar: "محسوبة من أرقام الفترة نفسها",
        },
        note: {
          en: "Every sentence above is computed from this period's own figures — nothing is templated prose with numbers dropped in, and each line is a comparison you could redo by hand from the statements on this page.",
          ar: "كل جملة أعلاه محسوبة من أرقام هذه الفترة نفسها — لا يوجد نص جاهز أُقحمت فيه الأرقام، وكل سطر مقارنة يمكنك إعادتها بنفسك من القوائم في هذه الصفحة.",
        },
      },
    },

    // --- the metrics dictionary popup (MetricsGlossaryModal) ---------------
    // THE METRIC ROWS THEMSELVES ARE NOT HERE. label / meaning / formula /
    // grain / source_view / caveat / unit are COLUMNS of `report_metrics`
    // (migration 0098, extended by 0123/0124) — database content, and moving
    // them into two languages is a migration, which this batch does not run.
    // Only the popup's own chrome, the four basis names and the four basis
    // notes are keyed. The heading and the dialog's aria-label both point at
    // reports.shell.metricsDictionary — the same words as the button that
    // opens it, already keyed above.
    glossary: {
      // ONE SENTENCE, TWO LEAVES, because `report_metrics` sits in the middle
      // of it as a <code> element. The split point is the same in both
      // languages — the pointer lands at the end of the first clause in Arabic
      // too — so the splice is not silently reordering anything. The space on
      // either side of the code element is JSX, not part of these values.
      intro: {
        beforeCode: {
          en: "Every number on this page is defined once, in SQL — this is that definition, read straight from",
          ar: "كل رقم في هذه الصفحة معرَّف مرة واحدة، في SQL — وهذا هو التعريف، مقروءًا مباشرة من",
        },
        afterCode: {
          en: ". It is also the vocabulary the custom-report builder is fenced to: a metric it cannot offer is a metric that is not listed here.",
          ar: ". وهي أيضًا المفردات التي يقتصر عليها منشئ التقارير المخصصة: المقياس الذي لا يستطيع تقديمه مقياس غير مدرج هنا.",
        },
      },
      // The filtered line elides the noun in English ("3 of 30 shown."), so it
      // does not inflect and needs no buckets. Arabic states it as a predicate
      // for the same reason.
      shownOf: { en: "{n} of {m} shown.", ar: "يُعرض {n} من {m}." },
      // The unfiltered line DOES count a noun. English never inflects it — it
      // says "metrics" at every count, including one — so all four English
      // values are identical on purpose and only the Arabic varies.
      count: {
        one: { en: "{n} metrics.", ar: "مقياس واحد." },
        two: { en: "{n} metrics.", ar: "مقياسان." },
        few: { en: "{n} metrics.", ar: "{n} مقاييس." },
        many: { en: "{n} metrics.", ar: "{n} مقياسًا." },
      },
      filter: { en: "Filter metrics", ar: "تصفية المقاييس" },
      readFailed: { en: "The dictionary could not be read.", ar: "تعذّرت قراءة القاموس." },
      // Straight quotes in the Arabic against curly in the English, the same
      // pairing as shared.chrome.noMatches and inventory's confirmDelete.
      noMatch: { en: "No metric matches “{q}”.", ar: "لا يطابق أي مقياس \"{q}\"." },
      // MetricEntry's three <dt> labels. `Grain` is the data-modelling sense —
      // what one row of the source view counts — not a texture.
      formula: { en: "Formula", ar: "الصيغة" },
      grain: { en: "Grain", ar: "مستوى التفصيل" },
      sourceView: { en: "Source view", ar: "العرض المصدر" },
      // THE GROUP HEADINGS ARE THE `basis` ENUM — reports.basis.*, beside
      // `metric`, because the builder and the generated report print the same
      // four words. Only the NOTES below are glossary-only.
      // What a basis MEANS — the distinction the report builder exists to
      // protect (0100): accrual and cash measure the same riyal at two
      // different moments, so adding them double-counts.
      basisNote: {
        accrual: {
          en: "Earned or incurred in the period — whether or not the money has moved yet.",
          ar: "مُكتسَب أو مُتكبَّد خلال الفترة — سواء تحرَّك المال أم لم يتحرَّك بعد.",
        },
        cash: {
          en: "Money that actually moved in the period. Never added to an accrual figure: a commission payout's base IS the trip commission the accrual side already counted.",
          ar: "مال تحرَّك فعليًا خلال الفترة. ولا يُضاف أبدًا إلى رقم على أساس الاستحقاق: فأساس صرف العمولة هو نفسه عمولة الرحلة التي احتسبها جانب الاستحقاق أصلًا.",
        },
        state: {
          en: "A position as of now, not a total for a period. A state figure does not belong in a period column.",
          ar: "مركز كما هو الآن، لا إجمالي لفترة. ورقم المركز لا مكان له في عمود فترة.",
        },
        operational: {
          en: "Counts and activity rather than money.",
          ar: "أعداد ونشاط لا مال.",
        },
      },
    },

    // --- manual expenses (ExpensesModal) ------------------------------------
    // The ONE write surface on the route. Its heading is the same two words as
    // the metric it edits the source rows for, so it reads
    // reports.metric.otherExpenses rather than minting a second copy.
    //
    // `Date` / `Category` / `Amount` / `Entered by` are reports.th.*, `Note`,
    // `Actions`, `Cancel` and `Edit` are common.*, and `Close` is reports.close.
    // What is left here is only what this modal alone says.
    expenses: {
      intro: {
        en: "Costs the app does not otherwise track. Kept separate from the four operational buckets, never merged into them.",
        ar: "تكاليف لا يتتبعها التطبيق بطريقة أخرى. تُحفظ منفصلة عن بنود التشغيل الأربعة، ولا تُدمج فيها أبدًا.",
      },
      // The currency is spelled in the label, not formatted by the app — this
      // is a bare number input, so `formatSar` never touches what is typed.
      amountSar: { en: "Amount (SAR)", ar: "المبلغ (ر.س)" },
      noteOptional: { en: "Note (optional)", ar: "ملاحظة (اختياري)" },
      // A free-text combo, so the placeholder is an EXAMPLE of a category the
      // user might type, not one of a fixed list.
      categoryExample: { en: "e.g. Rent", ar: "مثال: إيجار" },
      saveChanges: { en: "Save changes", ar: "حفظ التعديلات" },
      addExpense: { en: "Add expense", ar: "إضافة مصروف" },
      empty: {
        en: "No expenses recorded. Until something is added here, net profit equals operating profit — which the P&L shows honestly rather than implying these costs are zero.",
        ar: "لا توجد مصروفات مسجَّلة. وإلى أن يُضاف شيء هنا، يساوي صافي الربح الربح التشغيلي — وهو ما تعرضه قائمة الأرباح والخسائر بصدق بدل الإيحاء بأن هذه التكاليف صفر.",
      },
      // The inline delete confirm. Three words, and they are this modal's
      // alone — no other file in this batch asks a yes/no question.
      confirmDelete: { en: "Delete?", ar: "حذف؟" },
      yes: { en: "Yes", ar: "نعم" },
      no: { en: "No", ar: "لا" },
      // The delete icon's tooltip is common.delete, beside common.edit on the
      // other one — the daily side-log labels the same icon the same way, and
      // two callers is what moved it out of here.
    },
  },

  // ===========================================================================
  // DRIVERS ROUTE — the four tabs (drivers / commissions / history / staff),
  // their shared sections, and the two lib strings that render inside them.
  // ===========================================================================
  // Reuse policy matches the rest of this file: `common.*` is shared freely,
  // `fleet.driverState.*` is shared because the driver-state enum is ONE enum
  // wherever it is painted, and everything else is coined here. Reports, Fleet,
  // Settings and Consumption each already keep their own "Close" for the same
  // reason — a wording change in one route must not walk into another.
  drivers: {
    close: { en: "Close", ar: "إغلاق" },
    date: { en: "Date", ar: "التاريخ" },
    noteOptional: { en: "Note (optional)", ar: "ملاحظة (اختياري)" },

    // ---- Drivers tab: page chrome, tabs, KPIs, roster ----------------------
    // The <h1> is `nav.drivers` — the sidebar item and the page heading have
    // always been the same word, so there is nothing to coin for it here.
    // `Driver`, `Status` and `Truck` (roster columns) are common.*.
    newDriver: { en: "New driver", ar: "سائق جديد" },
    addStaff: { en: "Add staff", ar: "إضافة موظف" },
    loadFailed: { en: "Failed to load:", ar: "تعذّر التحميل:" },
    none: { en: "No drivers yet.", ar: "لا يوجد سائقون بعد." },
    // ONE key for the roster column and the two forms that set the field —
    // three renderings of the same fact about a person.
    station: { en: "Station", ar: "المحطة" },

    tab: {
      drivers: { en: "Drivers", ar: "السائقون" },
      // Rendered TWICE — as the top-level tab and as the sub-tab beneath it,
      // which is why it is one key and not two.
      commissions: { en: "Commissions", ar: "العمولات" },
      // Not `staff.title` ("Management & Support Staff"): the tab is the short
      // form and the card heading inside it is the long one.
      staff: { en: "Management & Staff", ar: "الإدارة والموظفون" },
      historical: { en: "Historical", ar: "السابقة" },
    },

    kpi: {
      onDutyNow: { en: "On Duty Now", ar: "على رأس العمل الآن" },
      incidents12mo: { en: "Incidents (12mo)", ar: "الحوادث (١٢ شهراً)" },
      licenseExpYear: { en: "License Exp (this year)", ar: "رخص تنتهي (هذا العام)" },
      // Unreachable in practice — the incident list and the label map are built
      // from the same roster array — but the lookup is still a Map.get, and a
      // translated fallback is what keeps the memo honest about `lang`.
      unknownDriver: { en: "Unknown driver", ar: "سائق غير معروف" },
    },

    // The four-bar roster split. `barTitle` is one bar's tooltip; `{state}` is
    // filled with a `fleet.driverState.*` LABEL, resolved from the enum — the
    // sentence never sees a raw state value.
    onDuty: {
      title: { en: "On Duty", ar: "على رأس العمل" },
      barTitle: { en: "{state}: {n} of {total}", ar: "{state}: {n} من {total}" },
    },

    col: {
      assignedProject: { en: "Assigned Project", ar: "المشروع المُسند" },
      // Also the Trips figure on the driver detail — same count, same wording.
      trips30d: { en: "Trips 30d", ar: "رحلات ٣٠ يوماً" },
      salary: { en: "Salary", ar: "الراتب" },
      unpaidCommission: { en: "Unpaid Commission", ar: "عمولة غير مدفوعة" },
      licenseExp: { en: "License Exp", ar: "انتهاء الرخصة" },
    },

    // Health insurance (0132) is TRI-STATE and the third value is the point:
    // null means "nobody has recorded it", which is a different fact from No.
    // Three words here, rendered by both the detail cell and the form's three
    // <option>s, so the cell and the picker can never disagree.
    health: {
      label: { en: "Health insurance", ar: "التأمين الصحي" },
      yes: { en: "Yes", ar: "نعم" },
      no: { en: "No", ar: "لا" },
      notRecorded: { en: "Not recorded", ar: "غير مسجَّل" },
    },

    // TRIP_STAGE_LABELS (lib/db-types.ts), keyed off the ENUM. `dashboard.stage`
    // cannot serve: its key is `inTransit` where the enum value is `in_transit`,
    // so keying off it would need a second map from value to key — the exact
    // label-discrimination seam this conversion removes. The label map itself
    // is untouched; the trips route still renders it.
    tripStage: {
      scheduled: { en: "Scheduled", ar: "مجدولة" },
      loading: { en: "Loading", ar: "تحميل" },
      in_transit: { en: "In transit", ar: "في الطريق" },
      delivered: { en: "Delivered", ar: "مسلَّمة" },
    },

    // Add / edit driver form.
    form: {
      editTitle: { en: "Edit driver", ar: "تعديل سائق" },
      fName: { en: "Name *", ar: "الاسم *" },
      fNameAr: { en: "Name (Arabic)", ar: "الاسم بالعربية" },
      // These six are rendered by the form AND by the detail modal's Contact
      // and Employment cards — one field, one label, wherever it is shown.
      fPhone: { en: "Phone", ar: "الهاتف" },
      fIqama: { en: "Iqama ID", ar: "رقم الإقامة" },
      fIqamaExp: { en: "Iqama expiry", ar: "انتهاء الإقامة" },
      fLicense: { en: "License ID", ar: "رقم الرخصة" },
      fLicenseExp: { en: "License expiry", ar: "انتهاء الرخصة" },
      fHireDate: { en: "Hire date", ar: "تاريخ التعيين" },
      fDutyHours: { en: "Duty hours", ar: "ساعات الدوام" },
      fTruck: { en: "Current truck", ar: "الشاحنة الحالية" },
      fSalary: { en: "Salary (SAR / month)", ar: "الراتب (ريال / شهر)" },
      // The blank <option> on the TRUCK picker. Deliberately not
      // `staff.unassigned` (بلا فرع) — that one is a missing BRANCH. Two
      // different blanks, two words in Arabic, two keys.
      unassigned: { en: "Unassigned", ar: "بلا شاحنة" },
      // The occupant of a truck being taken over, when their row no longer
      // resolves to a name. Read inside an event handler, never memoised.
      anotherDriver: { en: "another driver", ar: "سائق آخر" },
      confirmReassign: {
        en: "That truck is currently assigned to {who}. Reassign it?",
        ar: "هذه الشاحنة مُسندة حالياً إلى {who}. هل تُعاد إسنادها؟",
      },
    },

    // Driver incidents. Added from the driver form, edited and deleted from the
    // detail modal — one vocabulary across both, since it is one record type.
    // The `Type` field label is common.type.
    inc: {
      title: { en: "Incidents", ar: "الحوادث" },
      add: { en: "Add incident", ar: "إضافة حادثة" },
      adding: { en: "Adding…", ar: "جارٍ الإضافة…" },
      added: { en: "Incident added.", ar: "تمت إضافة الحادثة." },
      saveFirst: {
        en: "Save this driver first to add incidents.",
        ar: "احفظ بيانات السائق أولاً لإضافة الحوادث.",
      },
      fDate: { en: "Incident date", ar: "تاريخ الحادثة" },
      phType: { en: "e.g. Work accident, Truck accident", ar: "مثال: حادث عمل، حادث شاحنة" },
      fDesc: { en: "Description (optional)", ar: "الوصف (اختياري)" },
      none: { en: "No incidents recorded.", ar: "لا توجد حوادث مسجَّلة." },
      edit: { en: "Edit incident", ar: "تعديل حادثة" },
      del: { en: "Delete incident", ar: "حذف حادثة" },
      // `{type}` is the operator's own free text — DATA, quoted verbatim.
      confirmDelete: { en: 'Delete this "{type}" incident?', ar: 'حذف حادثة "{type}" هذه؟' },
    },

    // Driver detail modal. Its salary row is drivers.salary.monthly / .openBtn
    // / .openTitle, shared with the staff detail.
    detail: {
      title: { en: "Driver Details — {name}", ar: "بيانات السائق — {name}" },
      contactId: { en: "Contact & ID", ar: "الاتصال والهوية" },
      employment: { en: "Employment", ar: "التوظيف" },
      assignment: { en: "Current Assignment", ar: "الإسناد الحالي" },
      unassign: { en: "Unassign", ar: "إلغاء الإسناد" },
      unassigning: { en: "Unassigning…", ar: "جارٍ إلغاء الإسناد…" },
      noTruck: { en: "No truck assigned", ar: "لا توجد شاحنة مُسندة" },
      recentTrips: { en: "Recent Trips", ar: "الرحلات الأخيرة" },
      noRecentTrips: { en: "No recent trips", ar: "لا توجد رحلات أخيرة" },
      // Posture 2: leave never unassigns. This is a NOTICE about a conflict the
      // parent computed, not an action — the wording must not imply the app
      // will move the truck.
      leaveTruckWarning: {
        en: "On leave today but still assigned to {plate}. Reassign the truck if someone else needs to drive it.",
        ar: "في إجازة اليوم لكنه ما زال مُسنداً إلى {plate}. أعد إسناد الشاحنة إن احتاجها سائق آخر.",
      },
    },

    // Danger zone — soft-delete termination. Mirrors `fleet.term.*`, which does
    // the same job for a truck; the two stay separate because Arabic agrees the
    // verb with the thing being retired (a سائق, not a شاحنة).
    term: {
      dangerZone: { en: "Danger zone", ar: "منطقة الخطر" },
      // Rendered three times: the row title, its button, and the confirm
      // button at the end of the flow.
      terminateDriver: { en: "Terminate driver", ar: "إنهاء خدمة السائق" },
      removes: {
        en: "Removes {name} from all active views. History and balance are preserved.",
        ar: "يزيل {name} من جميع الشاشات النشطة. يُحفظ السجل والرصيد.",
      },
      // Two fragments around an inline <b>{name}</b>, same shape as
      // fleet.term.confirmLead / confirmTail.
      confirmBefore: { en: "This will terminate", ar: "سيؤدي هذا إلى إنهاء خدمة" },
      confirmAfter: {
        en: "and remove them from all active views. Their history and any unsettled commission balance are preserved. This can be restored later from the Archive page.",
        ar: "وإزالته من جميع الشاشات النشطة. يُحفظ سجله وأي رصيد عمولة غير مُسوّى، ويمكن استعادته لاحقاً من صفحة الأرشيف.",
      },
      fDate: { en: "Termination date *", ar: "تاريخ إنهاء الخدمة *" },
      // `{name}` is `drivers.name`, the STORED value — the gate compares the
      // typed text against that column, so the quoted string has to be the
      // English name in Arabic too. Never arText() here, or the instruction
      // would ask for a string the gate will not accept.
      typeToConfirm: { en: 'Type "{name}" to confirm', ar: 'اكتب "{name}" للتأكيد' },
      terminating: { en: "Terminating…", ar: "جارٍ إنهاء الخدمة…" },
    },

    // Month abbreviations for lib/commission-rows.ts monthLabel(). `fleet.months.*`
    // cannot serve: it carries FULL English names ("January"), and this renders
    // as "Aug 2026" inside a heading. The Arabic matches fleet's because Arabic
    // has no abbreviated month forms to differ in.
    // Keys are QUOTED, same as fleet.months — a bare numeric key becomes a number
    // in the object type and LeafPaths drops it, so `drivers.months.8` would not
    // typecheck as a TKey.
    months: {
      "1": { en: "Jan", ar: "يناير" },
      "2": { en: "Feb", ar: "فبراير" },
      "3": { en: "Mar", ar: "مارس" },
      "4": { en: "Apr", ar: "أبريل" },
      "5": { en: "May", ar: "مايو" },
      "6": { en: "Jun", ar: "يونيو" },
      "7": { en: "Jul", ar: "يوليو" },
      "8": { en: "Aug", ar: "أغسطس" },
      "9": { en: "Sep", ar: "سبتمبر" },
      "10": { en: "Oct", ar: "أكتوبر" },
      "11": { en: "Nov", ar: "نوفمبر" },
      "12": { en: "Dec", ar: "ديسمبر" },
    },

    // The inline "+ Add custom …" lookup (LookupSelect), shared by the leave-type
    // and the mechanic-commission-type pickers.
    lookup: {
      addCustomType: { en: "+ Add custom type…", ar: "+ إضافة نوع مخصّص…" },
      // The generic fallbacks. Both current callers pass their own wording, so
      // these only render for a caller that has not named its thing yet — which
      // is exactly when a translated default is worth having.
      addCustom: { en: "+ Add custom…", ar: "+ إضافة مخصّصة…" },
      newName: { en: "New name", ar: "اسم جديد" },
      savedAs: { en: "Will be saved as:", ar: "سيُحفظ باسم:" },
      // Rendered twice — as the inline preview's error and as the submit guard's.
      // One string, so the two can never drift apart.
      mustStartWithLetter: { en: "Label must start with a letter.", ar: "يجب أن يبدأ الاسم بحرف." },
      nameRequired: { en: "Name is required.", ar: "الاسم مطلوب." },
      couldNotAdd: { en: "Could not add.", ar: "تعذّرت الإضافة." },
      // 0168 — placeholder for the OPTIONAL Arabic name on the add-custom form
      // (staff roles, leave types). "(optional)" is carried in the placeholder
      // itself because the inline add row has no field labels to hang it on;
      // the English name beside it stays required and unmarked. Shown in both
      // UI languages, so the English copy is not a dead string.
      phArName: { en: "Arabic name (optional)", ar: "الاسم بالعربية (اختياري)" },
    },

    // PersonIdLink — the Iqama/licence number that deep-links into the Archive.
    idLinkTitle: {
      en: "Open this person's documents in the Archive",
      ar: "افتح مستندات هذا الشخص في الأرشيف",
    },

    // Leave & absence (LeaveSection), rendered on BOTH the driver and the staff
    // detail modal.
    leave: {
      title: { en: "Leave & absence", ar: "الإجازات والغياب" },
      onLeaveToday: { en: "On leave today", ar: "في إجازة اليوم" },
      available: { en: "Available", ar: "متاح" },
      now: { en: "now", ar: "حالياً" },
      add: { en: "Add leave", ar: "إضافة إجازة" },
      none: { en: "No leave recorded.", ar: "لا توجد إجازات مسجَّلة." },
      edit: { en: "Edit leave", ar: "تعديل إجازة" },
      del: { en: "Delete leave", ar: "حذف إجازة" },
      editPeriod: { en: "Edit leave period", ar: "تعديل فترة إجازة" },
      record: { en: "Record leave", ar: "تسجيل إجازة" },
      fType: { en: "Leave type", ar: "نوع الإجازة" },
      fStart: { en: "Start date", ar: "تاريخ البداية" },
      fEnd: { en: "End date", ar: "تاريخ الانتهاء" },
      phNote: { en: "e.g. annual leave, medical", ar: "مثال: إجازة سنوية، مرضية" },
      newType: { en: "New leave type", ar: "نوع إجازة جديد" },
      confirmDelete: { en: "Delete this {type} period?", ar: "حذف فترة {type} هذه؟" },
      errDates: { en: "Pick start and end dates.", ar: "اختر تاريخي البداية والانتهاء." },
      errOrder: {
        en: "End date must be on or after the start date.",
        ar: "يجب ألا يسبق تاريخ الانتهاء تاريخ البداية.",
      },
    },

    // Mechanic commissions — a standalone per-mechanic list, deliberately
    // unrelated to the driver trip-commission system the Commissions tab runs.
    mech: {
      title: { en: "Commissions", ar: "العمولات" },
      add: { en: "Add commission", ar: "إضافة عمولة" },
      edit: { en: "Edit commission", ar: "تعديل عمولة" },
      del: { en: "Delete commission", ar: "حذف عمولة" },
      none: { en: "No commissions recorded.", ar: "لا توجد عمولات مسجَّلة." },
      fType: { en: "Commission type", ar: "نوع العمولة" },
      fAmount: { en: "Amount (SAR)", ar: "المبلغ (ر.س)" },
      thAmount: { en: "Amount", ar: "المبلغ" },
      phNote: { en: "e.g. reason or context", ar: "مثال: السبب أو السياق" },
      newType: { en: "New commission type", ar: "نوع عمولة جديد" },
      confirmDelete: { en: "Delete this {type} commission?", ar: "حذف عمولة {type} هذه؟" },
      errAmount: { en: "Enter an amount greater than 0.", ar: "أدخل مبلغاً أكبر من 0." },
      errDate: { en: "Pick a date.", ar: "اختر تاريخاً." },
    },

    // Salary history — the effective-dated timeline every payroll figure resolves
    // through, and the back-dating warning that has to be read before a save.
    salary: {
      title: { en: "Salary history", ar: "سجل الرواتب" },
      // Four fragments: the sentence carries an inline amount and an inline <em>.
      // Same shape as reports.vat.note4Before / note4Strong.
      introBefore: {
        en: "Every payroll figure resolves through this timeline: a month is costed at the salary in effect on the last day of that month. The current salary",
        ar: "كل رقم في كشوف الرواتب يُحسم عبر هذا المسار الزمني: يُكلَّف الشهر بالراتب الساري في آخر يوم منه. الراتب الحالي",
      },
      introMid: {
        en: "is edited on the person's own form; this screen records",
        ar: "يُعدَّل من نموذج الشخص نفسه؛ وهذه الشاشة تسجّل",
      },
      introWhen: { en: "when", ar: "متى" },
      introAfter: { en: "each figure applied.", ar: "طُبِّق كل رقم." },
      thEffective: { en: "Effective from", ar: "ساري من" },
      thSalary: { en: "Salary", ar: "الراتب" },
      none: { en: "No salary recorded for this person.", ar: "لا يوجد راتب مسجَّل لهذا الشخص." },
      baseline: {
        en: "Opening salary — earlier months are costed at this",
        ar: "الراتب الافتتاحي — تُكلَّف الأشهر السابقة به",
      },
      removeChange: { en: "Remove this change", ar: "إزالة هذا التغيير" },
      recordChange: { en: "Record a salary change", ar: "تسجيل تغيير راتب" },
      fMonthly: { en: "Monthly salary *", ar: "الراتب الشهري *" },
      fEffective: { en: "Effective from *", ar: "ساري من *" },
      phOptional: { en: "Optional", ar: "اختياري" },
      saveChange: { en: "Save change", ar: "حفظ التغيير" },
      errSalary: { en: "Salary must be zero or greater.", ar: "يجب ألا يقل الراتب عن صفر." },
      confirmRemove: {
        en: "Remove this salary change? Months from its date forward will be re-costed.",
        ar: "إزالة تغيير الراتب هذا؟ ستُعاد تكلفة الأشهر من تاريخه فصاعداً.",
      },
      backdatedStrong: { en: "This is back-dated.", ar: "هذا بأثر رجعي." },
      backdatedBefore: {
        en: "Payroll and profit will be recalculated for",
        ar: "ستُعاد حسبة الرواتب والأرباح لشهر",
      },
      backdatedAfter: {
        en: "and every month after it — including months that have already been reported. That is correct if this salary really did apply from then; it will change figures someone may have already seen.",
        ar: "وكل شهر بعده — بما في ذلك أشهر صدرت تقاريرها. وهذا صحيح إن كان هذا الراتب سارياً فعلاً من ذلك التاريخ؛ لكنه سيغيّر أرقاماً ربما اطّلع عليها أحد.",
      },
      forwardBefore: { en: "Applies from", ar: "يسري من" },
      forwardAfter: {
        en: "onward. Earlier months keep the salary recorded for them and will not change.",
        ar: "فصاعداً. تحتفظ الأشهر السابقة بالراتب المسجَّل لها ولن تتغيّر.",
      },
      payslipsNote: {
        en: "Issued payslips are never affected — each one keeps the figures frozen onto it when it was issued.",
        ar: "قسائم الرواتب الصادرة لا تتأثر أبداً — تحتفظ كل قسيمة بالأرقام المجمَّدة عليها وقت إصدارها.",
      },
      // The Cell label and the button that OPENS this modal, on the driver
      // detail and the staff detail alike. They live here, beside the modal
      // they describe, rather than once per detail panel — two panels opening
      // one screen must not label it two ways.
      monthly: { en: "Salary (monthly)", ar: "الراتب (شهري)" },
      openTitle: { en: "View salary history / record a dated change", ar: "عرض سجل الراتب / تسجيل تغيير بتاريخ" },
      openBtn: { en: "History", ar: "السجل" },
    },

    // COUNT SENTENCES — one WHOLE sentence per bucket, never spliced from
    // fragments. Arabic inflects the counted noun with the number, so there is no
    // stable "{n} + word" seam to build one out of. The English `two`/`few`/`many`
    // are identical by construction: that is what keeps the rendered English
    // byte-identical while Arabic gets its four real forms. `plural()` picks the
    // bucket on %100 and folds zero into `few`.
    count: {
      leaveDays: {
        one: { en: "{n} day this year", ar: "يوم واحد هذا العام" },
        two: { en: "{n} days this year", ar: "يومان هذا العام" },
        few: { en: "{n} days this year", ar: "{n} أيام هذا العام" },
        many: { en: "{n} days this year", ar: "{n} يوماً هذا العام" },
      },
      // Roster headcounts, rendered on the page subtitle and again as the On
      // Duty bar's own total. The English source had NO singular form at either
      // site — it printed "drivers" unconditionally — so `one` keeps "{n}
      // drivers" verbatim. Fixing that here would change rendered English,
      // which this conversion does not do; it is a separate call to make.
      drivers: {
        one: { en: "{n} drivers", ar: "سائق واحد" },
        two: { en: "{n} drivers", ar: "سائقان" },
        few: { en: "{n} drivers", ar: "{n} سائقين" },
        many: { en: "{n} drivers", ar: "{n} سائقاً" },
      },
      // "support staff" is invariant in English — it is already a mass noun —
      // so the four `en` values agree by nature rather than by construction.
      supportStaff: {
        one: { en: "{n} support staff", ar: "موظف مساند واحد" },
        two: { en: "{n} support staff", ar: "موظفان مساندان" },
        few: { en: "{n} support staff", ar: "{n} موظفين مساندين" },
        many: { en: "{n} support staff", ar: "{n} موظفاً مسانداً" },
      },
      incidents: {
        one: { en: "{n} incident", ar: "حادثة واحدة" },
        two: { en: "{n} incidents", ar: "حادثتان" },
        few: { en: "{n} incidents", ar: "{n} حوادث" },
        many: { en: "{n} incidents", ar: "{n} حادثة" },
      },
      // The commission base cell reads "(3 trips · 2 projects)" — TWO counts,
      // but two INDEPENDENT phrases either side of a separator, so they are two
      // whole sentences and not a 4×4 cross product. Same shape as the page
      // subtitle. English had no singular at this site (it printed "trips"
      // unconditionally), so `one` keeps it verbatim.
      trips: {
        one: { en: "{n} trips", ar: "رحلة واحدة" },
        two: { en: "{n} trips", ar: "رحلتان" },
        few: { en: "{n} trips", ar: "{n} رحلات" },
        many: { en: "{n} trips", ar: "{n} رحلة" },
      },
      projects: {
        one: { en: "{n} projects", ar: "مشروع واحد" },
        two: { en: "{n} projects", ar: "مشروعان" },
        few: { en: "{n} projects", ar: "{n} مشاريع" },
        many: { en: "{n} projects", ar: "{n} مشروعاً" },
      },
      // A base line's own trip count, which DID carry an English singular.
      deliveredTrips: {
        one: { en: "{n} delivered trip", ar: "رحلة مسلَّمة واحدة" },
        two: { en: "{n} delivered trips", ar: "رحلتان مسلَّمتان" },
        few: { en: "{n} delivered trips", ar: "{n} رحلات مسلَّمة" },
        many: { en: "{n} delivered trips", ar: "{n} رحلة مسلَّمة" },
      },
      // The tail of a truncated KPI name list: "Ali, Fahad, Omar +2 more".
      // The counted noun is ELIDED in both languages ("+2 more [names]"), which
      // is why Arabic inflects a bare adjective here and not a noun.
      more: {
        one: { en: "+{n} more", ar: "+{n} آخر" },
        two: { en: "+{n} more", ar: "+{n} آخران" },
        few: { en: "+{n} more", ar: "+{n} آخرين" },
        many: { en: "+{n} more", ar: "+{n} آخر" },
      },
      // `{months}` is NOT filled by `fill()` — it is the seam the renderer splits
      // on to drop an <em>All months</em> in place, the same inline-token device
      // PartsUsageTab uses for `{cur}`. Keep it in every bucket.
      unmonthedHidden: {
        one: {
          en: "{n} earlier payout settled every unpaid month at once and record no single month — hidden while a month is picked. Choose {months} to see it.",
          ar: "دفعة سابقة واحدة سوَّت كل الأشهر غير المدفوعة دفعةً واحدة ولا تسجّل شهراً بعينه — وهي مخفية ما دام هناك شهر محدَّد. اختر {months} لعرضها.",
        },
        two: {
          en: "{n} earlier payouts settled every unpaid month at once and record no single month — hidden while a month is picked. Choose {months} to see them.",
          ar: "دفعتان سابقتان سوَّتا كل الأشهر غير المدفوعة دفعةً واحدة ولا تسجّلان شهراً بعينه — وهما مخفيتان ما دام هناك شهر محدَّد. اختر {months} لعرضهما.",
        },
        few: {
          en: "{n} earlier payouts settled every unpaid month at once and record no single month — hidden while a month is picked. Choose {months} to see them.",
          ar: "{n} دفعات سابقة سوَّت كل الأشهر غير المدفوعة دفعةً واحدة ولا تسجّل شهراً بعينه — وهي مخفية ما دام هناك شهر محدَّد. اختر {months} لعرضها.",
        },
        many: {
          en: "{n} earlier payouts settled every unpaid month at once and record no single month — hidden while a month is picked. Choose {months} to see them.",
          ar: "{n} دفعةً سابقة سوَّت كل الأشهر غير المدفوعة دفعةً واحدة ولا تسجّل شهراً بعينه — وهي مخفية ما دام هناك شهر محدَّد. اختر {months} لعرضها.",
        },
      },
    },

    // Commission vocabulary SHARED by the Commissions tab and the History tab.
    // These five totals are the same five columns on both screens and in the
    // frozen payout snapshot — one wording, or the two screens drift apart.
    comm: {
      base: { en: "Base", ar: "الأساس" },
      specials: { en: "Specials", ar: "الاستثنائية" },
      adjustments: { en: "Adjustments", ar: "التسويات" },
      bonus: { en: "Bonus", ar: "المكافأة" },
      total: { en: "Total", ar: "الإجمالي" },
      amount: { en: "Amount", ar: "المبلغ" },
      trips: { en: "Trips", ar: "الرحلات" },
      project: { en: "Project", ar: "المشروع" },
      denied: { en: "Denied", ar: "مرفوضة" },
      approved: { en: "Approved", ar: "معتمدة" },
      // Rendered when a base line carries NO project id. The frozen snapshot
      // still stores the English words (it is jsonb written at pay time and must
      // never be rewritten); the switch is on `projectId == null`, a VALUE.
      adhoc: { en: "Ad-hoc · no project", ar: "بدون مشروع" },
      // `kind` on a snapshot item. Keyed off the stored enum, never off a label.
      kind: {
        special: { en: "special", ar: "استثنائية" },
        adjustment: { en: "adjustment", ar: "تسوية" },
        bonus: { en: "bonus", ar: "مكافأة" },
      },
      // The three-state review enum (`ReviewStatus`), on the pill beside every
      // special / adjustment / bonus and on the payout itself. Indexed by the
      // stored value, which is what replaced CommissionsTab's STATUS_LABEL map.
      // `.approved` / `.denied` above are the History tab's DENIED-or-not pair
      // and read a boolean, not this enum — same words, different question.
      status: {
        approved: { en: "Approved", ar: "معتمدة" },
        pending: { en: "Pending", ar: "معلَّقة" },
        denied: { en: "Denied", ar: "مرفوضة" },
      },
    },

    // Commissions tab — the WORKING screen (`hist` below is its read-only twin).
    // EVERY sentence here is scoped to the month lens, so `{month}` is always a
    // monthLabel() output — itself translated — and a sentence carrying one is
    // stored WHOLE with the month as a placeholder rather than split around it.
    commTab: {
      month: { en: "Month", ar: "الشهر" },
      exportCsv: { en: "Export CSV", ar: "تصدير CSV" },
      title: { en: "Driver Commissions", ar: "عمولات السائقين" },
      unpaidBalance: { en: "Unpaid balance", ar: "الرصيد غير المدفوع" },
      statPool: { en: "Current Pool", ar: "المجمَّع الحالي" },
      statApproved: { en: "Approved (awaiting pay)", ar: "معتمدة (بانتظار الصرف)" },
      statPending: { en: "Pending Review", ar: "قيد المراجعة" },
      statAvg: { en: "Avg per Driver", ar: "المتوسط لكل سائق" },
      thBase: { en: "Base (Projects × Trips)", ar: "الأساس (المشاريع × الرحلات)" },
      specialsBonuses: { en: "Specials / Bonuses", ar: "الاستثنائية / المكافآت" },
      thPayout: { en: "Payout", ar: "الصرف" },
      breakdown: { en: "Breakdown", ar: "التفصيل" },
      noneInMonth: { en: "No commission activity in {month}.", ar: "لا يوجد نشاط عمولات في {month}." },
      rules: {
        en: "Rules: commission accrues per delivered trip based on the project's rate (auto-derived — not editable here), and lands in the month the trip ran. Specials, the bonus & adjustments are added on top of the month they are filed under. Review each line in the Breakdown — pending & approved count, denied is excluded. Approve the payout, then Pay to freeze a History record and settle {month}. Every other month is untouched and stays payable on its own.",
        ar: "القواعد: تُحتسب العمولة عن كل رحلة مسلَّمة وفق سعر المشروع (يُشتق تلقائياً — وغير قابل للتعديل هنا)، وتُقيَّد في الشهر الذي جرت فيه الرحلة. أما البنود الاستثنائية والمكافأة والتسويات فتُضاف فوق الشهر المقيَّدة تحته. راجع كل بند في التفصيل — المعلَّقة والمعتمدة تُحتسبان والمرفوضة تُستبعد. اعتمد الصرف، ثم ادفع لتجميد سجل في السجلّ وتسوية {month}. تبقى كل الأشهر الأخرى كما هي وقابلة للصرف كلٌّ على حدة.",
      },
      approve: { en: "Approve", ar: "اعتماد" },
      deny: { en: "Deny", ar: "رفض" },
      restore: { en: "Restore", ar: "استعادة" },
      breakdownTitle: { en: "Commission Breakdown — {name}", ar: "تفصيل العمولة — {name}" },
      // Four fragments because the English carries TWO inline <strong> runs.
      // Splitting around MARKUP is not the counted-noun trap: no word here
      // inflects, and the pieces are whole clauses, not a noun and its number.
      reviewPre: { en: "Everything below is", ar: "كل ما يلي يخص" },
      reviewMid: {
        en: "only. Review each line (Approve / Deny / Restore), then",
        ar: "وحده. راجع كل بند (اعتماد / رفض / استعادة)، ثم",
      },
      approvePayout: { en: "Approve payout", ar: "اعتماد الصرف" },
      reviewPost: {
        en: ". Pending and approved both count toward the total; denied is excluded.",
        ar: ". المعلَّقة والمعتمدة تُحتسبان في الإجمالي، والمرفوضة تُستبعد.",
      },
      // Two WHOLE sentences chosen on `cycle.approved_by` — a DATA presence
      // check — rather than one sentence with a " by {who}" tail spliced on.
      approvedByWho: { en: "{month} approved by {who} — ready to pay.", ar: "اعتمد {who} شهر {month} — جاهز للصرف." },
      approvedNoWho: { en: "{month} approved — ready to pay.", ar: "{month} معتمد — جاهز للصرف." },
      pay: { en: "Pay", ar: "دفع" },
      payFreezes: {
        en: "freezes a History record and settles {month}; every other month stays payable on its own. Reopen to edit again.",
        ar: "يُجمِّد سجلاً في السجلّ ويُسوّي {month}، وتبقى كل الأشهر الأخرى قابلة للصرف كلٌّ على حدة. أعد الفتح للتعديل من جديد.",
      },
      baseProjects: { en: "Base (projects)", ar: "الأساس (المشاريع)" },
      extrasSum: { en: "Specials + Adjustments + Bonus", ar: "الاستثنائية + التسويات + المكافأة" },
      currentTotal: { en: "Current Total", ar: "الإجمالي الحالي" },
      basePayHeading: { en: "Projects & Base Pay", ar: "المشاريع والأجر الأساسي" },
      noBaseLines: {
        en: "No unpaid delivered trips for this driver in {month}.",
        ar: "لا توجد رحلات مسلَّمة غير مدفوعة لهذا السائق في {month}.",
      },
      basePayNote: {
        en: "Base pay is auto-derived from each delivered trip's stamped commission. Edit specials, the bonus, or adjustments from the row buttons.",
        ar: "يُشتق الأجر الأساسي تلقائياً من العمولة المختومة على كل رحلة مسلَّمة. عدّل البنود الاستثنائية أو المكافأة أو التسويات من أزرار الصف.",
      },
      noSpecials: { en: "No specials.", ar: "لا توجد بنود استثنائية." },
      specialTrip: { en: "Special trip", ar: "رحلة استثنائية" },
      reason: { en: "Reason: {reason}", ar: "السبب: {reason}" },
      managerBonus: { en: "Manager Bonus", ar: "مكافأة المدير" },
      noBonus: { en: "No bonus set.", ar: "لم تُحدَّد مكافأة." },
      discretionaryFor: { en: "Discretionary bonus for {month}.", ar: "مكافأة تقديرية عن {month}." },
      noAdjustments: { en: "No adjustments.", ar: "لا توجد تسويات." },
      approveMonthPayout: { en: "Approve {month} payout", ar: "اعتماد صرف {month}" },
      reopen: { en: "Reopen", ar: "إعادة فتح" },
      confirmPay: {
        en: "Pay {name} {amount} for {month}? This freezes a History record and settles that month. Other months are untouched.",
        ar: "دفع {amount} إلى {name} عن {month}؟ سيُجمَّد بذلك سجل في السجلّ ويُسوَّى ذلك الشهر. لن تتأثر بقية الأشهر.",
      },
      payBtn: { en: "Pay {amount} · {month}", ar: "دفع {amount} · {month}" },
      denyKind: { en: "Deny {kind}", ar: "رفض {kind}" },
      denyPrompt: {
        en: 'Deny "{label}" ({amount}). It stays visible but is excluded from the total until restored.',
        ar: 'رفض "{label}" ({amount}). سيبقى ظاهراً لكنه يُستبعد من الإجمالي حتى يُستعاد.',
      },
      specialsTitle: { en: "Specials & Bonuses — {name}", ar: "البنود الاستثنائية والمكافآت — {name}" },
      addSpecial: { en: "Add special", ar: "إضافة بند استثنائي" },
      editSpecial: { en: "Edit special", ar: "تعديل بند استثنائي" },
      updateSpecial: { en: "Update special", ar: "تحديث البند" },
      fLabel: { en: "Label", ar: "الوصف" },
      fAmount: { en: "Amount (SAR)", ar: "المبلغ (ريال)" },
      phSpecialLabel: { en: "e.g. Emergency desert run", ar: "مثال: رحلة صحراوية طارئة" },
      countsAsSpecialTrip: { en: "Counts as a special trip", ar: "تُحتسب رحلةً استثنائية" },
      cancelEdit: { en: "Cancel edit", ar: "إلغاء التعديل" },
      noSpecialsOrBonus: {
        en: "No specials or bonus for {month} yet.",
        ar: "لا توجد بنود استثنائية أو مكافأة عن {month} بعد.",
      },
      confirmDeleteSpecial: { en: "Delete this special permanently?", ar: "حذف هذا البند الاستثنائي نهائياً؟" },
      discretionaryCurrent: {
        en: "Discretionary bonus for {month} (current: {amount}).",
        ar: "مكافأة تقديرية عن {month} (الحالية: {amount}).",
      },
      discretionaryPick: {
        en: "Discretionary bonus — pick the month it is filed against.",
        ar: "مكافأة تقديرية — اختر الشهر المقيَّدة تحته.",
      },
      bonusMonth: { en: "Bonus month", ar: "شهر المكافأة" },
      selectMonth: { en: "Select month…", ar: "اختر الشهر…" },
      set: { en: "Set", ar: "تعيين" },
      confirmRemoveBonus: { en: "Remove the {month} manager bonus?", ar: "إزالة مكافأة المدير عن {month}؟" },
      removeBonus: { en: "Remove bonus", ar: "إزالة المكافأة" },
      noMonthSelected: {
        en: "No month selected — a bonus cannot be saved until you pick the month it belongs to.",
        ar: "لم يُختر شهر — لا يمكن حفظ المكافأة حتى تختار الشهر الذي تنتمي إليه.",
      },
      // `{bonusMonth}` appears TWICE; fill() replaces every occurrence, so the
      // sentence stays one string instead of being cut at the repeat.
      filingAgainst: {
        en: "Filing against {bonusMonth}, not {lensMonth} — this amount will not appear in the view you are in. Switch the tab's month lens to {bonusMonth} to review and pay it.",
        ar: "التقييد تحت {bonusMonth} لا {lensMonth} — لن يظهر هذا المبلغ في الشاشة التي أنت فيها. حوِّل عدسة الشهر في التبويب إلى {bonusMonth} لمراجعته وصرفه.",
      },
      adjustmentsTitle: { en: "Adjustments — {name}", ar: "التسويات — {name}" },
      addAdjustment: { en: "Add adjustment", ar: "إضافة تسوية" },
      editAdjustment: { en: "Edit adjustment", ar: "تعديل تسوية" },
      updateAdjustment: { en: "Update adjustment", ar: "تحديث التسوية" },
      adjustmentNote: {
        en: "Positive adds, negative deducts (e.g. uniform deduction). No limit.",
        ar: "الموجب يُضيف والسالب يخصم (مثل خصم الزي). بلا حد.",
      },
      phAdjustmentLabel: { en: "e.g. Uniform deduction", ar: "مثال: خصم الزي" },
      noAdjustmentsForMonth: { en: "No adjustments for {month} yet.", ar: "لا توجد تسويات عن {month} بعد." },
      confirmDeleteAdjustment: { en: "Delete this adjustment permanently?", ar: "حذف هذه التسوية نهائياً؟" },
      errReason: { en: "Enter a reason.", ar: "أدخل سبباً." },
      fReason: { en: "Reason (required)", ar: "السبب (مطلوب)" },
      phReason: { en: "Why is this being denied?", ar: "لماذا يُرفض هذا؟" },
      denying: { en: "Denying…", ar: "جارٍ الرفض…" },
    },

    // Commission History — VIEW ONLY. Also rendered inside the Archive page,
    // which imports this same component.
    hist: {
      statPayouts: { en: "Payouts", ar: "الدفعات" },
      statTotalPaid: { en: "Total Paid", ar: "إجمالي المدفوع" },
      statDriversPaid: { en: "Drivers Paid", ar: "السائقون المدفوع لهم" },
      allDrivers: { en: "All drivers", ar: "كل السائقين" },
      monthSettled: { en: "Month settled", ar: "الشهر المُسوَّى" },
      allMonths: { en: "All months", ar: "كل الأشهر" },
      thPaid: { en: "Paid", ar: "تاريخ الدفع" },
      thPayoutRun: { en: "Payout run", ar: "دورة الصرف" },
      noneYet: { en: "No paid commissions yet.", ar: "لا توجد عمولات مدفوعة بعد." },
      noneForMonth: {
        en: "Nothing paid for {month} under this filter.",
        ar: "لم يُدفع شيء عن {month} ضمن هذا التصفية.",
      },
      unmonthedTitle: {
        en: "Paid before commissions were settled one month at a time",
        ar: "دُفعت قبل أن تُسوَّى العمولات شهراً بشهر",
      },
      payoutOf: { en: "Payout — {name}", ar: "دفعة — {name}" },
      print: { en: "Print", ar: "طباعة" },
      sweptAll: { en: "Settled every unpaid month at once", ar: "سوَّت كل الأشهر غير المدفوعة دفعةً واحدة" },
      paidAt: { en: "Paid {when}", ar: "دُفعت في {when}" },
      approvedBy: { en: "Approved by {who}", ar: "اعتمدها {who}" },
      baseHeading: { en: "Base — delivered trips", ar: "الأساس — الرحلات المسلَّمة" },
      noBaseTrips: { en: "No base trips.", ar: "لا توجد رحلات أساسية." },
      items: { en: "Items", ar: "البنود" },
      thItem: { en: "Item", ar: "البند" },
      noItems: { en: "No items.", ar: "لا توجد بنود." },
      deniedReason: { en: "Denied: {reason}", ar: "مرفوضة: {reason}" },
    },

    // The FIVE BUILT-IN staff roles (`staff_roles.is_default = true`, seeded by
    // 0011). Keyed off the immutable `staff_roles.key`, NEVER off the stored
    // `label` — and DISPLAY-ONLY: no column is written, no row is rewritten, so
    // `staff.role` is still the same FK it always was. Any other role (the live
    // DB carries `finance`, `head_of_maintenance`, `night_dispatcher`) falls
    // through to its stored English `label`; a `label_ar` column is a separate
    // later batch.
    //
    // Each `en` here must stay byte-identical to the seeded `label`, because
    // English used to render straight from the row. If a built-in is ever
    // renamed in the DB, this is the second place to change.
    role: {
      fleet_manager: { en: "Fleet Manager", ar: "مدير الأسطول" },
      ops_supervisor: { en: "Ops Supervisor", ar: "مشرف العمليات" },
      mechanic: { en: "Mechanic", ar: "فني ميكانيكي" },
      inventory_clerk: { en: "Inventory Clerk", ar: "أمين المستودع" },
      dispatcher: { en: "Dispatcher", ar: "منسّق الحركة" },
    },

    // The FOUR BUILT-IN leave types (`leave_types.is_default = true`, seeded by
    // 0012). Exactly the `role` arrangement above, for exactly the same reasons:
    // keyed off the immutable `leave_types.key`, DISPLAY-ONLY — no column added,
    // no row rewritten, `leave_periods.leave_type` is still the same FK. The two
    // custom types in the live DB ("travel meeting", "Night off") fall through to
    // their stored English `label`; a `label_ar` column is a separate later batch.
    //
    // Each `en` is byte-identical to 0012's seeded `label` — "Paid leave", not
    // "Paid" — because English rendered straight from the row until now.
    leaveType: {
      paid: { en: "Paid leave", ar: "إجازة مدفوعة" },
      sick: { en: "Sick leave", ar: "إجازة مرضية" },
      unpaid: { en: "Unpaid leave", ar: "إجازة بدون راتب" },
      off_duty: { en: "Off duty", ar: "خارج الخدمة" },
    },

    staff: {
      // KPI row.
      kpiActive: { en: "Active staff", ar: "الموظفون النشطون" },
      kpiIqama: { en: "Iqama exp (90d)", ar: "إقامات تنتهي (٩٠ يوماً)" },
      byBranch: { en: "Headcount by branch", ar: "عدد الموظفين حسب الفرع" },
      none: { en: "No staff yet.", ar: "لا يوجد موظفون بعد." },
      // A staff member with no branch, or one whose branch row no longer
      // resolves. Its own key: this counts PEOPLE, not vehicles or parts.
      unassigned: { en: "Unassigned", ar: "بلا فرع" },
      mechTeam: { en: "Mechanics team", ar: "فريق الميكانيكيين" },
      mechCount: { en: "mechanics", ar: "ميكانيكي" },
      openWo: { en: "Open work orders", ar: "أوامر عمل مفتوحة" },
      trucksPer: { en: "Trucks per mechanic", ar: "شاحنات لكل ميكانيكي" },
      // Load-bearing wording: `duty_hours` is a shift LENGTH, so this says
      // "has a shift on record", never "is clocked in now".
      withDuty: { en: "With duty hours set", ar: "لديهم ساعات دوام مسجَّلة" },

      // Grid.
      title: { en: "Management & Support Staff", ar: "الإدارة والموظفون المساندون" },
      onLeavePill: { en: "On leave", ar: "في إجازة" },
      sinceJan1: { en: "since Jan 1", ar: "منذ ١ يناير" },
      // WHOLE sentence per bucket — the `title` tooltip on the leave chip.
      // `{year}` is a Latin numeral in both languages.
      leaveSince: {
        one: { en: "{n} leave day taken since 1 January {year}", ar: "يوم إجازة واحد مأخوذ منذ ١ يناير {year}" },
        two: { en: "{n} leave days taken since 1 January {year}", ar: "يوما إجازة مأخوذان منذ ١ يناير {year}" },
        few: { en: "{n} leave days taken since 1 January {year}", ar: "{n} أيام إجازة مأخوذة منذ ١ يناير {year}" },
        many: { en: "{n} leave days taken since 1 January {year}", ar: "{n} يوماً من الإجازة مأخوذة منذ ١ يناير {year}" },
      },

      // Detail modal.
      detailTitle: { en: "Staff Member", ar: "موظف" },
      fRole: { en: "Role", ar: "الوظيفة" },
      fBranch: { en: "Branch of operation", ar: "فرع العمل" },
      fEmail: { en: "Email", ar: "البريد الإلكتروني" },
      fPhone: { en: "Phone", ar: "الهاتف" },
      fIqama: { en: "Iqama ID", ar: "رقم الإقامة" },
      fIqamaExp: { en: "Iqama expiry", ar: "انتهاء الإقامة" },
      fStatus: { en: "Status", ar: "الحالة" },
      // The salary Cell, its History button and that button's tooltip are
      // `drivers.salary.monthly` / `.openBtn` / `.openTitle` — shared with the
      // driver detail, which opens the same modal.
      terminate: { en: "Terminate", ar: "إنهاء الخدمة" },
      // `{name}` is the staff member's own stored name — DATA, never translated.
      confirmTerminate: {
        en: "Terminate {name}? The record is kept but removed from the active list.",
        ar: "إنهاء خدمة {name}؟ يُحتفظ بالسجل لكنه يُزال من قائمة النشطين.",
      },

      // The four STATUS words, in the priority the badge applies them. The
      // priority test is on data (`terminated_at`, the computed on-leave set,
      // `active`), never on these words. `stTerminated` deliberately matches
      // payroll.statusTerminated's wording — a PERSON whose service ended —
      // and NOT fleet.availability.terminated (مشطوب), which strikes off a truck.
      stTerminated: { en: "Terminated", ar: "منتهية خدمته" },
      stOnLeave: { en: "On leave", ar: "في إجازة" },
      stOnLeaveToday: { en: "On leave today", ar: "في إجازة اليوم" },
      stActive: { en: "Active", ar: "نشط" },
      stInactive: { en: "Inactive", ar: "غير نشط" },
      // `{d}` is an app-formatted date — Latin in both languages.
      terminatedOn: { en: "Terminated · {d}", ar: "منتهية خدمته · {d}" },

      // Add / edit form.
      addTitle: { en: "Add Staff Member", ar: "إضافة موظف" },
      editTitle: { en: "Edit staff member", ar: "تعديل بيانات موظف" },
      fName: { en: "Name *", ar: "الاسم *" },
      phName: { en: "e.g. Omar Al-Qahtani", ar: "مثال: عمر القحطاني" },
      fNameAr: { en: "Name (Arabic)", ar: "الاسم بالعربية" },
      fDutyHours: { en: "Duty hours", ar: "ساعات الدوام" },
      fSalaryInput: { en: "Monthly salary (SAR)", ar: "الراتب الشهري (ريال)" },
      phSalary: { en: "e.g. 4500", ar: "مثال: 4500" },
      phEmail: { en: "name@aquafleet.sa", ar: "name@aquafleet.sa" },
      phPhone: { en: "+966 5…", ar: "+966 5…" },
      fHireDate: { en: "Hiring date", ar: "تاريخ التعيين" },
      fActive: { en: "Active", ar: "نشط" },
      addRole: { en: "+ Add custom role…", ar: "+ إضافة وظيفة مخصّصة…" },
      phNewRole: { en: "New role name", ar: "اسم الوظيفة الجديدة" },
    },
  },
  // -------------------------------------------------------------------------
  // ARCHIVE (Phase 3, Batch 8) — app/archive/** plus lib/archive.ts, which is
  // imported by nothing outside that route and carries three user-facing label
  // surfaces of its own (the status pill, the linked-field label, and the
  // lowercase variant one sentence reads).
  //
  // NOT here, deliberately:
  //  - archive_document_types.label_en / .label_ar are BILINGUAL IN THE DB
  //    (Pattern B, like units / repairer_types). They render through
  //    arText(label_en, label_ar, lang). No key, and nothing added to
  //    SEED_GROUPS — the seed guard only understands the key/label/is_default
  //    shape, which that table does not have.
  //  - archive_document_groups.title / .description are USER DATA. Rendered
  //    verbatim in both languages.
  //  - document title, reference_no, note, issuing_entity, holder_name,
  //    renewal note, uploaded file_name: all USER DATA, rendered verbatim.
  // -------------------------------------------------------------------------
  archive: {
    title: { en: "Archive", ar: "الأرشيف" },
    subtitle: {
      en: "Company, staff, truck and customer documents — with expiry tracking and renewal history",
      ar: "مستندات الشركة والموظفين والشاحنات والعملاء — مع تتبّع الانتهاء وسجل التجديد",
    },

    // The PAGE tab strip. Keyed off the PageTab value (the
    // archive_document_groups.tab enum plus the UI-only "ledger"), never off
    // the rendered label — the label is what changes with `lang`, the value is
    // what the DB constrains and what setTab writes to the URL.
    tabs: {
      company: { en: "Company", ar: "الشركة" },
      staff: { en: "Staff", ar: "الموظفون" },
      truck: { en: "Truck", ar: "الشاحنات" },
      customer: { en: "Customer", ar: "العملاء" },
      ledger: { en: "Approvals Ledger", ar: "سجل الموافقات" },
    },

    // Page-header actions. Four separate leaves rather than one with a token,
    // because Arabic changes more than the noun between them.
    createGroup: { en: "Create Group", ar: "إنشاء مجموعة" },
    createTruckGroup: { en: "Create Truck Group", ar: "إنشاء مجموعة شاحنات" },
    createDriverGroup: { en: "Create Driver Group", ar: "إنشاء مجموعة سائقين" },
    createStaffGroup: { en: "Create Staff Group", ar: "إنشاء مجموعة موظفين" },

    // Top-of-page compliance roll-up.
    sumExpired: { en: "Expired", ar: "منتهية" },
    sumExpiringSoon: { en: "Expiring soon", ar: "تنتهي قريبًا" },
    sumDocuments: { en: "Documents", ar: "المستندات" },

    // Accessible names for the three pill sub-tab rows.
    subNavStaff: { en: "Staff sub-sections", ar: "الأقسام الفرعية للموظفين" },
    subNavTruck: { en: "Truck sub-sections", ar: "الأقسام الفرعية للشاحنات" },
    subNavCustomer: { en: "Customer sub-sections", ar: "الأقسام الفرعية للعملاء" },

    emptyGroups: { en: "No document groups yet.", ar: "لا توجد مجموعات مستندات بعد." },
    emptyGroupsHint: {
      en: "Create a group (e.g. Commercial Registration, Insurance) then add documents to it.",
      ar: "أنشئ مجموعة (مثل السجل التجاري أو التأمين) ثم أضف المستندات إليها.",
    },
    emptyDocs: { en: "No documents in this group yet.", ar: "لا توجد مستندات في هذه المجموعة بعد." },

    // "{n} document(s) · warns at {d}d". TWO tokens, one fill() pass. English
    // differs only between `one` and the rest, which is the invariant the
    // four-bucket helper is built on; Arabic drops the numeral for one/two.
    // {d} is an app-formatted number and stays Latin in both languages.
    groupMeta: {
      one: { en: "{n} document · warns at {d}d", ar: "مستند واحد · تنبيه قبل {d} يوم" },
      two: { en: "{n} documents · warns at {d}d", ar: "مستندان · تنبيه قبل {d} يوم" },
      few: { en: "{n} documents · warns at {d}d", ar: "{n} مستندات · تنبيه قبل {d} يوم" },
      many: { en: "{n} documents · warns at {d}d", ar: "{n} مستندًا · تنبيه قبل {d} يوم" },
    },

    // Company-tab document table.
    thDocument: { en: "Document", ar: "المستند" },
    thReference: { en: "Reference", ar: "المرجع" },
    thIssued: { en: "Issued", ar: "الإصدار" },
    thExpires: { en: "Expires", ar: "الانتهاء" },
    thFiles: { en: "Files", ar: "الملفات" },

    addDocument: { en: "Add Document", ar: "إضافة مستند" },
    renew: { en: "Renew", ar: "تجديد" },
    // Read by the truck tab's soft-deleted list and its detail popup, and by
    // the staff and customer tabs' equivalents. `drivers.restore` is that
    // route's own copy and stays there — this batch does not touch it.
    restore: { en: "Restore", ar: "استعادة" },
    // A money figure with its unit. The FIGURE is app-formatted (formatAmount)
    // and stays Latin in both languages; only the currency mark moves. One
    // leaf rather than a `common` promotion: the suffixed form appears in this
    // route's tables only, and every other namespace spells it inside a field
    // label like "Amount (SAR)".
    sarAmount: { en: "{n} SAR", ar: "{n} ر.س" },

    // ── PROMOTED OUT OF A SUB-NAMESPACE ─────────────────────────────────────
    // Every leaf below started life inside `archive.truck` or
    // `archive.customer` and moved up when a second file in this batch
    // rendered the identical English. Same test the `common` promotions use,
    // applied one level down: a leaf earns the route root by being read from
    // more than one of the route's files.
    //
    // `subTabDeleted` is the third pill in ALL THREE sub-tab strips (truck,
    // staff, customer); `recordsKept` is the caption under the Terminated
    // Trucks, Terminated Drivers, Terminated Management Staff and Archived
    // Customers headings alike, word for word. Keeping four copies would mean
    // a reword had to find every one of them.
    subTabDeleted: { en: "Soft-deleted", ar: "محذوفة/أرشيف" },
    recordsKept: {
      one: { en: "{n} record · kept, never deleted", ar: "سجل واحد · محفوظ ولا يُحذف أبدًا" },
      two: { en: "{n} records · kept, never deleted", ar: "سجلان · محفوظان ولا يُحذفان أبدًا" },
      few: { en: "{n} records · kept, never deleted", ar: "{n} سجلات · محفوظة ولا تُحذف أبدًا" },
      many: { en: "{n} records · kept, never deleted", ar: "{n} سجلًا · محفوظة ولا تُحذف أبدًا" },
    },
    thReason: { en: "Reason", ar: "السبب" },
    thTotal: { en: "Total", ar: "الإجمالي" },

    // The compliance MATRIX vocabulary, shared verbatim by the truck matrix
    // and both people matrices. `expiredCount` counts DOCUMENTS on every one
    // of them — which is why it promotes while `missingCount` does not: that
    // one counts trucks in one tab and people in the other, and Arabic will
    // not carry both.
    expiredCount: {
      one: { en: "{n} expired", ar: "مستند منتهٍ" },
      two: { en: "{n} expired", ar: "مستندان منتهيان" },
      few: { en: "{n} expired", ar: "{n} مستندات منتهية" },
      many: { en: "{n} expired", ar: "{n} مستندًا منتهيًا" },
    },
    thReferenceId: { en: "Reference / ID no.", ar: "المرجع / رقم الهوية" },
    // A subject row with no document at all. A ROW STATE, not an
    // ArchiveDocStatus — same separation lib/archive.ts keeps.
    missingPill: { en: "Missing", ar: "ناقص" },
    // Sub-line under a subject that holds more than one document in a group.
    docsCount: {
      one: { en: "{n} documents", ar: "مستند واحد" },
      two: { en: "{n} documents", ar: "مستندان" },
      few: { en: "{n} documents", ar: "{n} مستندات" },
      many: { en: "{n} documents", ar: "{n} مستندًا" },
    },
    // The archived-documents section in both terminated-subject popups.
    // `noArchivedDocs` stays per-tab: "for this truck" and "for this person"
    // are different English, so there is nothing to share.
    archivedDocsCount: {
      one: { en: "Archived documents ({n})", ar: "المستندات المؤرشفة (مستند واحد)" },
      two: { en: "Archived documents ({n})", ar: "المستندات المؤرشفة (مستندان)" },
      few: { en: "Archived documents ({n})", ar: "المستندات المؤرشفة ({n} مستندات)" },
      many: { en: "Archived documents ({n})", ar: "المستندات المؤرشفة ({n} مستندًا)" },
    },
    thGroup: { en: "Group", ar: "المجموعة" },

    // Person fields shared by the archived-customer and terminated-person
    // popups. Both read the same three columns off different tables.
    fNameAr: { en: "Name (Arabic)", ar: "الاسم (بالعربية)" },
    fPhone: { en: "Phone", ar: "الهاتف" },
    fEmail: { en: "Email", ar: "البريد الإلكتروني" },

    editGroupTip: { en: "Edit group", ar: "تعديل المجموعة" },
    deleteGroupTip: { en: "Delete group", ar: "حذف المجموعة" },
    editDocTip: { en: "Edit document", ar: "تعديل المستند" },
    deleteDocTip: { en: "Delete document", ar: "حذف المستند" },
    renewalHistoryTip: { en: "Renewal history", ar: "سجل التجديد" },

    previousVersion: { en: "Previous version", ar: "نسخة سابقة" },
    supersededOn: { en: "superseded {date}", ar: "استُبدلت في {date}" },
    superseded: { en: "Superseded", ar: "مستبدَلة" },

    // The DERIVED expiry status pill (lib/archive.ts). The status VALUE comes
    // from docStatus(); only the wording is looked up here, so the row tint,
    // the summary count and the pill can still never disagree.
    // Day counts are app-formatted numbers and stay Latin in both languages.
    status: {
      noExpiry: { en: "No expiry", ar: "بدون تاريخ انتهاء" },
      expiresToday: { en: "Expires today", ar: "تنتهي اليوم" },
      expiredAgo: {
        one: { en: "Expired · {n}d ago", ar: "منتهية · منذ يوم" },
        two: { en: "Expired · {n}d ago", ar: "منتهية · منذ يومين" },
        few: { en: "Expired · {n}d ago", ar: "منتهية · منذ {n} أيام" },
        many: { en: "Expired · {n}d ago", ar: "منتهية · منذ {n} يومًا" },
      },
      validLeft: {
        one: { en: "Valid · {n}d left", ar: "سارية · يوم واحد متبقٍ" },
        two: { en: "Valid · {n}d left", ar: "سارية · يومان متبقيان" },
        few: { en: "Valid · {n}d left", ar: "سارية · {n} أيام متبقية" },
        many: { en: "Valid · {n}d left", ar: "سارية · {n} يومًا متبقيًا" },
      },
      daysLeft: {
        one: { en: "{n}d left", ar: "يوم واحد متبقٍ" },
        two: { en: "{n}d left", ar: "يومان متبقيان" },
        few: { en: "{n}d left", ar: "{n} أيام متبقية" },
        many: { en: "{n}d left", ar: "{n} يومًا متبقيًا" },
      },
    },

    // THE LINKED FIELD LABEL. Keyed off PersonIdField — a CLOSED TS union
    // resolved in code (lib/archive.ts linkedFieldFor) — and NOT off the
    // archive_document_types.linked_*_field column values it is resolved from.
    // Those raw values ('iqama_number', 'license_number',
    // 'vehicle_registration') are internal mapping keys and never reach a
    // screen; this curated label is what a user actually reads.
    personId: {
      driver_iqama: { en: "Iqama ID", ar: "رقم الإقامة" },
      staff_iqama: { en: "Iqama ID", ar: "رقم الإقامة" },
      driver_license: { en: "License ID", ar: "رقم الرخصة" },
      truck_registration: { en: "Vehicle Registration", ar: "استمارة المركبة" },
    },
    // The same four labels mid-sentence. A separate group, not `.toLowerCase()`
    // on the one above: Arabic has no letter case, so lowercasing a translated
    // label is a no-op that silently leaves the English-only intent behind —
    // and calling toLowerCase() on a LOCALIZED string is exactly the
    // "discriminate on the label" mistake in another costume. English here is
    // pre-lowercased so the rendered English is byte-identical to what
    // PERSON_ID_LABEL[f].toLowerCase() produced.
    personIdLower: {
      driver_iqama: { en: "iqama id", ar: "رقم الإقامة" },
      staff_iqama: { en: "iqama id", ar: "رقم الإقامة" },
      driver_license: { en: "license id", ar: "رقم الرخصة" },
      truck_registration: { en: "vehicle registration", ar: "استمارة المركبة" },
    },

    // confirm() / alert() bodies. Plain text — no formatting component can
    // reach inside a native dialog, so every figure is pre-formatted by the
    // caller and interpolated as a token.
    confirmDeleteGroup: {
      one: {
        en: "Delete \"{title}\" and its {n} document? This cannot be undone.",
        ar: "حذف «{title}» والمستند الذي بداخلها؟ لا يمكن التراجع عن هذا.",
      },
      two: {
        en: "Delete \"{title}\" and its {n} documents? This cannot be undone.",
        ar: "حذف «{title}» والمستندين اللذين بداخلها؟ لا يمكن التراجع عن هذا.",
      },
      few: {
        en: "Delete \"{title}\" and its {n} documents? This cannot be undone.",
        ar: "حذف «{title}» و{n} مستندات بداخلها؟ لا يمكن التراجع عن هذا.",
      },
      many: {
        en: "Delete \"{title}\" and its {n} documents? This cannot be undone.",
        ar: "حذف «{title}» و{n} مستندًا بداخلها؟ لا يمكن التراجع عن هذا.",
      },
    },
    confirmDeleteGroupEmpty: {
      en: "Delete \"{title}\"? This cannot be undone.",
      ar: "حذف «{title}»؟ لا يمكن التراجع عن هذا.",
    },
    confirmDeleteDoc: {
      en: "Permanently delete \"{title}\", its files and its renewal history? This cannot be undone.",
      ar: "حذف «{title}» وملفاته وسجل تجديده نهائيًا؟ لا يمكن التراجع عن هذا.",
    },
    // Drivers and management staff share ONE English sentence, so they share
    // one leaf rather than two byte-identical ones.
    confirmRestorePerson: {
      en: "Restore {name} to the active roster?",
      ar: "استعادة {name} إلى القائمة النشطة؟",
    },
    confirmRestoreTruck: {
      en: "Restore {plate} to the active fleet? Its termination reason, price and released date will be cleared.",
      ar: "استعادة {plate} إلى الأسطول النشط؟ سيُمسح سبب الإيقاف والسعر وتاريخ الإفراج.",
    },
    // Restoring a customer is ASSEMBLED from a base line plus at most two
    // consequence lines — is_written_off and balance_returned are independent
    // and one customer can carry both. Each line is a whole sentence, not a
    // fragment spliced onto another.
    restoreCustomerAsk: { en: "Restore {name}?", ar: "استعادة {name}؟" },
    restoreCustomerBoth: {
      en: "The customer and its project both come back to active.",
      ar: "سيعود العميل ومشروعه معًا إلى الحالة النشطة.",
    },
    restoreCustomerWriteOff: {
      en: "THIS UN-FORGIVES THEIR DEBT. The {amount} write-off is reversed and they owe it again. The write-off record is kept and marked reversed, not deleted.",
      ar: "هذا يُلغي إعفاء الدين. سيُعكس الإعفاء البالغ {amount} ويصبح مستحقًا عليه مرة أخرى. يُحفظ سجل الإعفاء ويُوسم بأنه معكوس، ولا يُحذف.",
    },
    restoreCustomerWriteOffNoAmount: {
      en: "THIS UN-FORGIVES THEIR DEBT. The write-off is reversed and the amount becomes owed again. The write-off record is kept and marked reversed, not deleted.",
      ar: "هذا يُلغي إعفاء الدين. سيُعكس الإعفاء ويصبح المبلغ مستحقًا مرة أخرى. يُحفظ سجل الإعفاء ويُوسم بأنه معكوس، ولا يُحذف.",
    },
    restoreCustomerRefunded: {
      en: "Their prepaid balance was already refunded, so they return with no spendable credit. No money moves either way.",
      ar: "سبق أن رُدّ رصيده المدفوع مسبقًا، لذلك يعود بلا رصيد قابل للصرف. لا تتحرك أي أموال في أي اتجاه.",
    },

    errOpenFile: { en: "Could not open file.", ar: "تعذّر فتح الملف." },

    // -----------------------------------------------------------------------
    // TRUCK TAB — the compliance matrix, maintenance history, terminated
    // trucks. Its own sub-namespace because almost none of it is shared: a
    // truck tab counts TRUCKS where the company tab counts documents, and the
    // two count sentences inflect differently in Arabic.
    // -----------------------------------------------------------------------
    truck: {
      // The segmented sub-tab control. Keyed off the TruckSubTab value, never
      // off the label — the value is what the picker calls onChange with.
      // The third pill reads `archive.subTabDeleted`: all three strips have it.
      subTabs: {
        documents: { en: "Documents", ar: "المستندات" },
        maintenance: { en: "Maintenance History", ar: "سجل الصيانة" },
      },

      emptyGroups: {
        en: "No truck document groups yet.",
        ar: "لا توجد مجموعات مستندات شاحنات بعد.",
      },
      emptyGroupsHint: {
        en: "Create a group (e.g. Registration, Insurance, Inspection) — every truck then gets a row in it automatically.",
        ar: "أنشئ مجموعة (مثل الاستمارة أو التأمين أو الفحص) — عندها تحصل كل شاحنة على صف فيها تلقائيًا.",
      },
      emptyTrucks: {
        en: "No active trucks to track documents for.",
        ar: "لا توجد شاحنات نشطة لتتبّع مستنداتها.",
      },

      // "{n} truck(s) · warns at {d}d". The document-type prefix that can sit
      // in front of it is NOT part of this string — it comes from
      // archive_document_types (Pattern B) and is rendered through arText by
      // the caller, so no type vocabulary is keyed here.
      groupMeta: {
        one: { en: "{n} truck · warns at {d}d", ar: "شاحنة واحدة · تنبيه قبل {d} يوم" },
        two: { en: "{n} trucks · warns at {d}d", ar: "شاحنتان · تنبيه قبل {d} يوم" },
        few: { en: "{n} trucks · warns at {d}d", ar: "{n} شاحنات · تنبيه قبل {d} يوم" },
        many: { en: "{n} trucks · warns at {d}d", ar: "{n} شاحنة · تنبيه قبل {d} يوم" },
      },

      // The two header count pills. English is invariant across the buckets —
      // it never names the noun — but Arabic cannot count without naming it,
      // and the two pills count DIFFERENT things: `missing` counts trucks with
      // no document in this group (feminine), `expired` counts documents
      // (masculine). One shared leaf would have got one of them wrong.
      missingCount: {
        one: { en: "{n} missing", ar: "شاحنة واحدة ناقصة" },
        two: { en: "{n} missing", ar: "شاحنتان ناقصتان" },
        few: { en: "{n} missing", ar: "{n} شاحنات ناقصة" },
        many: { en: "{n} missing", ar: "{n} شاحنة ناقصة" },
      },
      // The expired counter reads `archive.expiredCount`: it counts DOCUMENTS
      // here and in both staff matrices, so it promoted to the route root.

      // Matrix table. Only the subject column is the truck tab's own — the
      // reference header is `archive.thReferenceId`, `Issued`, `Expires` and
      // `Files` come from the shared archive headers, and `Note` / `Status`
      // from `common`.
      thTruck: { en: "Truck", ar: "الشاحنة" },

      // The Missing pill and the multi-document sub-line are
      // `archive.missingPill` and `archive.docsCount` — the staff matrices
      // render both, word for word.
      addAnotherFor: {
        en: "Add another document for {plate}",
        ar: "إضافة مستند آخر للوحة {plate}",
      },

      // ---- Maintenance sub-tab (READ-ONLY over work_orders + outsourced_jobs)
      maintSubtitle: {
        en: "Read-only — in-house work orders and outsourced jobs, newest first.",
        ar: "للعرض فقط — أوامر العمل الداخلية والأعمال الخارجية، الأحدث أولًا.",
      },
      allTrucks: { en: "All trucks", ar: "كل الشاحنات" },
      maintEmpty: {
        en: "No maintenance history for this selection.",
        ar: "لا يوجد سجل صيانة لهذا التحديد.",
      },
      thRef: { en: "Ref", ar: "المرجع" },
      thJob: { en: "Job", ar: "العمل" },
      thTrack: { en: "Track", ar: "المسار" },
      thClosed: { en: "Closed", ar: "تاريخ الإغلاق" },
      thPartsCost: { en: "Parts cost", ar: "تكلفة القطع" },
      // The in-house / outsourced track. Keyed off the row's `kind`, which is
      // set in code from WHICH FEED the row came out of — never off the pill's
      // wording.
      kind: {
        in_house: { en: "In-house", ar: "داخلي" },
        outsourced: { en: "Outsourced", ar: "خارجي" },
      },

      // ---- Soft-deleted sub-tab
      terminatedTitle: { en: "Terminated Trucks", ar: "الشاحنات الموقوفة" },
      // The caption under that heading is `archive.recordsKept` — the archived
      // customers list says the same sentence about its own rows.
      terminatedEmpty: { en: "No terminated trucks.", ar: "لا توجد شاحنات موقوفة." },
      thPrice: { en: "Price", ar: "السعر" },
      thReleased: { en: "Released", ar: "تاريخ الإفراج" },
      thTerminatedOn: { en: "Terminated on", ar: "تاريخ الإيقاف" },
      // trucks.termination_reason — a fixed two-value enum. Keyed off the
      // VALUE the row carries, which is also what the restore RPC clears.
      reason: {
        sold: { en: "Sold", ar: "مُباعة" },
        total_loss: { en: "Total loss", ar: "خسارة كلية" },
      },

      // ---- Terminated-truck detail popup
      detailSubtitle: {
        en: "Terminated truck · record kept, never deleted",
        ar: "شاحنة موقوفة · السجل محفوظ ولا يُحذف أبدًا",
      },
      sectionVehicle: { en: "Vehicle", ar: "المركبة" },
      fModel: { en: "Model", ar: "الطراز" },
      fYear: { en: "Year", ar: "سنة الصنع" },
      fCapacity: { en: "Capacity (m³)", ar: "السعة (م³)" },
      fVin: { en: "VIN", ar: "رقم الهيكل" },
      fRegistrationExpiry: { en: "Registration expiry", ar: "انتهاء الاستمارة" },
      fOdometer: { en: "Odometer (km)", ar: "العداد (كم)" },
      sectionTermination: { en: "Termination", ar: "الإيقاف" },
      fJobCount: { en: "Maintenance jobs on record", ar: "أعمال الصيانة المسجّلة" },
      // The section heading is `archive.archivedDocsCount` and the Group
      // column header `archive.thGroup` — both shared with the
      // terminated-person popup. Only the empty line stays here: "for this
      // truck" and "for this person" are different sentences.
      noArchivedDocs: {
        en: "No archived documents for this truck.",
        ar: "لا توجد مستندات مؤرشفة لهذه الشاحنة.",
      },

      // ---- Maintenance-job detail popup
      // Same two `kind` values as the track pill above, spelled out as a
      // heading rather than a badge.
      jobKind: {
        in_house: { en: "In-house work order", ar: "أمر عمل داخلي" },
        outsourced: { en: "Outsourced job", ar: "عمل خارجي" },
      },
      sectionDetails: { en: "Details", ar: "التفاصيل" },
      thRepairer: { en: "Repairer", ar: "الورشة" },
      thQtyDrawn: { en: "Qty drawn", ar: "الكمية المسحوبة" },
      thSubtotalVat: { en: "Subtotal + VAT", ar: "الإجمالي الفرعي + الضريبة" },
      thOnHand: { en: "On hand", ar: "المتوفر" },
      thValue: { en: "Value", ar: "القيمة" },
      noStockMovement: {
        en: "No matching stock movement found for this work order",
        ar: "لم يُعثر على حركة مخزون مطابقة لأمر العمل هذا",
      },
    },

    // -----------------------------------------------------------------------
    // STAFF TAB — TWO compliance matrices (drivers, management staff) over one
    // renderer, plus the terminated-person record.
    //
    // ALMOST EVERY COUNT AND SENTENCE HERE IS SPLIT PER KIND, and that is not
    // duplication for its own sake. English gets away with one sentence and a
    // `{kind === "driver" ? … : …}` splice because only the noun changes;
    // Arabic changes the noun, its number, its gender and the adjective that
    // agrees with it. `سائقان ناقصان` and `موظفان ناقصان` are not one string
    // with a hole in it. The `.driver` / `.staff` sub-key is read off the
    // renderer's `kind` parameter — a closed TS union, set from WHICH TABLE
    // the population came out of, never from the rendered word.
    //
    // The driver side of `subjectLabel` is `common.driver`, so only the staff
    // half needs a leaf here.
    // -----------------------------------------------------------------------
    staff: {
      // Keyed off the StaffSubTab value. The fourth pill is
      // `archive.subTabDeleted`, shared by all three strips.
      subTabs: {
        drivers: { en: "Drivers", ar: "السائقون" },
        management: { en: "Management Staff", ar: "الموظفون الإداريون" },
        commissions: { en: "Commission History", ar: "سجل العمولات" },
      },
      subjectStaff: { en: "Staff member", ar: "الموظف" },

      // WHOLE SENTENCES PER KIND, not a shared frame with the subject spliced
      // in. The English hint interpolated `subjectLabel.toLowerCase()`, which
      // is the personIdLower trap in another costume: Arabic has no letter
      // case, so lowercasing a translated label silently does nothing and
      // leaves an English-only intent behind. The English text below is
      // byte-identical to what the splice produced.
      emptyGroups: {
        driver: { en: "No driver document groups yet.", ar: "لا توجد مجموعات مستندات للسائقين بعد." },
        staff: {
          en: "No management staff document groups yet.",
          ar: "لا توجد مجموعات مستندات للموظفين الإداريين بعد.",
        },
      },
      emptyGroupsHint: {
        driver: {
          en: "Create a group (e.g. Driving Licence, Iqama, Work Permit) — every driver then gets a row in it automatically.",
          ar: "أنشئ مجموعة (مثل رخصة القيادة أو الإقامة أو رخصة العمل) — وسيحصل كل سائق على صف فيها تلقائيًا.",
        },
        staff: {
          en: "Create a group (e.g. Iqama, Employment Contract) — every staff member then gets a row in it automatically.",
          ar: "أنشئ مجموعة (مثل الإقامة أو عقد العمل) — وسيحصل كل موظف على صف فيها تلقائيًا.",
        },
      },
      emptyPeople: {
        driver: { en: "No active drivers to track documents for.", ar: "لا يوجد سائقون نشطون لتتبّع مستنداتهم." },
        staff: {
          en: "No active management staff to track documents for.",
          ar: "لا يوجد موظفون إداريون نشطون لتتبّع مستنداتهم.",
        },
      },

      // "{n} driver(s) · warns at {d}d". Two tokens, one fill() pass; {d} is
      // an app-formatted number and stays Latin in both languages.
      //
      // THE STAFF PLURAL READS "staffs" AND THAT IS DELIBERATE. The English it
      // replaces was `{kind === "driver" ? "driver" : "staff"}` followed by a
      // bare `{n === 1 ? "" : "s"}`, so the live page has always rendered
      // "5 staffs". English output is byte-identical in this batch, which
      // means the wart is preserved, not corrected — fixing it is an English
      // copy change and belongs in its own commit. The Arabic is simply
      // correct, because nothing forces it to copy the mistake.
      peopleMeta: {
        driver: {
          one: { en: "{n} driver · warns at {d}d", ar: "سائق واحد · تنبيه قبل {d} يوم" },
          two: { en: "{n} drivers · warns at {d}d", ar: "سائقان · تنبيه قبل {d} يوم" },
          few: { en: "{n} drivers · warns at {d}d", ar: "{n} سائقين · تنبيه قبل {d} يوم" },
          many: { en: "{n} drivers · warns at {d}d", ar: "{n} سائقًا · تنبيه قبل {d} يوم" },
        },
        staff: {
          one: { en: "{n} staff · warns at {d}d", ar: "موظف واحد · تنبيه قبل {d} يوم" },
          two: { en: "{n} staffs · warns at {d}d", ar: "موظفان · تنبيه قبل {d} يوم" },
          few: { en: "{n} staffs · warns at {d}d", ar: "{n} موظفين · تنبيه قبل {d} يوم" },
          many: { en: "{n} staffs · warns at {d}d", ar: "{n} موظفًا · تنبيه قبل {d} يوم" },
        },
      },

      // The gap counter. Counts PEOPLE missing the document, which is why it
      // could not join `archive.expiredCount` at the route root: that one
      // counts documents, and the truck tab's own `missingCount` counts
      // trucks. Three populations, three sets of Arabic agreement.
      missingCount: {
        driver: {
          one: { en: "{n} missing", ar: "سائق واحد ناقص" },
          two: { en: "{n} missing", ar: "سائقان ناقصان" },
          few: { en: "{n} missing", ar: "{n} سائقين ناقصين" },
          many: { en: "{n} missing", ar: "{n} سائقًا ناقصًا" },
        },
        staff: {
          one: { en: "{n} missing", ar: "موظف واحد ناقص" },
          two: { en: "{n} missing", ar: "موظفان ناقصان" },
          few: { en: "{n} missing", ar: "{n} موظفين ناقصين" },
          many: { en: "{n} missing", ar: "{n} موظفًا ناقصًا" },
        },
      },

      // NOT `archive.truck.addAnotherFor`, even though both are "Add another
      // document for {x}". That one names a PLATE and this one names a PERSON,
      // and Arabic marks the difference (`للوحة` vs `لـ`).
      addAnotherFor: {
        en: "Add another document for {name}",
        ar: "إضافة مستند آخر لـ{name}",
      },

      // ---- Soft-deleted sub-tab. Both captions are `archive.recordsKept`.
      terminatedDriversTitle: { en: "Terminated Drivers", ar: "السائقون المنهية خدماتهم" },
      terminatedDriversEmpty: { en: "No terminated drivers.", ar: "لا يوجد سائقون منهية خدماتهم." },
      terminatedStaffTitle: { en: "Terminated Management Staff", ar: "الموظفون الإداريون المنهية خدماتهم" },
      terminatedStaffEmpty: { en: "No terminated staff.", ar: "لا يوجد موظفون منهية خدماتهم." },
      thRole: { en: "Role", ar: "الوظيفة" },
      thLastWorkingDay: { en: "Last working day", ar: "آخر يوم عمل" },
      thTerminatedOn: { en: "Terminated on", ar: "تاريخ إنهاء الخدمة" },

      // ---- Terminated-person popup
      detailSubtitle: {
        driver: {
          en: "Terminated driver · record kept, never deleted",
          ar: "سائق منهية خدمته · السجل محفوظ ولا يُحذف أبدًا",
        },
        staff: {
          en: "Terminated staff member · record kept, never deleted",
          ar: "موظف منهية خدمته · السجل محفوظ ولا يُحذف أبدًا",
        },
      },
      secIdentity: { en: "Identity", ar: "التعريف" },
      secEmployment: { en: "Employment", ar: "التوظيف" },
      // The two ID NUMBER labels are `archive.personId.*`, keyed off the same
      // PersonIdField union the matrix uses. Only the EXPIRY labels are new.
      fIqamaExpiry: { en: "Iqama expiry", ar: "انتهاء الإقامة" },
      fLicenseExpiry: { en: "License expiry", ar: "انتهاء الرخصة" },
      fHireDate: { en: "Hire date", ar: "تاريخ التعيين" },
      fDutyHours: { en: "Duty hours", ar: "ساعات الدوام" },
      fMonthlySalary: { en: "Monthly salary", ar: "الراتب الشهري" },
      noArchivedDocs: {
        en: "No archived documents for this person.",
        ar: "لا توجد مستندات مؤرشفة لهذا الشخص.",
      },
    },

    // -----------------------------------------------------------------------
    // CUSTOMER TAB — the one tab that archives no DOCUMENTS at all. What it
    // keeps is the FINANCIAL record: invoices, the balance owed back to the
    // customer, the write-off that forced the archive, and the commission
    // terms the dead project ran under.
    //
    // That makes this the accounting vocabulary of the whole route, and it is
    // the reason the group is not folded into the company tab's: "Expires" and
    // "Balance to return" have nothing to say to each other, and Arabic
    // finance wording is a register of its own.
    //
    // EVERY FIGURE HERE IS APP-FORMATTED (formatSarExact / formatDate /
    // formatDayKey) AND STAYS LATIN IN BOTH LANGUAGES. Only the words move.
    // -----------------------------------------------------------------------
    customer: {
      // Two pills. The third strip in the route, and the third reader of
      // `archive.subTabDeleted`.
      subTabs: {
        invoices: { en: "Invoices", ar: "الفواتير" },
      },

      // THE INVOICE STATUS PILL. Keyed off `invoices.status`, never off the
      // rendered word.
      //
      // `salesReturn` is the deliberate mismatch: the STORED status is 'void'
      // and the UI has always relabelled it. The key is named after the label
      // because that is what the pill says; the call site still branches on
      // the value, so the relabel stays a display decision in one place.
      //
      // The last pair is a ternary, not a lookup, because the fall-through arm
      // catches every status that is not one of the four named — swapping it
      // for a Record would change WHICH statuses render "In review".
      invStatus: {
        paid: { en: "Paid", ar: "مدفوعة" },
        salesReturn: { en: "Sales Return", ar: "مرتجع مبيعات" },
        unpaid: { en: "Unpaid", ar: "غير مدفوعة" },
        draft: { en: "Draft", ar: "مسودة" },
        inReview: { en: "In review", ar: "قيد المراجعة" },
      },

      // THE RETURN MARK — the pill that travels beside the figure.
      // `returnedMark` is the pill's own word AND the tooltip when no date was
      // recorded; `returnedOnTip` is the same tooltip with one. Two leaves
      // rather than a fragment glued onto the first, because Arabic puts the
      // date phrase where English puts " on".
      returnedMark: { en: "Returned", ar: "أُعيد" },
      returnedOnTip: { en: "Returned on {date}", ar: "أُعيد في {date}" },
      toReturnMark: { en: "To return", ar: "للإعادة" },

      emptyCustomers: { en: "No customers yet.", ar: "لا يوجد عملاء بعد." },

      // The parentheses are part of the string in both languages — they mark
      // an aside, and Arabic uses the same pair.
      archivedMark: { en: "(archived)", ar: "(مؤرشف)" },
      invoiceCount: {
        one: { en: "{n} invoice", ar: "فاتورة واحدة" },
        two: { en: "{n} invoices", ar: "فاتورتان" },
        few: { en: "{n} invoices", ar: "{n} فواتير" },
        many: { en: "{n} invoices", ar: "{n} فاتورة" },
      },
      // A SUFFIX, and the leading space is load-bearing: it is spliced onto
      // the count above inside a template literal, where JSX whitespace rules
      // do not apply and nothing would re-insert it.
      paidSuffix: { en: " · {amount} paid", ar: " · {amount} مدفوعة" },
      unpaidCount: {
        one: { en: "{n} unpaid", ar: "فاتورة واحدة غير مدفوعة" },
        two: { en: "{n} unpaid", ar: "فاتورتان غير مدفوعتين" },
        few: { en: "{n} unpaid", ar: "{n} فواتير غير مدفوعة" },
        many: { en: "{n} unpaid", ar: "{n} فاتورة غير مدفوعة" },
      },

      emptyInvoices: {
        en: "No invoices for this customer yet.",
        ar: "لا توجد فواتير لهذا العميل بعد.",
      },
      notYetNumbered: { en: "Not yet numbered", ar: "لم تُرقّم بعد" },
      // Marks the date above it as the CREATED date rather than the issue
      // date. Same leading-space rule as paidSuffix.
      createdSuffix: { en: " · created", ar: " · أُنشئت" },

      archivedTitle: { en: "Archived Customers", ar: "العملاء المؤرشفون" },
      // Its caption is `archive.recordsKept`, shared with the truck tab.
      archivedEmpty: { en: "No archived customers.", ar: "لا يوجد عملاء مؤرشفون." },

      // Table columns. `thCustomer` is read a second time as the popup's
      // Customer section heading — one word doing two jobs, kept as one leaf
      // so a reword cannot land on the column and miss the heading.
      thCustomer: { en: "Customer", ar: "العميل" },
      thContact: { en: "Contact", ar: "جهة الاتصال" },
      thBalanceToReturn: { en: "Balance to return", ar: "الرصيد المستحق للإعادة" },
      thArchivedOn: { en: "Archived on", ar: "تاريخ الأرشفة" },

      // The write-off caption and block. " · {amount}" is assembled in code:
      // the separator is punctuation and the figure is app-formatted, so
      // there is no language in it to key.
      writtenOff: { en: "Written off", ar: "مُعفى" },
      writtenOffOnArchive: { en: "Written off on archive", ar: "أُعفي عند الأرشفة" },
      writeOffRestoreWarn: {
        en: "Restoring this customer reverses the write-off — the amount above becomes owed again. The record is kept and marked reversed, not deleted.",
        ar: "استعادة هذا العميل تعكس الإعفاء — ويصبح المبلغ أعلاه مستحقًا مرة أخرى. يُحفظ السجل ويُوسم بأنه معكوس، ولا يُحذف.",
      },
      fBy: { en: "By", ar: "بواسطة" },
      fOn: { en: "On", ar: "بتاريخ" },

      returnBalance: { en: "Return balance", ar: "إعادة الرصيد" },

      detailSubtitle: {
        en: "Archived customer · record kept, never deleted",
        ar: "عميل مؤرشف · السجل محفوظ ولا يُحذف أبدًا",
      },

      // The three money stats. `collected` counts PAID invoices only and
      // `billed` counts everything issued — the hints say which, and that is
      // the whole reason they are hints and not tooltips.
      statCollected: { en: "Total collected", ar: "إجمالي المحصّل" },
      paidInvoiceCount: {
        one: { en: "{n} paid invoice", ar: "فاتورة مدفوعة واحدة" },
        two: { en: "{n} paid invoices", ar: "فاتورتان مدفوعتان" },
        few: { en: "{n} paid invoices", ar: "{n} فواتير مدفوعة" },
        many: { en: "{n} paid invoices", ar: "{n} فاتورة مدفوعة" },
      },
      statBilled: { en: "Total billed", ar: "إجمالي المفوتر" },
      statBilledHint: { en: "Confirmed, paid and returned", ar: "المؤكدة والمدفوعة والمرتجعة" },
      statOutstanding: { en: "Outstanding", ar: "المتبقي" },
      statNeverCollected: { en: "Never collected", ar: "لم يُحصّل أبدًا" },
      statFullySettled: { en: "Fully settled", ar: "مسدَّد بالكامل" },

      balanceReturnedNote: {
        en: "Paid back to the customer. The figure above is the amount that was returned — their spendable balance is now nil.",
        ar: "أُعيد إلى العميل. المبلغ أعلاه هو ما جرى إرجاعه — ورصيده القابل للصرف الآن صفر.",
      },
      balanceOwedNote: {
        en: "Prepaid credit left over at archive — owed to the customer.",
        ar: "رصيد مدفوع مسبقًا متبقٍ عند الأرشفة — مستحق للعميل.",
      },
      // NOT the same leaf as `returnedMark` above, even though the English is
      // the same word. That one is a PILL saying the money went back; this is
      // a field LABEL over the amount. Arabic has to name the amount here and
      // must not there, so one leaf would have been wrong on one side.
      fReturned: { en: "Returned", ar: "المبلغ المُعاد" },
      // `Method`, `Returned on` and the cash/bank_transfer pair moved to
      // `archive.ret.*`: ReturnBalanceModal WRITES the same three columns this
      // popup READS, so they are the balance-return surface's vocabulary, not
      // the customer tab's.

      // Name (Arabic) / Phone / Email are `archive.fNameAr` / `archive.fPhone`
      // / `archive.fEmail` — the terminated-person popup renders the same
      // three labels over the same three columns.
      fCustomerSince: { en: "Customer since", ar: "عميل منذ" },

      secProject: { en: "Project", ar: "المشروع" },
      noProject: {
        en: "No project on record for this customer — unusual, since a customer is normally archived alongside one.",
        ar: "لا يوجد مشروع مسجّل لهذا العميل — وهذا غير معتاد، لأن العميل يُؤرشف عادةً مع مشروعه.",
      },
      fProjectName: { en: "Project name", ar: "اسم المشروع" },
      fInitials: { en: "Trip-ref prefix", ar: "بادئة مرجع الرحلة" },
      fPaymentMethod: { en: "Payment method", ar: "طريقة الدفع" },
      fRatePerTrip: { en: "Rate per trip", ar: "السعر لكل رحلة" },
      fWaterType: { en: "Water type", ar: "نوع المياه" },
      // projects.water_type — a fixed pair rendered by a ternary in code, not
      // a db-types label map, so it is keyed here rather than under `labels`.
      waterType: {
        potable: { en: "Potable", ar: "صالحة للشرب" },
        non_potable: { en: "Non-potable", ar: "غير صالحة للشرب" },
      },
      fStartDate: { en: "Start date", ar: "تاريخ البداية" },
      fEndDate: { en: "End date", ar: "تاريخ النهاية" },
      fLocation: { en: "Location", ar: "الموقع" },
      fDescription: { en: "Description", ar: "الوصف" },

      // THE COMMISSION BLOCK. Resolved AT THE ARCHIVE DATE, not today — see
      // the call site's comment — so the caption naming the date is the point
      // of the box and not decoration.
      secCommission: { en: "Driver commission", ar: "عمولة السائق" },
      termsInForce: { en: "Terms in force {date}", ar: "الشروط السارية {date}" },
      termsLoading: { en: "Loading terms…", ar: "جارٍ تحميل الشروط…" },
      termsFailed: {
        en: "Could not resolve the terms for this date.",
        ar: "تعذّر تحديد الشروط لهذا التاريخ.",
      },
      termsNone: {
        en: "No commission terms on record for this date.",
        ar: "لا توجد شروط عمولة مسجّلة لهذا التاريخ.",
      },
      fCommissionMode: { en: "Commission mode", ar: "نوع العمولة" },
      fCommissionPerTrip: { en: "Commission per trip", ar: "العمولة لكل رحلة" },
      fBumpPct: { en: "Bump % per trip", ar: "نسبة الزيادة لكل رحلة" },

      invoicesHeading: {
        one: { en: "Invoices ({n})", ar: "الفواتير (فاتورة واحدة)" },
        two: { en: "Invoices ({n})", ar: "الفواتير (فاتورتان)" },
        few: { en: "Invoices ({n})", ar: "الفواتير ({n} فواتير)" },
        many: { en: "Invoices ({n})", ar: "الفواتير ({n} فاتورة)" },
      },
      noInvoicesOnRecord: { en: "No invoices on record.", ar: "لا توجد فواتير مسجّلة." },
      thInvoice: { en: "Invoice", ar: "الفاتورة" },
      thDate: { en: "Date", ar: "التاريخ" },
      open: { en: "Open", ar: "فتح" },
    },

    // -----------------------------------------------------------------------
    // APPROVALS LEDGER TAB — completed approvals from BOTH systems, derived
    // live. Its own sub-namespace: the vocabulary is votes, windows and locks,
    // which nothing else in this route talks about.
    //
    // The tab's tab-strip label is `archive.tabs.ledger`.
    //
    // "APPROVED" AND "REJECTED" ARE TWO PAIRS HERE, NOT ONE. `outcome.*` is
    // the ROW's own word — it labels a single decision (a قرار, masculine) in
    // the pill, the vote line and the sign-off head. `filterApproved` /
    // `filterRejected` label a SET of them: a KPI count and a filter pill, and
    // Arabic wants the definite plural there. English collapses the two, which
    // is exactly why splitting them has to be deliberate.
    // -----------------------------------------------------------------------
    ledger: {
      // Filter pills. Keyed off LedgerSystem / LedgerOutcome / LedgerKind plus
      // the UI-only "all" — never off the rendered label.
      filterAllSystems: { en: "All systems", ar: "كل الأنظمة" },
      filterAllOutcomes: { en: "All outcomes", ar: "كل النتائج" },
      filterAllKinds: { en: "All kinds", ar: "كل الأنواع" },
      filterApproved: { en: "Approved", ar: "المعتمدة" },
      filterRejected: { en: "Rejected", ar: "المرفوضة" },

      // The two source systems. Read as a filter label AND as the System
      // column's cell, which is one word doing one job in both places.
      system: {
        consumption: { en: "Consumption", ar: "الاستهلاك" },
        inventory: { en: "Inventory", ar: "المخزون" },
      },

      // LedgerKind, long and short. Both maps used to live in
      // lib/approvals-ledger.ts; nothing outside this tab read either, and a
      // pure derivation module is the wrong place for display text.
      kind: {
        exit_permit: { en: "Exit permit", ar: "تصريح خروج" },
        work_order: { en: "In-house work order", ar: "أمر عمل داخلي" },
        outsourced_job: { en: "Outsourced job", ar: "عمل خارجي" },
        purchase_order: { en: "Purchase order", ar: "أمر شراء" },
        stock_receipt: { en: "Stock receipt", ar: "إشعار استلام" },
      },
      kindShort: {
        exit_permit: { en: "Permit", ar: "تصريح" },
        work_order: { en: "In-house", ar: "داخلي" },
        outsourced_job: { en: "Outsourced", ar: "خارجي" },
        purchase_order: { en: "PO", ar: "أمر شراء" },
        stock_receipt: { en: "Receipt", ar: "استلام" },
      },

      // KPI strip.
      kpiCompleted: { en: "Completed", ar: "المكتملة" },
      kpiRevotable: { en: "Still re-votable", ar: "قابلة لإعادة التصويت" },
      lockedAsHistory: {
        one: { en: "{n} locked as history", ar: "سجل واحد مقفل كتاريخ" },
        two: { en: "{n} locked as history", ar: "سجلان مقفلان كتاريخ" },
        few: { en: "{n} locked as history", ar: "{n} سجلات مقفلة كتاريخ" },
        many: { en: "{n} locked as history", ar: "{n} سجلًا مقفلًا كتاريخ" },
      },

      // The standing explanation above the filters. {d} is LEDGER_LOCK_DAYS,
      // an app-formatted number, and stays Latin in both languages.
      banner: {
        en: "Every row here is derived live from its own system — nothing is copied into this tab. Consumption decisions stay changeable for {d} days after completion, after which the database itself refuses any further vote. Inventory decisions are locked the moment they complete, because approving or rejecting one already moved stock or set a status.",
        ar: "كل سطر هنا مُشتق مباشرة من نظامه — ولا يُنسخ شيء إلى هذا التبويب. تبقى قرارات الاستهلاك قابلة للتغيير لمدة {d} يومًا بعد اكتمالها، وبعدها ترفض قاعدة البيانات نفسها أي تصويت إضافي. أما قرارات المخزون فتُقفل لحظة اكتمالها، لأن اعتماد أحدها أو رفضه يكون قد حرّك المخزون أو غيّر الحالة فعلًا.",
      },

      emptyAll: { en: "No completed approvals yet.", ar: "لا توجد موافقات مكتملة بعد." },
      emptyFiltered: {
        en: "No completed approvals match these filters.",
        ar: "لا توجد موافقات مكتملة تطابق هذه المرشّحات.",
      },
      emptyHint: {
        en: "An approval lands here once it has two matching votes — from either the Consumption or the Inventory side.",
        ar: "تصل الموافقة إلى هنا بمجرد حصولها على تصويتين متطابقين — من جانب الاستهلاك أو من جانب المخزون.",
      },

      // Table. `Reference` is `archive.thReference`.
      thSystem: { en: "System", ar: "النظام" },
      thKind: { en: "Kind", ar: "النوع" },
      thWhat: { en: "What", ar: "الموضوع" },
      thCompleted: { en: "Completed", ar: "تاريخ الاكتمال" },
      thValue: { en: "Value", ar: "القيمة" },
      thOutcome: { en: "Outcome", ar: "النتيجة" },
      thWindow: { en: "Window", ar: "المهلة" },

      expand: { en: "Expand", ar: "توسيع" },
      collapse: { en: "Collapse", ar: "طي" },

      outcome: {
        approved: { en: "Approved", ar: "معتمد" },
        rejected: { en: "Rejected", ar: "مرفوض" },
      },
      // The Window cell. The countdown reuses `archive.status.daysLeft` —
      // "{n}d left" is the same sentence the expiry pills render.
      lockedPill: { en: "Locked", ar: "مقفل" },
      readOnly: { en: "Read-only", ar: "للعرض فقط" },
      approve: { en: "Approve", ar: "اعتماد" },
      reject: { en: "Reject", ar: "رفض" },
      promptRejectReason: {
        en: "Reason for rejecting this? (required)",
        ar: "ما سبب الرفض؟ (مطلوب)",
      },

      // ---- Expanded sign-off sheet
      signOffSheet: { en: "{kind} — sign-off sheet", ar: "{kind} — ورقة الاعتماد" },
      // Head line. Two whole leaves keyed off LedgerOutcome, because Arabic
      // puts the verb where English puts the participle.
      decidedOn: {
        approved: { en: "Approved on {date}", ar: "اعتُمد في {date}" },
        rejected: { en: "Rejected on {date}", ar: "رُفض في {date}" },
      },
      // One vote. `by` carries the actor's email and `comment` their words —
      // both USER DATA, interpolated, never translated.
      voteBy: { en: "by {name}", ar: "بواسطة {name}" },
      voteOn: { en: "on {date}", ar: "في {date}" },
      you: { en: "(you)", ar: "(أنت)" },
      reasonLine: { en: "Reason: {reason}", ar: "السبب: {reason}" },

      // Keyed off LedgerLockReason, the union lib/approvals-ledger.ts now
      // emits in place of four English sentences.
      lockReason: {
        window_elapsed: {
          en: "Locked — more than {d} days since completion.",
          ar: "مقفل — مضى أكثر من {d} يومًا على الاكتمال.",
        },
        po_status_set: {
          en: "Locked at completion — approving a purchase order sets its status, and its own RPCs refuse any further vote.",
          ar: "مقفل عند الاكتمال — اعتماد أمر الشراء يضبط حالته، وإجراءاته الخاصة ترفض أي تصويت إضافي.",
        },
        receipt_rejection_applied: {
          en: "Locked at completion — the completing rejection already applied its stock effect, which cannot be undone by a later vote.",
          ar: "مقفل عند الاكتمال — الرفض المُكمِّل طبّق أثره على المخزون فعلًا، ولا يمكن التراجع عنه بتصويت لاحق.",
        },
        receipt_left_pending: {
          en: "Locked at completion — the receipt's own RPCs refuse any further vote once it leaves pending approval.",
          ar: "مقفل عند الاكتمال — إجراءات الإشعار الخاصة ترفض أي تصويت إضافي بعد خروجه من انتظار الاعتماد.",
        },
      },

      // The unlocked footnote. English reads "1 days left" at n = 1 — it has
      // no singular arm and this batch does not add one, so all four English
      // buckets are identical and only the Arabic inflects.
      revotableUntil: {
        one: {
          en: "Re-votable until {date} ({n} days left). A re-vote that drops this below two matching votes returns it to the Consumption Approvals tab as pending, and it leaves this ledger.",
          ar: "قابل لإعادة التصويت حتى {date} (يوم واحد متبقٍ). إعادة تصويت تُنقص هذا عن تصويتين متطابقين تعيده إلى تبويب موافقات الاستهلاك كمعلّق، ويخرج من هذا السجل.",
        },
        two: {
          en: "Re-votable until {date} ({n} days left). A re-vote that drops this below two matching votes returns it to the Consumption Approvals tab as pending, and it leaves this ledger.",
          ar: "قابل لإعادة التصويت حتى {date} (يومان متبقيان). إعادة تصويت تُنقص هذا عن تصويتين متطابقين تعيده إلى تبويب موافقات الاستهلاك كمعلّق، ويخرج من هذا السجل.",
        },
        few: {
          en: "Re-votable until {date} ({n} days left). A re-vote that drops this below two matching votes returns it to the Consumption Approvals tab as pending, and it leaves this ledger.",
          ar: "قابل لإعادة التصويت حتى {date} ({n} أيام متبقية). إعادة تصويت تُنقص هذا عن تصويتين متطابقين تعيده إلى تبويب موافقات الاستهلاك كمعلّق، ويخرج من هذا السجل.",
        },
        many: {
          en: "Re-votable until {date} ({n} days left). A re-vote that drops this below two matching votes returns it to the Consumption Approvals tab as pending, and it leaves this ledger.",
          ar: "قابل لإعادة التصويت حتى {date} ({n} يومًا متبقيًا). إعادة تصويت تُنقص هذا عن تصويتين متطابقين تعيده إلى تبويب موافقات الاستهلاك كمعلّق، ويخرج من هذا السجل.",
        },
      },
    },

    // -----------------------------------------------------------------------
    // BALANCE RETURN — app/archive/ReturnBalanceModal.tsx, and the three
    // columns of it that app/archive/ArchiveCustomerTab.tsx reads back.
    //
    // ITS OWN SUB-NAMESPACE BECAUSE THE SURFACE IS SHARED, NOT THE FILE. The
    // modal WRITES customer_balance_returns and the customer popup DISPLAYS the
    // row it wrote, so `fMethod`, `fReturnedOn` and `method.*` are read from
    // both files — the same test that promoted `fNameAr` / `fPhone` / `fEmail`
    // to this root. They were in `archive.customer` while it had one reader.
    //
    // THERE IS NO AMOUNT LEAF THAT TAKES INPUT, and there must never be one.
    // The figure is read server-side by return_customer_balance() and frozen
    // into the row (0139); the modal only SHOWS it. See that file's header.
    // -----------------------------------------------------------------------
    ret: {
      title: { en: "Return balance", ar: "إعادة الرصيد" },
      fMethod: { en: "Method", ar: "الطريقة" },
      fReturnedOn: { en: "Returned on", ar: "تاريخ الإعادة" },
      // customer_balance_returns.returned_method — a fixed pair, keyed off the
      // stored value in the popup and off the radio's own value in the modal.
      // Never off the rendered label.
      method: {
        bank_transfer: { en: "Bank transfer", ar: "تحويل بنكي" },
        cash: { en: "Cash", ar: "نقدًا" },
      },

      // The read-only figure and its caption. `amountToReturn` is NOT
      // `archive.customer.fReturned`: that one labels money that ALREADY went
      // back, this one money about to. English distinguishes them by tense and
      // Arabic by participle, so they are two leaves.
      amountToReturn: { en: "Amount to return", ar: "المبلغ المطلوب إعادته" },
      // The JSX writes `&apos;`, which RENDERS as a bare apostrophe — the
      // English here is the rendered form, not the source form.
      amountNote: {
        en: "Taken from the customer's balance when this is saved. It is not editable here.",
        ar: "يُؤخذ من رصيد العميل عند الحفظ. وهو غير قابل للتعديل هنا.",
      },

      // WHOLE SENTENCES PER STATE, not a stem plus a "(required)" suffix. The
      // required arm of the photo field says "of transfer" and the optional arm
      // does not, so there is no stem to share — and Arabic would not have
      // agreed to one anyway. Keyed off `method === "bank_transfer"`, which is
      // the form's STATE, never off the label.
      fRefNumber: {
        required: { en: "ETF Ref. number (required) *", ar: "رقم مرجع التحويل (مطلوب) *" },
        optional: { en: "ETF Ref. number (optional)", ar: "رقم مرجع التحويل (اختياري)" },
      },
      refPlaceholder: { en: "e.g. bank transfer ref", ar: "مثال: مرجع التحويل البنكي" },
      fPhoto: {
        required: { en: "Photo of transfer (required) *", ar: "صورة التحويل (مطلوبة) *" },
        optional: { en: "Photo (optional)", ar: "صورة (اختيارية)" },
      },

      // CLIENT-SIDE validation, so it translates. The `res.error` string beside
      // it comes from the server action and stays English this batch.
      validation: {
        en: "Pick a method and a return date. A bank transfer also needs an ETF ref. number and a photo.",
        ar: "اختر الطريقة وتاريخ الإعادة. ويحتاج التحويل البنكي أيضًا إلى رقم مرجع وصورة.",
      },
      // "Record return" in English here and at `consumption.modals.recordReturn`
      // — and they are NOT one leaf. That one returns PARTS to a warehouse;
      // this one returns a customer's MONEY. Arabic separates what English
      // collapsed.
      submit: { en: "Record return", ar: "تسجيل إعادة الرصيد" },
    },

    // -----------------------------------------------------------------------
    // MODALS — group create/edit, add/edit document, renew, full details.
    // -----------------------------------------------------------------------

    // The purple pill that marks a document type whose number and expiry live
    // on the person/truck rather than on the document.
    linkPill: { en: "Link", ar: "مرتبط" },

    // Section headings shared by the document form and the details popup.
    section: {
      identity: { en: "Identity", ar: "التعريف" },
      // The JSX writes `&amp;`, which RENDERS as a bare ampersand — so the
      // English here is the rendered form, not the source form.
      refValidity: { en: "Reference & validity", ar: "المرجع والصلاحية" },
      attachments: { en: "Attachments", ar: "المرفقات" },
    },

    // WHO a staff group is for. Keyed off archive_document_groups.subject_kind
    // — a fixed enum the DB constrains — never off the label. The raw value
    // itself is a behavioural discriminator everywhere else in this route and
    // is never rendered; this is the one place it becomes words.
    subjectKind: {
      driver: { en: "Drivers", ar: "السائقون" },
      staff: { en: "Management staff", ar: "الموظفون الإداريون" },
    },
    // The subject NAMED on a document form, keyed off the same kind value.
    // Singular here, plural above: one names a population, the other names a
    // person, and Arabic will not let one string do both.
    subjectLabel: {
      driver: { en: "Driver", ar: "سائق" },
      staff: { en: "Staff member", ar: "موظف" },
      truck: { en: "Truck", ar: "شاحنة" },
    },

    // Group colour swatch tooltips. The English is the RAW KEY, unchanged —
    // that is what the tooltip said before this batch and byte-identity is the
    // rule. Arabic gets the actual colour word, which is what the tooltip was
    // always trying to be.
    color: {
      slate: { en: "slate", ar: "رمادي" },
      brand: { en: "brand", ar: "لون العلامة" },
      emerald: { en: "emerald", ar: "زمردي" },
      amber: { en: "amber", ar: "كهرماني" },
      violet: { en: "violet", ar: "بنفسجي" },
      rose: { en: "rose", ar: "وردي" },
    },

    // Shared file chrome (the staged picker, the edit-mode uploader).
    notSet: { en: "Not set", ar: "غير محدّد" },
    removeFile: { en: "Remove file", ar: "إزالة الملف" },
    attachFiles: { en: "Attach files", ar: "إرفاق ملفات" },
    addFiles: { en: "Add files", ar: "إضافة ملفات" },
    uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
    // Size is an app-formatted number and stays Latin; only the unit moves.
    fileSizeKb: { en: "{n} KB", ar: "{n} كيلوبايت" },
    fileHint: {
      en: "Images, PDF, Word, Excel and more. Max 10 MB each.",
      ar: "صور و PDF و Word و Excel وغيرها. بحد أقصى 10 ميغابايت لكل ملف.",
    },
    fileHintStaged: {
      en: "Attached when you save. Images, PDF, Word, Excel and more. Max 10 MB each.",
      ar: "تُرفق عند الحفظ. صور و PDF و Word و Excel وغيرها. بحد أقصى 10 ميغابايت لكل ملف.",
    },

    // Field labels read by BOTH the document form and the details popup.
    fTypeOfDocument: { en: "Type of document", ar: "نوع المستند" },
    fIssuingEntity: { en: "Issuing entity", ar: "الجهة المُصدِرة" },
    fHolderName: { en: "Holder name", ar: "اسم صاحب المستند" },
    fIssueDate: { en: "Issue date", ar: "تاريخ الإصدار" },
    fExpiryDate: { en: "Expiry date", ar: "تاريخ الانتهاء" },
    close: { en: "Close", ar: "إغلاق" },

    // The document-TYPE picker. Its rows render label_en / label_ar through
    // arText — nothing about the type vocabulary itself is keyed here.
    phNewType: { en: "New type name", ar: "اسم النوع الجديد" },
    errAddType: { en: "Could not add type.", ar: "تعذّرت إضافة النوع." },
    confirmDeleteType: {
      en: "Delete the \"{label}\" type? This cannot be undone.",
      ar: "حذف نوع «{label}»؟ لا يمكن التراجع عن هذا.",
    },
    typePicker: {
      choose: { en: "Choose a type…", ar: "اختر نوعًا…" },
      addNew: { en: "Add new type", ar: "إضافة نوع جديد" },
      deleteTip: { en: "Delete \"{label}\"", ar: "حذف «{label}»" },
      deleteAria: { en: "Delete {label}", ar: "حذف {label}" },
    },

    groupModal: {
      titleEdit: { en: "Edit Group", ar: "تعديل المجموعة" },
      errTitle: { en: "Group title is required.", ar: "عنوان المجموعة مطلوب." },
      fTitle: { en: "Title *", ar: "العنوان *" },
      fFor: { en: "This group is for *", ar: "هذه المجموعة لـ *" },
      fType: { en: "Document type *", ar: "نوع المستند *" },
      fDescription: { en: "Description", ar: "الوصف" },
      phDescription: {
        en: "Shown under the group title — optional",
        ar: "يظهر تحت عنوان المجموعة — اختياري",
      },
      fColor: { en: "Color", ar: "اللون" },
      fWarnDays: {
        en: "Warn when expiring within (days) *",
        ar: "التنبيه عند الانتهاء خلال (أيام) *",
      },
      // One key, two callers — the subject-kind block and the type block show
      // the identical sentence once the group exists.
      locked: {
        en: "Cannot be changed after the group is created.",
        ar: "لا يمكن تغييره بعد إنشاء المجموعة.",
      },
      hintFor: {
        en: "Every person in this list gets a row, whether or not they have the document yet.",
        ar: "كل شخص في هذه القائمة يحصل على صف، سواء كان لديه المستند أم لا.",
      },
      hintType: {
        en: "Every document in this group is this type.",
        ar: "كل مستند في هذه المجموعة من هذا النوع.",
      },
      hintWarnDays: {
        en: "Documents in this group turn yellow inside this window, red once expired.",
        ar: "تتحوّل مستندات هذه المجموعة إلى الأصفر داخل هذه المدة، وإلى الأحمر بعد الانتهاء.",
      },
      // {field} is the LOWERCASE linked-field label. English is pre-lowercased
      // in `personIdLower` rather than case-folded here — see that group.
      linkNote: {
        en: "The {field} and its expiry live on the person. Documents here read those; they store no copy.",
        ar: "يُحفظ {field} وتاريخ انتهائه على سجل الشخص. المستندات هنا تقرأ منه ولا تحتفظ بنسخة.",
      },
    },

    docModal: {
      titleEdit: { en: "Edit Document", ar: "تعديل المستند" },
      // {group} is the group's own title — USER DATA, interpolated as-is.
      titleAdd: { en: "Add Document — {group}", ar: "إضافة مستند — {group}" },
      errTitle: { en: "Document title is required.", ar: "عنوان المستند مطلوب." },
      errLinkUnresolved: {
        en: "This group's type is linked to a person field, but that field could not be resolved. Not saving — the number would be stored on the document instead of the person.",
        ar: "نوع هذه المجموعة مرتبط بحقل على سجل الشخص، لكن تعذّر تحديد ذلك الحقل. لم يتم الحفظ — كان الرقم سيُخزَّن على المستند بدلًا من الشخص.",
      },
      errCreate: { en: "Could not create document.", ar: "تعذّر إنشاء المستند." },
      // {names} is a comma-joined list of uploaded FILE NAMES — user data.
      errUploadPartial: {
        one: {
          en: "Document saved, but {n} file(s) failed to upload: {names}. Reopen the document to attach them.",
          ar: "تم حفظ المستند، لكن تعذّر رفع ملف واحد: {names}. أعد فتح المستند لإرفاقه.",
        },
        two: {
          en: "Document saved, but {n} file(s) failed to upload: {names}. Reopen the document to attach them.",
          ar: "تم حفظ المستند، لكن تعذّر رفع ملفين: {names}. أعد فتح المستند لإرفاقهما.",
        },
        few: {
          en: "Document saved, but {n} file(s) failed to upload: {names}. Reopen the document to attach them.",
          ar: "تم حفظ المستند، لكن تعذّر رفع {n} ملفات: {names}. أعد فتح المستند لإرفاقها.",
        },
        many: {
          en: "Document saved, but {n} file(s) failed to upload: {names}. Reopen the document to attach them.",
          ar: "تم حفظ المستند، لكن تعذّر رفع {n} ملفًا: {names}. أعد فتح المستند لإرفاقها.",
        },
      },
      fTitle: { en: "Document title *", ar: "عنوان المستند *" },
      phIssuingEntity: { en: "e.g. Ministry of Transport", ar: "مثال: وزارة النقل" },
      phHolderName: { en: "Whose name it is in", ar: "باسم من هو" },
      addNewTypeOption: { en: "+ Add new type…", ar: "+ إضافة نوع جديد…" },
      typeInherited: {
        en: "Set by the group — every document here is this type.",
        ar: "محدّد من المجموعة — كل مستند هنا من هذا النوع.",
      },
      // The LINKED number's label: the field name, an em dash, the subject's
      // own name. {name} is USER DATA. Same shape as renewModal.fNewLinked,
      // one word apart, so the two stay separate leaves rather than one with a
      // spliced-in prefix.
      fLinked: { en: "{field} — {name}", ar: "{field} — {name}" },
      fReference: { en: "Reference / ID number", ar: "المرجع / رقم الهوية" },
      linkedNumEditHint: {
        en: "Saved on the subject's record. This is where it is edited.",
        ar: "يُحفظ على سجل صاحب المستند. من هنا يتم تعديله.",
      },
      linkedNumLockedHint: {
        en: "Already on the record — this document attaches to it.",
        ar: "موجود على السجل بالفعل — هذا المستند يُرفق به.",
      },
      linkedExpEditHint: {
        en: "The subject's expiry — this document's status reads it.",
        ar: "تاريخ انتهاء صاحب المستند — حالة هذا المستند تقرأ منه.",
      },
      linkedExpLockedHint: { en: "Renew to move it forward.", ar: "جدِّد لتقديم التاريخ." },
    },

    renewModal: {
      // {title} is the document's own title — USER DATA.
      title: { en: "Renew — {title}", ar: "تجديد — {title}" },
      historyNote: {
        en: "The current version is kept as history — its details and files stay retrievable.",
        ar: "تُحفظ النسخة الحالية كسجل — تفاصيلها وملفاتها تبقى قابلة للاسترجاع.",
      },
      historyNoteLinked: {
        en: "The outgoing {field} and expiry are recorded there too.",
        ar: "يُسجَّل هناك أيضًا {field} السابق وتاريخ انتهائه.",
      },
      fNewLinked: { en: "New {field} — {name}", ar: "{field} الجديد — {name}" },
      fNewReference: { en: "New reference / ID number", ar: "المرجع / رقم الهوية الجديد" },
      fNewIssue: { en: "New issue date", ar: "تاريخ الإصدار الجديد" },
      fNewExpiry: { en: "New expiry date", ar: "تاريخ الانتهاء الجديد" },
      fNewFiles: { en: "New version files", ar: "ملفات النسخة الجديدة" },
      linkedNumHint: {
        en: "Saved on the subject's record. The current value is kept in this document's history.",
        ar: "يُحفظ على سجل صاحب المستند. تبقى القيمة الحالية ضمن سجل هذا المستند.",
      },
      linkedExpHint: {
        en: "Moves the subject's expiry forward — every status reading it follows.",
        ar: "يقدّم تاريخ انتهاء صاحب المستند — وكل حالة تقرأ منه تتبعه.",
      },
      fileHint: {
        en: "Attached to the renewed document when you save. The current files move to history.",
        ar: "تُرفق بالمستند المجدَّد عند الحفظ. تنتقل الملفات الحالية إلى السجل.",
      },
      errUploadPartial: {
        one: {
          en: "Renewed, but {n} file(s) failed to upload: {names}. Open the document to attach them.",
          ar: "تم التجديد، لكن تعذّر رفع ملف واحد: {names}. افتح المستند لإرفاقه.",
        },
        two: {
          en: "Renewed, but {n} file(s) failed to upload: {names}. Open the document to attach them.",
          ar: "تم التجديد، لكن تعذّر رفع ملفين: {names}. افتح المستند لإرفاقهما.",
        },
        few: {
          en: "Renewed, but {n} file(s) failed to upload: {names}. Open the document to attach them.",
          ar: "تم التجديد، لكن تعذّر رفع {n} ملفات: {names}. افتح المستند لإرفاقها.",
        },
        many: {
          en: "Renewed, but {n} file(s) failed to upload: {names}. Open the document to attach them.",
          ar: "تم التجديد، لكن تعذّر رفع {n} ملفًا: {names}. افتح المستند لإرفاقها.",
        },
      },
    },

    detail: {
      fReferenceNo: { en: "Reference no.", ar: "رقم المرجع" },
      fReplacedOn: { en: "Replaced on", ar: "تاريخ الاستبدال" },
      heldOnPerson: { en: "Held on the person", ar: "محفوظ على سجل الشخص" },
      // {field} is the linked-field label, {name} the person's or truck's own
      // name — the second is USER DATA.
      linkedLabel: { en: "{field} ({name})", ar: "{field} ({name})" },
      noFiles: {
        en: "No files attached to the current version.",
        ar: "لا توجد ملفات مرفقة بالنسخة الحالية.",
      },
      // Counts sit in parentheses next to a heading. English is invariant
      // across all four buckets — the noun is already plural-shaped in both
      // headings — so only Arabic actually branches.
      attachmentsCount: {
        one: { en: "Attachments ({n})", ar: "المرفقات (مرفق واحد)" },
        two: { en: "Attachments ({n})", ar: "المرفقات (مرفقان)" },
        few: { en: "Attachments ({n})", ar: "المرفقات ({n} مرفقات)" },
        many: { en: "Attachments ({n})", ar: "المرفقات ({n} مرفقًا)" },
      },
      previousVersionsCount: {
        one: { en: "Previous versions ({n})", ar: "النسخ السابقة (نسخة واحدة)" },
        two: { en: "Previous versions ({n})", ar: "النسخ السابقة (نسختان)" },
        few: { en: "Previous versions ({n})", ar: "النسخ السابقة ({n} نسخ)" },
        many: { en: "Previous versions ({n})", ar: "النسخ السابقة ({n} نسخة)" },
      },
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

/**
 * Substitute the `{token}` holes in a dictionary sentence.
 *
 * ONE PASS over the template, not one `.replace()` per token. A sequential pass
 * re-scans text it has just written, so a customer name containing `{v}` could
 * be substituted a second time by the next token. The replacer-function form
 * also sidesteps `$&`/`$1` being interpreted inside a value that came out of
 * the database.
 *
 * An unknown token is left standing rather than blanked: a visible `{q}` on
 * screen is a bug report, a silent empty space is not.
 *
 * This is the FIFTH place this function exists — lib/parts-usage.ts and
 * app/DashboardClient.tsx hold identical copies, and the two Consumption
 * modals hold a single-token variant with a different signature. It is exported
 * from here so nothing new has to make a sixth; folding the existing four onto
 * it is a separate change, because it touches routes this batch is not opening.
 */
export function fill(s: string, vals: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vals ? String(vals[k]) : m));
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
