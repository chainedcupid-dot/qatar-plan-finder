// Feeds the robot fake copies of the provider pages and checks it reads the right prices.
import fs from "node:fs";
import assert from "node:assert/strict";
import { packWindow, nameToRegex, readGB, readDays, readPoints, parseVodafoneDataPlans, vodafoneRows, believable, pdfBufferText, htmlToText, parseShahry, parseQatarna, pickVodafoneDocs, parseVodafoneTariff, parseVodafonePromo } from "./check.mjs";
const fx = f => fs.readFileSync(new URL("./fixtures/" + f, import.meta.url));

const s = parseShahry(htmlToText(fx("shahry.html").toString()));
assert.deepEqual(s["shahry-plus-go"], { std: 140, promo: 130, pm: 4, data: 15 });
assert.deepEqual(s["shahry-plus-shahid"], { std: 180, promo: 145, pm: 4, data: 8 });
assert.deepEqual(s["shahry-plus-super"], { std: 200, promo: 160, pm: 4, data: 25 });
assert.deepEqual(s["shahry-plus-social"], { std: 250, promo: 210, pm: 4, data: 40 });
assert.equal(s["shahry-plus-select"].std, 100);

const q = parseQatarna(htmlToText(fx("qatarna.html").toString()));
assert.deepEqual(q["qatarna-plus-pro"], { std: 365, promo: 280, pm: 6, data: 125 });
assert.deepEqual(q["qatarna-plus-premium"], { std: 525, promo: 405, pm: 6, data: 350 });
assert.deepEqual(q["qatarna-plus-platinum"], { std: 925, promo: 750, pm: 6, data: 750 });
assert.deepEqual(q["qatarna-plus-al-nokhba"], { std: 1200, promo: 1200, pm: 0, data: 1000 });

const docs = pickVodafoneDocs(fx("vf-docs.html").toString());
assert.match(docs.tariff, /260913-postpaid-tariff-notification/);
assert.match(docs.promo, /260729-postpaid-voice-promo/);

const tariff = parseVodafoneTariff(await pdfBufferText(fx("vf-tariff.pdf")));
assert.deepEqual(tariff["unlimited-plus"], { std: 300, promo: 225, pm: 6, data: 125 });
assert.deepEqual(tariff["unlimited-plus-premium"], { std: 450, promo: 350, pm: 6, data: 350 });
assert.deepEqual(tariff["unlimited-plus-platinum"], { std: 750, promo: 650, pm: 6, data: 750 });
assert.deepEqual(tariff["unlimited-plus-vip"], { std: 1000, promo: 1000, pm: 0, data: 1000 });
assert.deepEqual(tariff["postpaid-plus-essential"], { std: 130, promo: 130, pm: 0, data: 15 });
assert.deepEqual(tariff["postpaid-plus-max"], { std: 230, promo: 230, pm: 0, data: 60 });

const promoText = await pdfBufferText(fx("vf-promo.pdf"));
assert.deepEqual(parseVodafonePromo(promoText, "260729", new Date("2026-10-12")), { months: 4, prices: [115, 145, 180] });
assert.equal(parseVodafonePromo(promoText, "260729", new Date("2026-12-01")), null, "expired promo should be ignored");

assert.match(docs.prepaid, /260610-tariff-notification-prepaid/);

// Prepaid + data readers
// A frozen copy of the plan list that matches the saved test pages.
// (The live plans.json changes every day when prices change, so the tests must not read it.)
const db = JSON.parse(fs.readFileSync(new URL("./fixtures/plans-snapshot.json", import.meta.url)));
const hala = htmlToText(fx("hala.html").toString());
for (const pl of [...db.prepaid, ...db.data].filter(p => p.n.startsWith("Hala"))) {
  const win = packWindow(hala, nameToRegex(pl.n));
  assert.ok(win, "found " + pl.n);
  if (pl.pool) assert.equal(readPoints(win), pl.pool, pl.n + " points");
  else assert.equal(readGB(win, true), pl.data, pl.n + " data");
  assert.equal(readDays(win), pl.days, pl.n + " days");
}
const ds = htmlToText(fx("datasim.html").toString());
for (const pl of db.data.filter(p => p.n.startsWith("Data SIM+"))) {
  const win = packWindow(ds, nameToRegex(pl.n));
  assert.equal(readGB(win, false), pl.data, pl.n + " data (bonus ignored)");
  assert.equal(Number(win.match(/QR\s*(\d+)/)[1]), pl.std, pl.n + " price");
}
const vfTariffText = await pdfBufferText(fx("vf-tariff.pdf"));
const vfData = parseVodafoneDataPlans(vfTariffText);
for (const pl of db.data.filter(p => p.p === "v" && !p.days)) assert.deepEqual([vfData[pl.n].std, vfData[pl.n].data], [pl.std, pl.data], pl.n);
const pre = (await pdfBufferText(fx("vf-prepaid.pdf"))).replace(/\s+/g, " ");
for (const pl of db.prepaid.filter(p => p.n.startsWith("Combo+"))) {
  const win = packWindow(pre, nameToRegex(pl.n));
  assert.equal(readGB(win, false), pl.data, pl.n + " data"); assert.equal(readDays(win), pl.days, pl.n + " days");
}
const flex = vodafoneRows(pre, /Flex Recharge|Flex\s*Products/i, /Mobile Internet|Data[- ]Only|Ahlan|Visitor/i, "Flex");
for (const pl of db.prepaid.filter(p => p.p === "v" && p.n.startsWith("Flex "))) assert.equal(flex[pl.price].amount, pl.pool, pl.n);
const net = vodafoneRows(pre, /Mobile Internet|Data[- ]Only/i, /Ahlan|Visitor|Calling Card|ICC/i, "GB");
for (const pl of db.data.filter(p => p.n.startsWith("Prepaid Internet"))) assert.deepEqual([net[pl.price].amount, net[pl.price].days], [pl.data, pl.days], pl.n);
assert.equal(believable(10, 11.5), true); assert.equal(believable(10, 300), false);

console.log("All robot tests passed ✔");

// ===== Real pages saved by the robot on 12 Oct 2026 =====
const R = await import("./check.mjs");
const real = f => fs.readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8");
const vt = R.parseVodafoneTariff(real("real-vf-tariff.txt"));
assert.deepEqual([vt["unlimited-plus"].std, vt["unlimited-plus"].data, vt["unlimited-plus"].after], [300, 125, 10000]);
assert.deepEqual([vt["unlimited-plus-vip"].std, vt["unlimited-plus-vip"].data], [1000, 1000]);
assert.equal(vt["unlimited-plus"].promo, undefined, "no promo row in new layout: keep the old promo");
assert.deepEqual([vt["postpaid-plus-max"].std, vt["postpaid-plus-max"].data, vt["postpaid-plus-max"].after], [230, 60, 1000]);
const vd = R.parseVodafoneDataPlans(real("real-vf-tariff.txt"));
assert.deepEqual([vd["Mobile Wi-Fi 199"].std, vd["Mobile Wi-Fi 199"].data, vd["Data SIM Unlimited Premium"].std, vd["Data SIM Unlimited Premium"].after], [199, 60, 399, 20000]);
const fl = R.vodafoneFlex(real("real-vf-prepaid.txt"));
assert.deepEqual([fl[100].amount, fl[150].amount, fl[500].amount], [1100, 2200, 6250]);
const dOnly = R.vodafoneDataOnly(real("real-vf-prepaid.txt"));
assert.deepEqual([dOnly[100].amount, dOnly[100].days, dOnly[125].amount, dOnly[125].days], [20, 28, 100, 7]);
const dsc = R.parseDataSimCards(R.htmlToText(real("real-datasim.html")));
assert.deepEqual(["Go", "Super", "Pro", "Premium", "Platinum"].map(n => [dsc["Data SIM+ " + n].std, dsc["Data SIM+ " + n].data]), [[150, 35], [200, 60], [300, 300], [400, 500], [550, 500]]);
const docs2 = R.pickVodafoneDocs(real("real-vf-docs.html"), new Date("2026-10-12"));
assert.match(docs2.tariff, /260913-postpaid-tariff/); assert.match(docs2.promo, /260729-postpaid-voice-promo/); assert.match(docs2.prepaid, /260610-tariff-notification-prepaid/);
const shReal = R.parseShahry(R.htmlToText(real("real-shahry.html")));
assert.deepEqual(shReal["shahry-plus-super"], { std: 200, promo: 160, pm: 4, data: 25 });
const qaReal = R.parseQatarna(R.htmlToText(real("real-qatarna.html")));
assert.equal(qaReal["qatarna-plus-pro"].std, 365);

// Ooredoo official prepaid tariff (grid layout)
assert.match(R.pickOoredooPrepaidPdf(fx("oo-regulatory.html").toString()), /C11-01-Prepaid-Mobile-Services-195\.pdf$/);
const oo = R.parseOoredooPrepaid(await pdfBufferText(fx("oo-prepaid.pdf")));
assert.deepEqual(oo["Hala Super 75"], { data: 11.5, mins: 345, after: 256 });
assert.deepEqual(oo["Hala Super 250"], { data: 34.5, mins: 1150 });
assert.deepEqual(oo["Hala Super 200"], { data: 38.8, mins: 1150, after: 1000 });
assert.deepEqual(oo["Hala Flexi 100"], { pool: 1265, days: 28 });
assert.deepEqual(oo["Hala Data 65"], { data: 12.65, days: 28 });
assert.deepEqual(oo["Hala Data 200"], { data: 40.25, days: 28 });
assert.deepEqual(oo["Hala Unlimited Data 250"], { data: 172.5, days: 30, after: 512 });
console.log("Real-page tests passed ✔");

// Ooredoo's real C11-01 document (footnote numbers glued to labels, history log before the tables)
const ooReal = R.parseOoredooPrepaid(real("real-oo-prepaid.txt"));
const ooDb = JSON.parse(real("plans-snapshot.json"));
for (const pl of [...ooDb.prepaid, ...ooDb.data].filter(p => p.n.startsWith("Hala"))) assert.ok(ooReal[pl.n], "real C11-01 has " + pl.n);
assert.deepEqual(ooReal["Hala Super 200"], { data: 38.8, mins: 1150, after: 1000 });
assert.deepEqual(ooReal["Hala Data 65"], { data: 12.65, days: 28 });
assert.deepEqual(ooReal["Hala Unlimited Data 250"], { data: 172.5, days: 30, after: 512 });
console.log("Real Ooredoo prepaid tests passed ✔");
