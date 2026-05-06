/**
 * colors.js
 * 2027 Chevy Bolt EUV paint palette + status colors
 */

window.EV_COLORS = {
  red: {
    body:   '#c0201a',
    dark:   '#7a0f0d',
    mid:    '#a01815',
    shadow: '#1a0808',
    glass:  'rgba(20,60,90,.55)',
    rim:    '#2a2a2a',
    label:  'Radiant Red',
  },
  black: {
    body:   '#1c1c20',
    dark:   '#0a0a0c',
    mid:    '#141416',
    shadow: '#080808',
    glass:  'rgba(20,60,90,.55)',
    rim:    '#1a1a1a',
    label:  'Mosaic Black',
  },
  white: {
    body:   '#e8e6e0',
    dark:   '#a0a09a',
    mid:    '#c8c6c0',
    shadow: '#383830',
    glass:  'rgba(20,60,90,.5)',
    rim:    '#2a2a2a',
    label:  'Summit White',
  },
  silver: {
    body:   '#909498',
    dark:   '#4a4e52',
    mid:    '#707478',
    shadow: '#202428',
    glass:  'rgba(20,60,90,.5)',
    rim:    '#242428',
    label:  'Sterling Gray',
  },
  blue: {
    body:   '#1a4a88',
    dark:   '#0c2448',
    mid:    '#143870',
    shadow: '#080e1e',
    glass:  'rgba(20,70,110,.55)',
    rim:    '#1c1c24',
    label:  'Riptide Blue',
  },
  gray: {
    body:   '#686a6e',
    dark:   '#383a3e',
    mid:    '#505254',
    shadow: '#181a1e',
    glass:  'rgba(20,55,85,.5)',
    rim:    '#222224',
    label:  'Gray',
  },
  midnight: {
    body:   '#12204a',
    dark:   '#080e28',
    mid:    '#0e1838',
    shadow: '#040810',
    glass:  'rgba(10,40,80,.6)',
    rim:    '#141420',
    label:  'Midnight Blue',
  },
  green: {
    body:   '#3a6a30',
    dark:   '#1c3a18',
    mid:    '#2e5228',
    shadow: '#0e1a0c',
    glass:  'rgba(15,55,40,.5)',
    rim:    '#1a221a',
    label:  'Cacti Green',
  },
};

window.EV_COLORS.getPalette = function(colorKey) {
  return window.EV_COLORS[colorKey] || window.EV_COLORS.red;
};

/**
 * Status rules (dealership definition):
 *   ≥ 30%          → Full / Ready    (#818cf8 indigo)
 *   10% – 29%      → Charging        (#22c55e green)
 *   < 10%          → Critical / Low  (#ef4444 red)
 *
 * The "charging" glow on the lot floor only shows while startPct < endPct,
 * regardless of status colour.
 */
/**
 * Status is based on ENDING SOC (the target/charged state):
 *   endPct >= 30  → Ready / full (indigo)
 *   endPct < 10   → Critical (red)
 *   else          → Charging / in progress (green)
 */
window.EV_COLORS.getStatusColor = function(startPct, endPct) {
  const soc = (endPct !== undefined) ? endPct : startPct;
  if (soc >= 30) return '#818cf8'; // ready for sale
  if (soc < 10)  return '#ef4444'; // critical
  return '#22c55e';                 // still charging
};

/**
 * Calculate kWh delivered automatically.
 * 2027 Bolt EUV usable battery = 65 kWh (net).
 * Formula: kWh = (endPct - startPct) / 100 × batteryCapacityKwh
 */
window.EV_COLORS.BOLT_BATTERY_KWH = 65;

/**
 * calcKwh(startPct, endPct, batteryPackMultiplier)
 * batteryPackMultiplier = the value from column D in your sheet (e.g. 0.66)
 * Actual usable capacity = 65 kWh × batteryPackMultiplier
 * If no multiplier provided, defaults to 0.66 (typical Bolt EUV pack health)
 */
window.EV_COLORS.calcKwh = function(startPct, endPct, batteryPackMultiplier) {
  const pack     = (batteryPackMultiplier && batteryPackMultiplier > 0 && batteryPackMultiplier <= 1)
                   ? batteryPackMultiplier : 0.66;
  const capacity = window.EV_COLORS.BOLT_BATTERY_KWH * pack;
  const delta    = Math.max(0, endPct - startPct);
  return Math.round((delta / 100) * capacity * 10) / 10;
};

// VIN prefix → make lookup (top 30 EV brands + common)
window.VIN_MAKES = {
  '1G1':'Chevrolet','1G4':'Buick','1G6':'Cadillac','1GC':'Chevrolet','1GT':'GMC',
  '2GT':'GMC','1GY':'GMC','5YJ':'Tesla','7SA':'Tesla','5YX':'Tesla',
  '1FA':'Ford','1FB':'Ford','1FC':'Ford','1FT':'Ford','1LN':'Lincoln',
  '1N4':'Nissan','JN1':'Nissan','JN8':'Nissan',
  'WBA':'BMW','WBS':'BMW','WBY':'BMW',
  'WDB':'Mercedes-Benz','WDD':'Mercedes-Benz',
  'WAU':'Audi','TRU':'Audi',
  'WVW':'Volkswagen','WV2':'Volkswagen',
  'KNA':'Kia','KND':'Kia','KNM':'Kia',
  'KMH':'Hyundai','KMF':'Hyundai','5NM':'Hyundai',
  'JT2':'Toyota','4T1':'Toyota','4T3':'Toyota','JTH':'Lexus','JTD':'Toyota',
  'SAL':'Land Rover','SAJ':'Jaguar',
  'YV1':'Volvo','YV4':'Volvo',
  'ZFF':'Ferrari','ZAR':'Alfa Romeo',
  'SCA':'Rolls-Royce',
  '7FC':'Rivian','1FU':'Rivian',
  'VF3':'Polestar','YS3':'Polestar',
};
