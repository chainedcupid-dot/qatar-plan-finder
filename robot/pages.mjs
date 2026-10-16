// Builds the extra pages Google reads, every time the site is published:
//   /            the tool, with a proper title, description and search-engine labels
//   /ar/         the same tool, opening in Arabic, with an Arabic title and description
//   /plans/      every plan and price as a plain table (English)
//   /ar/plans/   the same table in Arabic
//   sitemap.xml + robots.txt
// It only reads plans.json and index.html. No settings to touch.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "_site");
const SITE = "https://baqatqatar.com";
// Google Search Console ownership code (the content="..." part of its HTML tag). Empty = not added.
const GOOGLE_VERIFY = "";

const db = JSON.parse(fs.readFileSync(path.join(ROOT, "plans.json"), "utf8"));
const CHECKED = db.checked || new Date().toISOString().slice(0, 10);
const tool = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const write = (rel, body) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

const L = {
  en: {
    dir: "ltr", home: "/", plans: "/plans/",
    title: "Baqat Qatar · باقات قطر | Compare every Ooredoo & Vodafone plan",
    desc: "Free tool that compares every Ooredoo and Vodafone plan in Qatar (monthly, Hala prepaid and data-only) and shows the cheapest one for how you use your phone, plus how much you'd save. Prices checked every day.",
    pTitle: "All Ooredoo & Vodafone plans in Qatar, with prices",
    pDesc: "Every Ooredoo and Vodafone mobile plan in Qatar in one table: monthly postpaid, Hala and Vodafone prepaid recharges, and data-only plans. Prices, data and minutes, checked every day.",
    h1: "Every Ooredoo & Vodafone plan in Qatar",
    intro: d => `All current plans in one place, checked automatically every day. Last checked ${d}. Not sure which one fits you? The free tool picks the cheapest plan for how you actually use your phone.`,
    cta: "Find my best plan →", other: "عربي", otherHref: "/ar/plans/",
    sec: { plans: "Monthly plans (postpaid)", prepaid: "Prepaid recharges", data: "Data-only plans" },
    cols: ["Plan", "Company", "Price", "Data", "Local calls", "Notes"],
    o: "Ooredoo", v: "Vodafone", unl: "Unlimited", qr: "QR", mo: "/month", days: d => d === 180 ? "6 months" : `${d} days`,
    promo: (p, m) => `QR ${p}/month for the first ${m} months online`, units: n => `${n} flexible units`,
    date: d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  },
  ar: {
    dir: "rtl", home: "/ar/", plans: "/ar/plans/",
    title: "باقات قطر | قارن كل باقات أوريدو وفودافون Ooredoo و Vodafone",
    desc: "أداة مجانية تقارن كل باقات أوريدو وفودافون في قطر: الباقات الشهرية وشحن هلا المسبق وباقات البيانات، وتختار لك الباقة الأرخص التي تناسب استخدامك وكم ستوفر. الأسعار تُحدَّث كل يوم.",
    pTitle: "جميع باقات أوريدو وفودافون في قطر مع الأسعار",
    pDesc: "كل باقات Ooredoo و Vodafone في قطر في جدول واحد: الباقات الشهرية، شحن هلا وفودافون مسبق الدفع، وباقات البيانات. الأسعار والبيانات والدقائق تُحدَّث يوميًا.",
    h1: "كل باقات أوريدو وفودافون في قطر",
    intro: d => `جميع الباقات الحالية في مكان واحد، تُفحص تلقائيًا كل يوم. آخر تحديث: ${d}. محتار أي باقة تناسبك؟ الأداة المجانية تختار لك الأرخص حسب استخدامك الفعلي.`,
    cta: "← اعرف الباقة الأنسب لي", other: "English", otherHref: "/plans/",
    sec: { plans: "الباقات الشهرية (فاتورة)", prepaid: "باقات الشحن المسبق", data: "باقات البيانات فقط" },
    cols: ["الباقة", "الشركة", "السعر", "البيانات", "المكالمات المحلية", "ملاحظات"],
    o: "أوريدو Ooredoo", v: "فودافون Vodafone", unl: "غير محدود", qr: "ر.ق", mo: " شهريًا", days: d => d === 180 ? "6 أشهر" : `${d} يوم`,
    promo: (p, m) => `${p} ر.ق شهريًا لأول ${m} أشهر عند الطلب أونلاين`, units: n => `${n} وحدة مرنة`,
    date: d => new Date(d + "T12:00:00Z").toLocaleDateString("ar-QA", { day: "numeric", month: "long", year: "numeric" }),
  },
};

function seoHead(lang, { title, desc, url, alt }) {
  const t = L[lang];
  const ld = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "Baqat Qatar", alternateName: ["باقات قطر", "Qatar Plan Finder"], url: SITE + "/" },
    { "@context": "https://schema.org", "@type": "WebApplication", name: lang === "ar" ? "باقات قطر" : "Baqat Qatar",
      alternateName: ["Baqat Qatar", "باقات قطر", "Qatar Plan Finder"], url: SITE + t.home, applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any", inLanguage: ["ar", "en", "hi", "ur", "bn", "ml", "ne", "fil"], description: desc,
      offers: { "@type": "Offer", price: "0", priceCurrency: "QAR" } },
  ];
  return [
    `<link rel="canonical" href="${SITE}${url}">`,
    `<link rel="alternate" hreflang="en" href="${SITE}${alt.en}">`,
    `<link rel="alternate" hreflang="ar" href="${SITE}${alt.ar}">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}${alt.en}">`,
    `<meta property="og:url" content="${SITE}${url}">`,
    `<meta property="og:locale" content="${lang === "ar" ? "ar_QA" : "en_QA"}">`,
    GOOGLE_VERIFY ? `<meta name="google-site-verification" content="${esc(GOOGLE_VERIFY)}">` : "",
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  ].filter(Boolean).join("\n");
}

// ---------- the tool, in English (/) and Arabic (/ar/) ----------
function toolPage(lang) {
  const t = L[lang];
  let h = tool
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(t.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(t.desc)}">`)
    .replace(/<meta property="og:site_name" content="[^"]*">/, `<meta property="og:site_name" content="Baqat Qatar · باقات قطر">`)
    .replace(/<meta charset="utf-8">/, m => m + "\n" + (lang === "ar" ? `<base href="/">\n` : "") +
      seoHead(lang, { title: t.title, desc: t.desc, url: t.home, alt: { en: "/", ar: "/ar/" } }));
  if (lang === "ar") h = h.replace(/<html lang="en">/, `<html lang="ar" dir="rtl">`);
  return h;
}
write("index.html", toolPage("en"));
write("ar/index.html", toolPage("ar"));

// ---------- plain tables of every plan (/plans/, /ar/plans/) ----------
const live = k => (db[k] || []).filter(p => !p.gone);
const priceOf = p => p.price ?? p.std;
function rows(lang, k) {
  const t = L[lang];
  return live(k).sort((a, b) => priceOf(a) - priceOf(b)).map(p => {
    const recharge = p.price != null;
    const price = recharge ? `${t.qr} ${p.price} · ${t.days(p.days)}` : `${t.qr} ${p.std}${t.mo}`;
    const data = p.pool ? t.units(p.pool) : p.data == null ? t.unl : `${p.data} GB`;
    const mins = k === "data" || p.pool ? "—" : p.mins == null ? t.unl : String(p.mins);
    const note = !recharge && p.pm && p.promo < p.std ? t.promo(p.promo, p.pm) : "";
    return `<tr><td><b><bdi>${esc(p.n)}</bdi></b></td><td>${p.p === "o" ? t.o : t.v}</td><td class="n">${esc(price)}</td><td class="n">${esc(data)}</td><td class="n">${esc(mins)}</td><td>${esc(note)}</td></tr>`;
  }).join("\n");
}
function plansPage(lang) {
  const t = L[lang], d = t.date(CHECKED);
  const tables = ["plans", "prepaid", "data"].map(k => `<h2>${t.sec[k]}</h2>
<div class="tw"><table><thead><tr>${t.cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>
${rows(lang, k)}
</tbody></table></div>`).join("\n");
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
${seoHead(lang, { title: t.pTitle, desc: t.pDesc, url: t.plans, alt: { en: "/plans/", ar: "/ar/plans/" } })}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.pTitle)} | Baqat Qatar · باقات قطر</title>
<meta name="description" content="${esc(t.pDesc)}">
<meta property="og:title" content="${esc(t.pTitle)}">
<meta property="og:description" content="${esc(t.pDesc)}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="theme-color" content="#8a1538">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
:root{--bg:#f3f4f5;--card:#fff;--ink:#15191d;--muted:#5b6670;--line:#dfe3e6;--m:#8a1538}
@media (prefers-color-scheme:dark){:root{--bg:#111417;--card:#1a1f24;--ink:#eef1f3;--muted:#9aa5ae;--line:#2c343b;--m:#d2557a}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
header{background:#8a1538;color:#fff;padding:14px 16px}header a{color:#fff;text-decoration:none;font-weight:700}
main{max-width:960px;margin:0 auto;padding:18px 16px 40px}
h1{font-size:clamp(22px,5vw,30px);line-height:1.25;margin:6px 0 8px}h2{margin:28px 0 10px;font-size:19px}
.cta{display:inline-block;background:var(--m);color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px;margin:6px 0 4px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:640px}th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:start;vertical-align:top}
th{font-size:13px;color:var(--muted)}td.n{white-space:nowrap;font-variant-numeric:tabular-nums}
.top{display:flex;justify-content:space-between;gap:12px;align-items:center}.top small a{color:#fff}
p.muted,footer{color:var(--muted)}footer{font-size:13px;margin-top:24px}
</style>
</head>
<body>
<header><div class="top"><a href="${t.home}">Baqat Qatar · باقات قطر</a><small><a href="${t.otherHref}">${t.other}</a></small></div></header>
<main>
<h1>${t.h1}</h1>
<p class="muted">${esc(t.intro(d))}</p>
<a class="cta" href="${t.home}">${t.cta}</a>
${tables}
<footer>Baqat Qatar · باقات قطر · ${esc(d)}</footer>
</main>
</body>
</html>`;
}
write("plans/index.html", plansPage("en"));
write("ar/plans/index.html", plansPage("ar"));

// ---------- sitemap + robots ----------
const pairs = [["/", "/ar/"], ["/plans/", "/ar/plans/"]];
const urls = pairs.flatMap(([en, ar]) => [en, ar].map(u => `<url><loc>${SITE}${u}</loc><lastmod>${CHECKED}</lastmod>
<xhtml:link rel="alternate" hreflang="en" href="${SITE}${en}"/><xhtml:link rel="alternate" hreflang="ar" href="${SITE}${ar}"/></url>`));
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log("Pages built:", ["index.html", "ar/index.html", "plans/", "ar/plans/", "sitemap.xml", "robots.txt"].join(", "));
