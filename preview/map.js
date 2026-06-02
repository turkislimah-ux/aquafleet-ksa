// Dependency-free SVG map of Saudi Arabia.
window.KSAMap = (function () {
  const LAT_MIN = 16, LAT_MAX = 33;
  const LNG_MIN = 34, LNG_MAX = 56;
  function project(lat, lng) {
    return {
      x: ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * 100,
      y: (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * 100,
    };
  }
  const KSA_PATH = "M 16 24 L 22 18 L 30 12 L 38 8 L 46 8 L 54 12 L 62 18 L 70 22 L 76 24 L 82 30 L 88 36 L 90 42 L 88 50 L 84 56 L 80 60 L 78 64 L 74 70 L 68 76 L 60 80 L 52 84 L 44 86 L 36 84 L 30 80 L 24 74 L 22 66 L 18 58 L 14 50 L 12 42 L 12 34 Z";
  const CITIES = [
    { name: "Riyadh", nameAr: "الرياض", lat: 24.7136, lng: 46.6753 },
    { name: "Jeddah", nameAr: "جدة", lat: 21.4858, lng: 39.1925 },
    { name: "Makkah", nameAr: "مكة", lat: 21.3891, lng: 39.8579 },
    { name: "Madinah", nameAr: "المدينة", lat: 24.5247, lng: 39.5692 },
    { name: "Dammam", nameAr: "الدمام", lat: 26.4207, lng: 50.0888 },
    { name: "Tabuk", nameAr: "تبوك", lat: 28.3835, lng: 36.5662 },
    { name: "Abha", nameAr: "أبها", lat: 18.2164, lng: 42.5053 },
    { name: "Hail", nameAr: "حائل", lat: 27.5219, lng: 41.6907 },
    { name: "AlUla", nameAr: "العلا", lat: 26.6082, lng: 37.9220 },
    { name: "NEOM", nameAr: "نيوم", lat: 27.9300, lng: 35.0900 },
  ];

  function render({ points = [], routes = [], height = 480, showCities = true, lang = "en" }) {
    let svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="w-full h-full">`;
    svg += `<path d="${KSA_PATH}" fill="#e8d6a8" stroke="#a16f33" stroke-width="0.3" opacity="0.65" />`;
    for (let i = 0; i < 9; i++) {
      svg += `<line x1="0" x2="100" y1="${(i + 1) * 10}" y2="${(i + 1) * 10}" stroke="#fff" stroke-opacity="0.3" stroke-width="0.1"/>`;
      svg += `<line y1="0" y2="100" x1="${(i + 1) * 10}" x2="${(i + 1) * 10}" stroke="#fff" stroke-opacity="0.3" stroke-width="0.1"/>`;
    }
    routes.forEach(r => {
      const d = r.points.map((p, i) => {
        const { x, y } = project(p.lat, p.lng);
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      }).join(" ");
      svg += `<path d="${d}" fill="none" stroke="${r.color || "#0b7eea"}" stroke-width="0.6"
        ${r.dashed ? 'stroke-dasharray="1.5 1"' : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    points.forEach(p => {
      const { x, y } = project(p.lat, p.lng);
      svg += `<circle cx="${x}" cy="${y}" r="${p.size || 0.8}" fill="${p.color || "#0b7eea"}" stroke="#fff" stroke-width="0.2"><title>${(p.label || p.id || "").replace(/"/g, "&quot;")}</title></circle>`;
    });
    if (showCities) {
      CITIES.forEach(c => {
        const { x, y } = project(c.lat, c.lng);
        svg += `<circle cx="${x}" cy="${y}" r="0.5" fill="#13497d"/>`;
        svg += `<text x="${x + 1}" y="${y + 0.5}" font-size="1.8" fill="#13497d" font-weight="600">${lang === "ar" ? c.nameAr : c.name}</text>`;
      });
    }
    svg += `</svg>`;
    return `<div class="ksa-map-wrap" style="height:${height}px">${svg}<div class="absolute bottom-2 ${lang === "ar" ? "left-2" : "right-2"} text-[10px] muted bg-white/70 px-2 py-0.5 rounded">${lang === "ar" ? "المملكة العربية السعودية" : "Saudi Arabia"}</div></div>`;
  }
  return { render };
})();
