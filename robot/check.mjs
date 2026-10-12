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
    const d = c.win.match(/(\d+)\s*GB\s*Local Data/i);
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
export function pickVodafoneDocs(html) {
  const links = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => new URL(m[1], SOURCES.vfDocs).href);
  const dated = re => links
    .filter(u => re.test(u))
    .map(u => ({ u, d: (u.match(/\/(\d{6})[-_]/) || [])[1] || "000000" }))
    .sort((a, b) => b.d.localeCompare(a.d));
  const tariff = dated(/postpaid-tariff-notification/i)[0];
  const promo = dated(/postpaid-voice-promo/i)[0];
  const prepaid = dated(/tariff-notification-prepaid|prepaid-tariff-notification/i)[0];
  return { tariff: tariff && tariff.u, promo: promo && promo.u, promoDate: promo && promo.d, prepaid: prepaid && prepaid.u };
}

export function parseVodafoneTariff(t) {
  t = t.replace(/\s+/g, " ");
  const out = {};
  const unl = ["unlimited-plus", "unlimited-plus-premium", "unlimited-plus-platinum", "unlimited-plus-vip"];
  const mr = t.match(/Monthly Rental \(MR\)\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
  const online = t.match(/Online\s*\/?\s*MVA\s*\(\s*(\d+)\s*months\)\s*\d?\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
  if (mr) unl.forEach((id, i) => {
    const std = n(mr[i + 1]);
    const promo = online ? n(online[i + 2]) : std;
    out[id] = { std, promo, pm: promo < std ? n(online[1]) : 0 };
  });
  const dataNames = { "unlimited-plus": "New Unlimited\\+", "unlimited-plus-premium": "New Unlimited\\+ Premium", "unlimited-plus-platinum": "New Unlimited\\+ Platinum", "unlimited-plus-vip": "New Unlimited\\+ VIP" };
  for (const [id, re] of Object.entries(dataNames)) {
    const d = t.match(new RegExp(re + ":\\s*First\\s*(\\d+)\\s*GB", "i"));
    if (d && out[id]) out[id].data = n(d[1]);
  }
  const pp = ["postpaid-plus-essential", "postpaid-plus-extra", "postpaid-plus-max"];
  const pr = t.match(/Postpaid\+\s*Max\s*Monthly Rental \(QR\)\s*(\d+)\s+(\d+)\s+(\d+)/i);
  if (pr) pp.forEach((id, i) => { out[id] = { std: n(pr[i + 1]), promo: n(pr[i + 1]), pm: 0 }; });
  const ppData = { "postpaid-plus-essential": "Essential:\\s*The first", "postpaid-plus-extra": "Extra:\\s*First", "postpaid-plus-max": "Max:\\s*First" };
  for (const [id, re] of Object.entries(ppData)) {
    const d = t.match(new RegExp("New Postpaid\\+ " + re + "\\s*(\\d+)\\s*GB", "i"));
    if (d && out[id]) out[id].data = n(d[1]);
  }
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
// Vodafone data plans, from the standard postpaid tariff: "Mobile Wi-Fi 199 Plan QR 199 ... 60 GB @ fullspeed".
export function parseVodafoneDataPlans(t) {
  t = t.replace(/\s+/g, " ");
  const plans = { "Mobile Wi-Fi 150": /Mobile Wi-?\s?Fi 150 Plan/i, "Mobile Wi-Fi 199": /Mobile Wi-?\s?Fi 199 Plan/i,
    "Data SIM Unlimited Premium": /Data SIM Unlimited premium/i, "Data SIM Unlimited": /Data SIM Unlimited(?!\s*premium)/i };
  const out = {};
  for (const [n, re] of Object.entries(plans)) {
    const m = t.match(re); if (!m) continue;
    const win = t.slice(m.index, m.index + 220);
    const price = win.match(/QR\s*(\d+)/i), gb = win.match(/(\d+)\s*GB\s*@\s*full\s*speed/i);
    if (price && gb) out[n] = { std: num(price[1]), promo: num(price[1]), data: num(gb[1]) };
  }
  return out;
}
// A new reading must look believable next to the old one, or the old one is kept.
export const believable = (oldV, newV) => newV > 0 && (!oldV || (newV <= oldV * 3 && newV >= oldV / 3));

// ---------- the actual run ----------
async function get(url, binary = false) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (QatarPlanFinder price robot)", "accept-language": "en" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}
async function pdfText(url) {
  return pdfBufferText(await get(url, true));
}

async function main() {
  const db = JSON.parse(fs.readFileSync(PLANS_FILE, "utf8"));
  const found = {}, problems = [];
  const sources = {};

  const step = async (label, fn) => { try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); } };

  await step("Ooredoo Shahry+ page", async () => { Object.assign(found, parseShahry(htmlToText(await get(SOURCES.shahry)))); sources.shahry = SOURCES.shahry; });
  await step("Ooredoo Qatarna+ page", async () => { Object.assign(found, parseQatarna(htmlToText(await get(SOURCES.qatarna)))); sources.qatarna = SOURCES.qatarna; });
  const packs = {};   // name -> fields read today, for prepaid + data lists
  await step("Ooredoo Hala recharge page", async () => {
    const text = htmlToText(await get(SOURCES.halaRecharge));
    for (const pl of [...db.prepaid, ...db.data].filter(p => p.p === "o" && p.n.startsWith("Hala"))) {
      const win = packWindow(text, nameToRegex(pl.n)); if (!win) continue;
      packs[pl.n] = pl.pool ? { pool: readPoints(win), days: readDays(win) } : { data: readGB(win, true), days: readDays(win) };
    }
  });
  await step("Ooredoo Data SIM+ page", async () => {
    const text = htmlToText(await get(SOURCES.dataSim));
    for (const pl of db.data.filter(p => p.n.startsWith("Data SIM+"))) {
      const c = ooredooCard(text, pl.n.replace("Data SIM+", "Data SIM+")) || {};
      const win = packWindow(text, nameToRegex(pl.n)); if (!win) continue;
      const price = c.std || num((win.match(/QR\s*(\d+)/i) || [])[1] || 0);
      packs[pl.n] = { std: price, promo: c.promo || price, data: readGB(win, false) };
    }
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
      const win = packWindow(pre, nameToRegex(pl.n)); if (win) packs[pl.n] = { data: readGB(win, false), days: readDays(win) };
    }
    const flex = vodafoneRows(pre, /Flex Recharge|Flex\s*Products/i, /Mobile Internet|Data[- ]Only|Ahlan|Visitor/i, "Flex");
    for (const pl of db.prepaid.filter(p => p.p === "v" && p.n.startsWith("Flex "))) {
      const r = flex[pl.price]; if (r) packs[pl.n] = { pool: r.amount, days: r.days };
    }
    const net = vodafoneRows(pre, /Mobile Internet|Data[- ]Only/i, /Ahlan|Visitor|Calling Card|ICC/i, "GB");
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
    if (!sane(f.std) || !sane(f.promo) || f.promo > f.std) { problems.push(`${plan.n} looks wrong (QR ${f.std} / promo ${f.promo}), kept old price`); continue; }
    for (const k of ["std", "promo", "pm", "data"]) {
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
    for (const k of ["std", "promo", "data", "pool", "days"]) {
      if (f[k] === undefined || f[k] === null || pl[k] === undefined) continue;
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
