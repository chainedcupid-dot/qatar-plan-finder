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
const db = JSON.parse(fs.readFileSync(new URL("../plans.json", import.meta.url)));
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
