// The price robot. Runs once a day on GitHub.
// 1. Reads Ooredoo's plan pages and Vodafone's newest official tariff PDFs.
// 2. Updates monthly plans, prepaid recharges and data-only plans in plans.json, all on its own.
// 3. If it can't find something, it keeps the old value and exits with an error,
//    which makes GitHub open an issue (that's the "Daddy, I'm lost" email).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLANS_FILE = path.join(ROOT, "plans.json");

export const SOURCES = {
  shahry: "https://www.ooredoo.qa/web/en/postpaid-plans/shahry/",
  qatarna: "https://www.ooredoo.qa/web/en/postpaid-plans/qatarna/",
  vfDocs: "https://www.vodafone.qa/en/about-us/legal-and-regulatory/tariff-documents",
  halaRecharge: "https://www.ooredoo.qa/web/en/prepaid-plans/recharge/",
  dataSim: "https://www.ooredoo.qa/web/en/postpaid-plans/data-sim/",
  ooRegulatory: "https://www.ooredoo.qa/web/en/regulatory/",
};

export function slice(text, from, to) {
  const t = text.replace(/\s+/g, " ");
  const a = t.search(from); if (a < 0) return null;
  const rest = t.slice(a); const b = rest.slice(1).search(to);
  return b < 0 ? rest : rest.slice(0, b + 1);
}

// ---------- helpers ----------
export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#43;|&plus;/g, "+")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/\s+/g, " ");
}
const n = s => Number(String(s).replace(/,/g, ""));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sane = v => Number.isFinite(v) && v >= 20 && v <= 5000;

// Find a plan card on an Ooredoo page: the first time the plan name is followed by a price.
export function ooredooCard(text, name) {
  const re = new RegExp(esc(name) + "(?![\\w+])", "g");
  let m;
  while ((m = re.exec(text))) {
    const win = text.slice(m.index, m.index + 700);
    let two = win.match(/QR\s*([\d,]+)\s*QR\s*([\d,]+)\s*\/\s*month/i);
    if (two) {
      const months = win.match(/FOR\s+FIRST\s+(\d+)\s+MONTHS/i);
      return { std: n(two[1]), promo: n(two[2]), pm: months ? n(months[1]) : 0, win };
    }
    let one = win.match(/(?:from\s*)?QR\s*([\d,]+)\s*\/\s*month/i) || win.match(/([\d,]+)\s*\/\s*month/i);
    if (one && win.indexOf(one[0]) < 250) return { std: n(one[1]), promo: n(one[1]), pm: 0, win };
  }
  return null;
}

export function parseShahry(text) {
  const out = {};
  const names = { "shahry-plus-go": "Shahry+ Go", "shahry-plus-shahid": "Shahry+ Shahid", "shahry-plus-super": "Shahry+ Super", "shahry-plus-social": "Shahry+ Social", "shahry-plus-select": "Shahry+ Select" };
  for (const [id, name] of Object.entries(names)) {
    const c = ooredooCard(text, name);
    if (!c) continue;
    const own = c.win.slice(0, (c.win.slice(name.length).search(/Shahry\+\s/) + 1 || c.win.length + 1) - 1 + name.length);
    const d = own.match(/(\d+)\s*GB\s*Local Data/i) || own.match(/Local Data\s*(\d+)\s*GB/i);
    out[id] = { std: c.std, promo: c.promo, pm: c.pm, ...(d ? { data: n(d[1]) } : {}) };
  }
  return out;
}

export function parseQatarna(text) {
  const out = {};
  const names = { "qatarna-plus-pro": "Qatarna+ Pro", "qatarna-plus-premium": "Qatarna+ Premium", "qatarna-plus-platinum": "Qatarna+ Platinum", "qatarna-plus-al-nokhba": "Qatarna+ Al Nokhba" };
  for (const [id, name] of Object.entries(names)) {
    const c = ooredooCard(text, name);
    if (!c) continue;
    const d = text.match(new RegExp(esc(name) + ":\\s*Gives\\s*([\\d,]+)\\s*GB", "i"));
    out[id] = { std: c.std, promo: c.promo, pm: c.pm, ...(d ? { data: n(d[1]) } : {}) };
  }
  return out;
}

// Vodafone publishes official tariff PDFs. Pick the newest standard postpaid tariff and voice promo.
export function pickVodafoneDocs(html, today = new Date()) {
  const anchors = [...html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ u: new URL(m[1], SOURCES.vfDocs).href, label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));
  if (!anchors.length) for (const m of html.matchAll(/href="([^"]+\.pdf)"/gi)) anchors.push({ u: new URL(m[1], SOURCES.vfDocs).href, label: "" });
  const yymmdd = u => (u.match(/\/(\d{6})[-_]/) || [])[1] || "000000";
  const maxYY = String(today.getFullYear() % 100).padStart(2, "0") + "1231";   // ignore typo'd "future" dates like 291229
  const byLabel = re => anchors.find(a => re.test(a.label));
  const newest = re => anchors.filter(a => re.test(a.u) && yymmdd(a.u) <= maxYY).sort((x, y) => yymmdd(y.u).localeCompare(yymmdd(x.u)))[0];
  const tariff = byLabel(/^C01 Postpaid$/i) || newest(/postpaid-tariff-notification/i);
  const promo = byLabel(/New Postpaid Voice Offer/i) || newest(/postpaid-voice-promo/i);
  const prepaid = byLabel(/^C02 Prepaid$/i) || newest(/tariff-notification-prepaid|prepaid-tariff-notification/i);
  return { tariff: tariff && tariff.u, promo: promo && promo.u, promoDate: promo && yymmdd(promo.u), prepaid: prepaid && prepaid.u };
}

export function parseVodafoneTariff(t) {
  t = t.replace(/\s+/g, " ");
  const out = {};
  const unl = ["unlimited-plus", "unlimited-plus-premium", "unlimited-plus-platinum", "unlimited-plus-vip"];
  const mr = t.match(/Unlimited\+\s*VIP\s*Monthly Rental\s*(?:\(MR\))?\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i)
          || t.match(/Monthly Rental \(MR\)\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
  const online = t.match(/Online\s*\/?\s*MVA\s*\(\s*(\d+)\s*months\)\s*\d?\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
  if (mr) unl.forEach((id, i) => {
    out[id] = { std: n(mr[i + 1]) };
    if (online) { const promo = n(online[i + 2]); out[id].promo = promo; out[id].pm = promo < out[id].std ? n(online[1]) : 0; }
  });
  const unlData = { "unlimited-plus": "New Unlimited\\+(?!\\s*(?:Premium|Platinum|VIP))", "unlimited-plus-premium": "New Unlimited\\+ Premium",
    "unlimited-plus-platinum": "New Unlimited\\+ Platinum", "unlimited-plus-vip": "New Unlimited\\+ VIP" };
  for (const [id, re] of Object.entries(unlData)) {
    const d = t.match(new RegExp(re + ":\\s*First\\s*(\\d+)\\s*GB", "i")) || t.match(new RegExp(re + "\\s+(\\d+)\\s*GB\\s+\\d+\\s*GB", "i"));
    if (d && out[id]) out[id].data = n(d[1]);
  }
  const unlSpeed = speedsAfter(t, /New Unlimited\+\s*VIP\s*Monthly Rental[\s\S]{0,900}?Endless Data Speed/i, 4);
  if (unlSpeed && mr) unl.forEach((id, i) => { out[id].after = unlSpeed[i]; });

  const pp = ["postpaid-plus-essential", "postpaid-plus-extra", "postpaid-plus-max"];
  const pr = t.match(/Postpaid\+\s*Max\s*Monthly Rental \(QR\)\s*(\d+)\s+(\d+)\s+(\d+)/i);
  if (pr) pp.forEach((id, i) => { out[id] = { std: n(pr[i + 1]), promo: n(pr[i + 1]), pm: 0 }; });
  const ppData = t.match(/Full Speed Local Data \(GB\)\s*(\d+)\s*GB\s+(\d+)\s*GB\s+(\d+)\s*GB/i);
  if (ppData) pp.forEach((id, i) => { if (out[id]) out[id].data = n(ppData[i + 1]); });
  const ppOld = { "postpaid-plus-essential": "Essential:\\s*The first", "postpaid-plus-extra": "Extra:\\s*First", "postpaid-plus-max": "Max:\\s*First" };
  for (const [id, re] of Object.entries(ppOld)) {
    const d = t.match(new RegExp("New Postpaid\\+ " + re + "\\s*(\\d+)\\s*GB", "i"));
    if (d && out[id] && out[id].data === undefined) out[id].data = n(d[1]);
  }
  const ppSpeed = speedsAfter(t, /Postpaid\+\s*Max\s*Monthly Rental[\s\S]{0,400}?Endless Data Speed/i, 3);
  if (ppSpeed && pr) pp.forEach((id, i) => { out[id].after = ppSpeed[i]; });
  return out;
}

// The voice promo PDF holds the online discount for Postpaid+ plans.
export function parseVodafonePromo(t, promoDate, today = new Date()) {
  t = t.replace(/\s+/g, " ");
  const p = t.match(/Online Promo Price\s*\(\s*(\d+)\s*months\)\s*(\d+)\s+(\d+)\s+(\d+)/i);
  if (!p) return null;
  // Skip a promo whose stated duration has clearly run out.
  const eff = t.match(/Tariff Effective Date\s*(\d{1,2}\s+\w+\s+\d{4})/i);
  const dur = t.match(/Duration\s*(?:Up to\s*)?(\d+)\s*Months/i);
  if (eff && dur) {
    const end = new Date(eff[1]);
    if (!isNaN(end)) { end.setMonth(end.getMonth() + n(dur[1])); if (end < today) return null; }
  }
  return { months: n(p[1]), prices: [n(p[2]), n(p[3]), n(p[4])] };
}

export async function pdfBufferText(buf) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

// ---------- prepaid + data readers ----------
// Pack names carry their price ("Super 75" costs QR 75). If a provider changes a price, the old
// name disappears, the robot can't find it, and it raises the alarm instead of guessing.
const num = s => Number(String(s).replace(/,/g, ""));
const FAMILY = /(?:Super|Flexi|Data|Combo\s*\+?|Flex)\s*(?:Recharge\s*)?\d{2,3}(?!\d)/gi;

export function packWindow(text, nameRe) {
  const m = text.match(nameRe);
  if (!m) return null;
  let start = m.index, rest = text.slice(start + m[0].length);
  FAMILY.lastIndex = 0;
  const next = FAMILY.exec(rest);
  return text.slice(start, start + m[0].length + Math.min(next ? next.index : 600, 600));
}
// "10 GB + 1.5 GB" → 11.5 (Ooredoo's standard online bonus is part of the pack). bonus=false keeps only the first number.
export function readGB(win, bonus = true) {
  const m = win.match(/(\d+(?:\.\d+)?)\s*GB(?:[^\d+]{0,20}\+\s*(\d+(?:\.\d+)?)\s*GB)?/i);
  if (!m) return null;
  return Math.round((num(m[1]) + (bonus && m[2] ? num(m[2]) : 0)) * 10) / 10;
}
export function readDays(win) { const m = win.match(/(\d{1,3})\s*days/i); return m ? num(m[1]) : null; }
export function readPoints(win) {
  const m = win.match(/([\d,]{3,6})\s*(?:Flexi\s*)?(?:Points|units|Flex)(?:[^\d+]{0,20}\+\s*([\d,]+))?/i);
  return m ? num(m[1]) + (m[2] ? num(m[2]) : 0) : null;
}
// Which words to look for, built from the pack's own name in plans.json.
export function nameToRegex(n) {
  let m;
  if ((m = n.match(/^Hala Super (\d+)$/))) return new RegExp(`Super\\s*(?:Recharge\\s*)?${m[1]}(?!\\d)`, "i");
  if ((m = n.match(/^Hala Flexi (\d+)$/))) return new RegExp(`Flexi\\s*${m[1]}(?!\\d)`, "i");
  if ((m = n.match(/^Hala Unlimited Data (\d+)$/))) return new RegExp(`Unlimited\\s*Data\\s*(?:Recharge\\s*)?${m[1]}(?!\\d)`, "i");
  if ((m = n.match(/^Hala Data (\d+)$/))) return new RegExp(`(?<!Unlimited\\s*)Data\\s*(?:Recharge\\s*)?${m[1]}(?!\\d)`, "i");
  if ((m = n.match(/^Combo\+ (\d+)$/))) return new RegExp(`Combo\\s*\\+?\\s*${m[1]}(?!\\d)`, "i");
  if ((m = n.match(/^Data SIM\+ (\w+)$/))) return new RegExp(`Data\\s*SIM\\s*\\+\\s*${m[1]}\\b`, "i");
  return null;
}
// Vodafone's Flex and Mobile Internet tables are rows of "price  amount  days".
export function vodafoneRows(text, from, to, unit) {
  const sec = slice(text, from, to);
  if (!sec) return {};
  const re = unit === "GB"
    ? /\b(\d{2,3})\s+(\d{1,3})\s*GB\s+(\d{1,3})\s*days/gi
    : /\b(\d{2,3})\s+([\d,]{3,5})\s+(?:Flex\s+)?(\d{1,3})\s*days/gi;
  const out = {};
  for (const m of sec.matchAll(re)) out[num(m[1])] = { amount: num(m[2]), days: num(m[3]) };
  return out;
}
// Ooredoo Data SIM+ price cards: "Data SIM+ Pro ... 300 GB + 60GB Bonus @full speed UNL @1 Mbps ... QR 300 per month"
export function parseDataSimCards(text) {
  const t = text.replace(/\s+/g, " "), out = {};
  for (const nm of ["Go", "Super", "Pro", "Premium", "Platinum"]) {
    const m = t.match(new RegExp("Data SIM\\s*\\+\\s*" + nm + "\\b(?!\\s*:)(?!\\s*subscribers)"));
    if (!m) continue;
    const rest = t.slice(m.index), end = rest.search(/per month/i);
    if (end < 0) continue;
    const card = rest.slice(0, end + 9);
    const price = card.match(/QR\s*(\d{2,4})\s*per month/i);
    const gb = card.match(/(\d+)\s*GB(?:\s*\+\s*\d+\s*GB\s*Bonus\*?)?\s*@\s*full speed/i);
    const spd = card.match(/UNL\s*@\s*([\d.]+)\s*([KkMm])bps/);
    if (price) out["Data SIM+ " + nm] = { std: num(price[1]), promo: num(price[1]), ...(gb ? { data: num(gb[1]) } : {}), ...(spd ? { after: kbps(spd[1], spd[2]) } : {}) };
  }
  return out;
}
// Vodafone data plans, from the standard postpaid tariff (table layout, with the older line layout as backup).
export function parseVodafoneDataPlans(t) {
  t = t.replace(/\s+/g, " ");
  const names = ["Mobile Wi-Fi 150", "Mobile Wi-Fi 199", "Data SIM Unlimited", "Data SIM Unlimited Premium"];
  const out = {};
  const sec = sectionLast(t, /Mobile Wi ?-?Fi ?\/ ?Data Plans(?! ?\.{3})/, /Fair Usage Policy \(FUP\)|Consumer IOT|Smart Tracker/i) || "";
  const rent = sec.match(/Monthly Rental\s*QR\s*(\d+)\s*QR\s*(\d+)\s*QR\s*(\d+)\s*QR\s*(\d+)/i);
  if (rent) {
    const data = sec.match(/Local Data\s*(\d+)\s*GB\s*(\d+)\s*GB/i);
    const spd = speedsAfter(sec, /Endless Local Data Speed/i, 4);
    names.forEach((nm, i) => {
      out[nm] = { std: n(rent[i + 1]), promo: n(rent[i + 1]) };
      if (data && i < 2) out[nm].data = n(data[i + 1]);
      if (spd) out[nm].after = spd[i];
    });
    return out;
  }
  const plans = { "Mobile Wi-Fi 150": /Mobile Wi-?\s?Fi 150 Plan/i, "Mobile Wi-Fi 199": /Mobile Wi-?\s?Fi 199 Plan/i,
    "Data SIM Unlimited Premium": /Data SIM Unlimited premium/i, "Data SIM Unlimited": /Data SIM Unlimited(?!\s*premium)/i };
  for (const [nm, re] of Object.entries(plans)) {
    const m = t.match(re); if (!m) continue;
    const win = t.slice(m.index, m.index + 220);
    const price = win.match(/QR\s*(\d+)/i), gb = win.match(/(\d+)\s*GB\s*@\s*full\s*speed/i);
    if (price && gb) out[nm] = { std: num(price[1]), promo: num(price[1]), data: num(gb[1]) };
  }
  return out;
}
// Vodafone prepaid Flex table: "QR 100 1100 Flex 28 days"
export function vodafoneFlex(text) {
  const out = {};
  for (const m of text.replace(/\s+/g, " ").matchAll(/QR\s*(\d{2,3})\s+([\d,]{3,5})\s*Flex\s+(\d{1,3})\s*days/gi)) out[num(m[1])] = { amount: num(m[2]), days: num(m[3]) };
  return out;
}
// Vodafone prepaid data-only table: "Price (QR) Data Validity (Days) ... 100 20GB 28 125 100GB 7"
export function vodafoneDataOnly(text) {
  const sec = sectionLast(text, /Data Only Products(?! ?\.{3})/, /My Best Offer/i);
  const out = {};
  if (!sec) return out;
  for (const m of sec.matchAll(/\b(\d{2,3})\s+(\d+(?:\.\d+)?)\s*GB\s+(\d{1,3})\b/g)) out[num(m[1])] = { amount: num(m[2]), days: num(m[3]) };
  return out;
}
// "10 Mbps" → 10000, "128 Kbps" → 128
export const kbps = (v, unit) => Math.round(Number(v) * (/m/i.test(unit) ? 1000 : 1));
export function speedsAfter(text, labelRe, count) {
  const m = text.match(new RegExp(labelRe.source + "\\s*((?:[\\d.]+\\s*[KkMm]bps\\s*){" + count + "})", "i"));
  if (!m) return null;
  return [...m[1].matchAll(/([\d.]+)\s*([KkMm])bps/g)].map(x => kbps(x[1], x[2]));
}
// The last time a heading appears (the first is often the table of contents), up to the next heading.
export function sectionLast(text, startRe, endRe) {
  const t = text.replace(/\s+/g, " ");
  const starts = [...t.matchAll(new RegExp(startRe.source, "gi"))];
  if (!starts.length) return null;
  const a = starts[starts.length - 1].index, rest = t.slice(a + 5), b = rest.search(endRe);
  return t.slice(a, b < 0 ? undefined : a + 5 + b);
}

// ---------- Ooredoo's official prepaid tariff (C11-01), filed with the regulator ----------
// Its tables are grids: one row per detail, one column per pack, e.g.
//   "Price (QAR) 15 40 50 65 75 125 250"  /  "Local Data (GB) 1.5 4 5 8 10 19 30"
const CELL = /-?\s*N\s*\/?\s*A\s*-?|not\s+included|Unlimited|\d[\d,]*(?:\.\d+)?(?:\s*(?:GB|Kbps|Mbps))?/gi;
export function gridRow(text, from, labelRe, count) {
  const t = text.slice(from, from + 4000);
  const m = t.match(labelRe);
  if (!m) return null;
  const after = t.slice(m.index + m[0].length).replace(/^\s*(?:\([^)]{0,12}\))?\s*:?/, "");
  const cells = [];
  CELL.lastIndex = 0;
  let c, last = 0;
  while ((c = CELL.exec(after)) && cells.length < count + 1) {
    if (after.slice(last, c.index).replace(/[\s:|]/g, "").length > 2) break;   // stop at the next row's words
    cells.push(c[0].replace(/\s+/g, " ").trim()); last = c.index + c[0].length;
  }
  return cells;
}
const cellNum = c => (c && /^\d/.test(c)) ? Number(c.replace(/,|\s*(GB|Kbps|Mbps)$/gi, "")) : null;
const cellSpeed = c => { const m = c && c.match(/([\d.]+)\s*([KkMm])bps/); return m ? kbps(m[1], m[2]) : null; };
// "with the Digital Offer" is usually a total (11.5), but sometimes printed as just the extra (4.5 on 30).
const withBonus = (base, dig) => dig == null ? base : (dig < base ? Math.round((base + dig) * 100) / 100 : dig);

export function parseOoredooPrepaid(raw) {
  const t = raw.replace(/\s+/g, " "), out = {};
  // Super tables: find each row of "Super 15 Super 40 ..." headers
  for (const h of t.matchAll(/((?:Super\s*\d{2,3}\s*){3,})/g)) {
    const cols = [...h[1].matchAll(/\d{2,3}/g)].map(x => Number(x[0])), n = cols.length, at = h.index;
    const price = gridRow(t, at, /Price\s*\(QAR\)/i, n);
    if (!price || cellNum(price[0]) !== cols[0]) continue;
    const data = gridRow(t, at, /Local Data\s*\(GB\)/i, n), dataD = gridRow(t, at, /Local Data with the Digital Offer\s*\(GB\)/i, n);
    const mins = gridRow(t, at, /Local Minutes(?! with)/i, n), minsD = gridRow(t, at, /Local Minutes with the Digital Offer/i, n);
    const endless = gridRow(t, at, /Endless (?:Local )?Data(?: feature)?/i, n);
    cols.forEach((v, i) => {
      const f = {}, d0 = cellNum(data && data[i]), m0 = cellNum(mins && mins[i]);
      if (d0 != null) f.data = withBonus(d0, cellNum(dataD && dataD[i]));
      if (m0 != null && m0 < 10000) f.mins = withBonus(m0, cellNum(minsD && minsD[i]));
      const sp = cellSpeed(endless && endless[i]); if (sp) f.after = sp;
      out["Hala Super " + v] = f;
    });
  }
  // Flexi cards
  const fx = t.search(/Flexi Denomination Cards/i);
  if (fx >= 0) {
    const den = gridRow(t, fx, /Flexi Denomination Cards\s*\(QAR\)/i, 20) || [];
    const n = den.length, pts = gridRow(t, fx, /Allocated Flexi Points/i, n), bon = gridRow(t, fx, /Bonus Flexi Point/i, n), val = gridRow(t, fx, /Validity of allocated and bonus Flexi Point\s*\(days\)/i, n);
    den.forEach((d, i) => { const v = cellNum(d), p = cellNum(pts && pts[i]); if (v && p) out["Hala Flexi " + v] = { pool: p + (cellNum(bon && bon[i]) || 0), ...(cellNum(val && val[i]) ? { days: cellNum(val[i]) } : {}) }; });
  }
  // Data recharge cards
  const dx = t.search(/Local Data Recharge Cards/i);
  if (dx >= 0) {
    const den = gridRow(t, dx, /Denomination\s*\(QR\)/i, 20) || [];
    const n = den.length, al = gridRow(t, dx, /Allowance\s*\(GB\)/i, n), alD = gridRow(t, dx, /Allowance with the Digital Offer\s*\(GB\)/i, n), val = gridRow(t, dx, /Validity\s*\(days\)/i, n);
    den.forEach((d, i) => { const v = cellNum(d), a = cellNum(al && al[i]); if (v && a != null) out["Hala Data " + v] = { data: withBonus(a, cellNum(alD && alD[i])), ...(cellNum(val && val[i]) ? { days: cellNum(val[i]) } : {}) }; });
  }
  // Unlimited local data recharge
  const ux = t.search(/Unlimited Local Data Recharge/i);
  if (ux >= 0) {
    const pr = gridRow(t, ux, /Price\s*\(QAR\)/i, 4) || [];
    const n = pr.length, full = gridRow(t, ux, /Local Data Allowance at Full Speed\s*\(GB\)/i, n), add = gridRow(t, ux, /in case of digital recharges\s*\(GB\)/i, n), val = gridRow(t, ux, /Allowance Validity\s*\(days\)/i, n);
    const sp = t.slice(ux, ux + 3000).match(/Throttled Speed[\s\S]{0,400}/i);
    const speeds = sp ? [...sp[0].matchAll(/([\d.]+)\s*([KkMm])bps/g)].map(x => kbps(x[1], x[2])) : [];
    pr.forEach((p, i) => { const v = cellNum(p), f0 = cellNum(full && full[i]); if (v && f0 != null) out["Hala Unlimited Data " + v] = { data: f0 + (cellNum(add && add[i]) || 0), ...(cellNum(val && val[i]) ? { days: cellNum(val[i]) } : {}), ...(speeds[i] ? { after: speeds[i] } : {}) }; });
  }
  return out;
}
export function pickOoredooPrepaidPdf(html) {
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/C11-01\s*Prepaid Mobile Services/i.test(label)) return new URL(m[1], SOURCES.ooRegulatory).href;
  }
  const m = html.match(/href="([^"]*C11-01-Prepaid-Mobile-Services[^"]*\.pdf)"/i);
  return m ? new URL(m[1], SOURCES.ooRegulatory).href : null;
}

// A new reading must look believable next to the old one, or the old one is kept.
export const believable = (oldV, newV) => newV > 0 && (!oldV || (newV <= oldV * 3 && newV >= oldV / 3));

// ---------- the actual run ----------
// Every page the robot reads is also saved to debug/ (raw page + the text it extracted),
// so when it gets confused, a human (or Claude) can see exactly what it saw.
const DEBUG = path.join(ROOT, "debug");
const dname = url => url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(-90);
function saveDebug(url, ext, data) { try { fs.mkdirSync(DEBUG, { recursive: true }); fs.writeFileSync(path.join(DEBUG, dname(url) + ext), data); } catch {} }
async function get(url, binary = false) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "accept-language": "en" } });
  if (!res.ok) { saveDebug(url, ".error.txt", `HTTP ${res.status}`); throw new Error(`${url} answered ${res.status}`); }
  if (binary) return Buffer.from(await res.arrayBuffer());
  const html = await res.text();
  saveDebug(url, ".html", html); saveDebug(url, ".txt", htmlToText(html));
  return html;
}
// Pages that only fill in their prices after their own code runs (like Ooredoo's Hala recharge app)
// are opened in GitHub's built-in Chrome, exactly like a person would. Falls back to a plain download.
async function getRendered(url) {
  let browser;
  try {
    const { chromium } = await import("playwright-core");
    const exe = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium"].find(p => p && fs.existsSync(p));
    browser = await chromium.launch({ executablePath: exe, headless: true });
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", locale: "en-US" });
    let count = 0;
    page.on("response", async r => {
      try { if (/json/i.test(r.headers()["content-type"] || "") && count < 25) saveDebug(r.url(), `.${++count}.json`, await r.text()); } catch {}
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(4000);
    let text = await page.evaluate(() => document.body.innerText);
    for (const label of ["Super", "Flexi", "Data", "Internet"]) {   // open each tab, in case packs hide behind tabs
      try { await page.getByText(label, { exact: true }).first().click({ timeout: 1500 }); await page.waitForTimeout(1500);
            text += "\n" + await page.evaluate(() => document.body.innerText); } catch {}
    }
    saveDebug(url, ".rendered.html", await page.content()); saveDebug(url, ".rendered.txt", text);
    return text;
  } catch (e) {
    saveDebug(url, ".browser-error.txt", String(e && e.stack || e));
    return htmlToText(await get(url));
  } finally { try { await browser?.close(); } catch {} }
}

async function pdfText(url) {
  const t = await pdfBufferText(await get(url, true));
  saveDebug(url, ".txt", t);
  return t;
}

async function main() {
  const db = JSON.parse(fs.readFileSync(PLANS_FILE, "utf8"));
  const found = {}, problems = [];
  const sources = {};

  const step = async (label, fn) => { try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); } };

  await step("Ooredoo Shahry+ page", async () => { Object.assign(found, parseShahry(htmlToText(await get(SOURCES.shahry)))); sources.shahry = SOURCES.shahry; });
  await step("Ooredoo Qatarna+ page", async () => { Object.assign(found, parseQatarna(htmlToText(await get(SOURCES.qatarna)))); sources.qatarna = SOURCES.qatarna; });
  const packs = {};   // name -> fields read today, for prepaid + data lists
  await step("Ooredoo Hala prepaid", async () => {
    let got = {};
    try {
      const pdf = pickOoredooPrepaidPdf(await get(SOURCES.ooRegulatory));
      if (pdf) { got = parseOoredooPrepaid(await pdfText(pdf)); sources.ooredooPrepaid = pdf; }
    } catch (e) { saveDebug(SOURCES.ooRegulatory, ".prepaid-error.txt", String(e)); }
    const hala = [...db.prepaid, ...db.data].filter(p => p.p === "o" && p.n.startsWith("Hala"));
    if (hala.filter(p => got[p.n]).length < hala.length / 2) {      // official document didn't work: read the web page in a browser
      const text = (await getRendered(SOURCES.halaRecharge)).replace(/\s+/g, " ");
      for (const pl of hala) {
        if (got[pl.n]) continue;
        const win = packWindow(text, nameToRegex(pl.n)); if (!win) continue;
        got[pl.n] = pl.pool ? { pool: readPoints(win), days: readDays(win) } : { data: readGB(win, true), days: readDays(win) };
      }
    }
    for (const pl of hala) if (got[pl.n]) packs[pl.n] = got[pl.n];
  });
  await step("Ooredoo Data SIM+ page", async () => {
    Object.assign(packs, parseDataSimCards(htmlToText(await get(SOURCES.dataSim))));
  });
  await step("Vodafone tariff documents", async () => {
    const docs = pickVodafoneDocs(await get(SOURCES.vfDocs));
    if (!docs.tariff) throw new Error("no postpaid tariff PDF link on the page");
    const tariffText = await pdfText(docs.tariff);
    Object.assign(found, parseVodafoneTariff(tariffText));
    Object.assign(packs, parseVodafoneDataPlans(tariffText));
    if (!docs.prepaid) throw new Error("no prepaid tariff PDF link on the page");
    const pre = (await pdfText(docs.prepaid)).replace(/\s+/g, " ");
    sources.vodafonePrepaid = docs.prepaid;
    for (const pl of db.prepaid.filter(p => p.n.startsWith("Combo+"))) {
      const win = packWindow(pre, nameToRegex(pl.n));
      if (win) { const sp = win.match(/([\d.]+)\s*([KkMm])bps/); packs[pl.n] = { data: readGB(win, false), days: readDays(win), ...(sp ? { after: kbps(sp[1], sp[2]) } : {}) }; }
    }
    const flexNew = vodafoneFlex(pre);
    const flex = Object.keys(flexNew).length ? flexNew : vodafoneRows(pre, /Flex Recharge|Flex\s*Products/i, /Mobile Internet|Data[- ]Only|Ahlan|Visitor/i, "Flex");
    for (const pl of db.prepaid.filter(p => p.p === "v" && p.n.startsWith("Flex "))) {
      const r = flex[pl.price]; if (r) packs[pl.n] = { pool: r.amount, days: r.days };
    }
    const netNew = vodafoneDataOnly(pre);
    const net = Object.keys(netNew).length ? netNew : vodafoneRows(pre, /Mobile Internet|Data[- ]Only/i, /Ahlan|Visitor|Calling Card|ICC/i, "GB");
    for (const pl of db.data.filter(p => p.n.startsWith("Prepaid Internet"))) {
      const r = net[pl.price]; if (r) packs[pl.n] = { data: r.amount, days: r.days };
    }
    sources.vodafoneTariff = docs.tariff;
    if (docs.promo) {
      const promo = parseVodafonePromo(await pdfText(docs.promo), docs.promoDate);
      if (promo) {
        ["postpaid-plus-essential", "postpaid-plus-extra", "postpaid-plus-max"].forEach((id, i) => {
          if (found[id] && promo.prices[i] < found[id].std) { found[id].promo = promo.prices[i]; found[id].pm = promo.months; }
        });
        sources.vodafonePromo = docs.promo;
      }
    }
  });

  const changes = [];
  for (const plan of db.plans) {
    const f = found[plan.id];
    if (!f) { problems.push(`couldn't find ${plan.n}`); continue; }
    const promo = f.promo ?? plan.promo;
    if (!sane(f.std) || !sane(promo) || promo > f.std) { problems.push(`${plan.n} looks wrong (QR ${f.std} / promo ${promo}), kept old price`); continue; }
    for (const k of ["std", "promo", "pm", "data", "after"]) {
      if (f[k] !== undefined && f[k] !== plan[k]) { changes.push(`${plan.n} ${k}: ${plan[k]} → ${f[k]}`); plan[k] = f[k]; }
    }
  }

  // Prepaid + data: update what was read, keep the old value (and complain) if something looks off.
  // A pack or two missing = discontinued: hide it quietly. Most of a group missing = page broke: alarm.
  const groupOf = pl => pl.p + ":" + (pl.n.match(/^(Hala Super|Hala Flexi|Hala Data|Hala Unlimited|Combo\+|Flex|Data SIM\+|Prepaid Internet|Mobile Wi-Fi|Data SIM)/) || ["", pl.n])[1];
  const groups = {};
  for (const pl of [...db.prepaid, ...db.data]) (groups[groupOf(pl)] ||= []).push(pl);
  for (const [g, list] of Object.entries(groups)) {
    const missing = list.filter(pl => !packs[pl.n]);
    if (missing.length && (missing.length > 2 || missing.length * 2 > list.length)) {
      problems.push(`couldn't read ${missing.map(p => p.n).join(", ")}`);
    } else {
      for (const pl of missing) if (!pl.gone) { pl.gone = true; changes.push(`${pl.n}: no longer offered, hidden`); }
    }
    for (const pl of list) if (packs[pl.n] && pl.gone) { delete pl.gone; changes.push(`${pl.n}: back on offer`); }
  }
  for (const pl of [...db.prepaid, ...db.data]) {
    const f = packs[pl.n];
    if (!f) continue;
    for (const k of ["std", "promo", "data", "mins", "pool", "days", "after"]) {
      if (f[k] === undefined || f[k] === null || (pl[k] === undefined && k !== "after")) continue;
      if (!believable(pl[k], f[k])) { problems.push(`${pl.n} ${k} read as ${f[k]}, which looks wrong (kept ${pl[k]})`); continue; }
      if (f[k] !== pl[k]) { changes.push(`${pl.n} ${k}: ${pl[k]} → ${f[k]}`); pl[k] = f[k]; }
    }
  }
  delete db.watch;

  db.checked = new Date().toISOString().slice(0, 10);
  db.sources = { ...db.sources, ...sources };
  if (problems.length) db.problems = problems; else delete db.problems;
  fs.writeFileSync(PLANS_FILE, JSON.stringify(db, null, 1) + "\n");

  console.log(changes.length ? "Changed:\n  " + changes.join("\n  ") : "No price changes today.");
  if (problems.length) {
    const report = "The robot got confused:\n\n" + problems.map(p => "- " + p).join("\n") +
      "\n\nOld prices were kept for anything it couldn't read. Usually a provider redesigned a page.";
    fs.writeFileSync(path.join(ROOT, "robot-report.md"), report);
    console.error(report);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
