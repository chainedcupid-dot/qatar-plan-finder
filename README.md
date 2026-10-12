# Qatar Plan Finder · دليل باقات قطر

Compare every Ooredoo and Vodafone plan in Qatar against how you actually use your phone: monthly bills, prepaid recharges and data-only plans. English, Arabic, Hindi, Urdu, Bengali, Malayalam, Nepali and Filipino. Light and dark mode.

## How it stays fresh
- **The robot** (`robot/check.mjs`) runs every morning on GitHub. It reads Ooredoo's Shahry+ and Qatarna+ pages and Vodafone's newest official tariff PDFs, then updates `plans.json`.
- **Prepaid and data**: the robot reads Ooredoo's Hala and Data SIM+ pages and Vodafone's prepaid PDF too. A pack that disappears is hidden quietly (it was discontinued). Only a broken page sends an email.
- **The site** (`index.html`) reads `plans.json`, so new prices show up on their own.
- **The alarm**: if the robot can't read a page, it keeps yesterday's prices and opens a GitHub issue. GitHub emails you. It closes the issue by itself once things work again.

## Visitor counter
Anonymous, no cookies, via GoatCounter. Your account code lives in `config.json` (setup asks for it). It counts visits, tab switches, taps on "See it on Ooredoo's / Vodafone's site" and WhatsApp shares, so you can show the telcos real numbers.

## Run it by hand
```
npm ci && npm test && npm run robot
```

Prices come from public provider pages. Personal offers aren't public, so they're not included.
