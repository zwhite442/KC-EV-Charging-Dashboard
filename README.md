# ⚡ EV Lot Monitor
### 200 E. Marley Rd., Kansas City, KS 66115

Real-time 3D parking lot monitor for the **2027 Chevy Bolt EUV** fleet.
Built as a static web app — no server, no database, no cost to host.

---

## Features

- **3D isometric lot view** — realistic Bolt EUV renderings in all 8 factory colors
- **Drag left/right to rotate** — horizontal-only orbit, scroll to zoom
- **Unlimited vehicle entries** — backed by IndexedDB (no storage cap)
- **Auto-calculated kWh** — `(Target% − Start%) / 100 × 65 kWh` (Bolt EUV battery)
- **Dealership status rules** — Ready = ≥ 30% charge; Charging = 10–29%; Critical = < 10%
- **Manual entry** — add vehicles one at a time via the form
- **Excel / CSV upload** — bulk import from spreadsheet
- **VIN auto-fill** — first 3 characters decode the make automatically
- **Monthly auto-reset** — lot clears itself on the 1st of each month
- **Fleet search** — filter sidebar by VIN, make, model, color, or year
- **Click any car** — popup shows VIN, mileage, charge rate, kWh, and progress bar

---

## Project structure

```
ev-lot-monitor/
├── index.html                  ← Entry point
├── css/
│   ├── main.css                ← Layout, topbar, tabs, canvas controls
│   ├── sidebar.css             ← Vehicle list + search
│   ├── form.css                ← Add-vehicle form + entry list
│   └── detail.css              ← Click-through detail card
├── js/
│   ├── colors.js               ← Paint palettes, status logic, kWh formula
│   ├── renderer.js             ← Canvas 3D isometric renderer
│   ├── store.js                ← IndexedDB persistence + monthly reset
│   ├── ui.js                   ← DOM updates, virtual scroll, search
│   └── app.js                  ← Bootstrap, event wiring
├── assets/
│   └── favicon.svg
└── .github/
    └── workflows/
        └── deploy.yml          ← GitHub Pages auto-deploy
```

---

## Deploy to GitHub Pages (one-time setup)

1. **Create a new repository** on GitHub (e.g. `ev-lot-monitor`)
2. **Push this folder** as the repo root:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/ev-lot-monitor.git
   git push -u origin main
   ```
3. In your repo on GitHub → **Settings → Pages**
   - Source: **GitHub Actions**
4. The `deploy.yml` workflow runs automatically on every push to `main`.
5. Your live URL will be:
   ```
   https://YOUR_USERNAME.github.io/ev-lot-monitor/
   ```

---

## Excel / CSV column names

The uploader recognises these column headers (case-insensitive):

| Data | Accepted column names |
|------|-----------------------|
| VIN  | `vin` |
| Make | `make`, `brand`, `manufacturer` |
| Model | `model` |
| Year | `year`, `yr` |
| Mileage | `mileage`, `mile`, `odometer`, `odo` |
| Color | `color`, `colour` |
| Start % | `start`, `startpct`, `start%`, `begin`, `initial` |
| Target % | `end`, `endpct`, `end%`, `target`, `final` |
| Charge Rate | `rate`, `kw`, `power`, `kwrate` |
| kWh | *(ignored — always auto-calculated)* |

---

## kWh calculation

```
kWh delivered = (Target% − Start%) ÷ 100 × 65
```

The **2027 Bolt EUV** has a **65 kWh** usable net battery.
To change the capacity, edit `BOLT_BATTERY_KWH` in `js/colors.js`.

---

## Status color rules

| Indicator | Color | Condition |
|-----------|-------|-----------|
| 🟣 Ready | Indigo | Start% ≥ 30% |
| 🟢 Charging | Green | 10% ≤ Start% < 30% |
| 🔴 Critical | Red | Start% < 10% |

---

## Monthly reset

Lot data is stored per-month in IndexedDB. On the 1st of every new month the
database is wiped automatically and you start fresh. A warning banner appears
on the 29th and 30th. The reset happens the next time the page is opened after
the month turns — it does not require a server or cron job.
