# OLD ADAM

A 20-year settlement survival and happiness simulation built with Vue 3 and Vite.

The central question is whether public systems can reliably provide water, food, and energy to
everyone. These universal basic services are essential infrastructure for a healthy, thriving
country—not charity or rewards people must earn through work.

## Play

```sh
npm install
npm run dev
```

Advance one day or one week. Every simulated day resolves resource production and consumption,
population health, happiness, births, mortality, construction, facility maintenance, and
daily material deliveries. Build a shopping list of facilities with the quantity sliders (each is
limited by the materials left after your other choices) and confirm it with one build button; each
project reserves its materials immediately and progresses in parallel. Keep an
eye on how many days each resource can last.

Use the water, food, and electricity ration sliders to change each person's daily allocation. The
recommended amount is the minimum; rations start 10% above it and can go higher (food has the
lowest upper limit). Higher water and food rations consume more stock; higher electricity rations
require more generation. Use the time slider to advance 1–30 days at once.

The Bancor market lets you sell surplus water, food, fossil fuels, or construction materials and
buy them back when supplies are short. Power stations generate electricity to meet each day's
demand. Coal- and gas-fired stations burn fossil fuel (measured in gigajoules) straight from the
shared materials stock; extraction sites mine it from finite domestic deposits, burned fuel is
gone for good, and imported fuel can be
bought through Bancor. The market starts at zero, allows up to 1,000 Bancor of debt, and charges a
small daily fee on balances above a 10,000 Bancor allowance. Market prices use fixed gameplay
rates with a buy/sell spread; see
`BANCOR_TRADE_GOODS` in `src/game.js` to tune them. Two geopolitical shocks occur between years
8.5–11.5 and 13.5–16.5; each permanently raises all market prices by 25%.

The settlement starts with 540 days (1.5 years) of food and water, and both can be stored up to
that amount. Starting power stations are mostly fossil-fuel plants. Extraction sites mine fuel
from finite domestic deposits; where extraction cannot keep
up with station use, imports are needed to sustain full power output. Build surface-water
collectors, groundwater wells, or desalination plants to expand water production.

Food production options include controlled-environment greenhouses, mechanized field crops,
poultry, and recirculating aquaculture. Materials facilities represent scrap sorting, recycling,
e-waste recovery, steel scrap melting, and quartz processing. Material producers add recovered
materials each day; the scrap sorting yard costs fewer than 10 components to build. These are
gameplay-scale abstractions of real production methods, not real-world facility output estimates.
Facility upkeep is tracked by material. Shortfalls reduce each affected facility's efficiency
gradually, and efficiency recovers gradually when its maintenance can be paid again.

The simulation ends in collapse if population or health reaches zero, or in survival after 20
years. Its starting stocks, production, building recipes, and rates are gameplay defaults rather
than values specified by the design document; construction recipes and delivery values are stored
in `src/construction_data.json`, while simulation rules are in `src/game.js`.
The dashboard's public service record tracks days when each essential service, and all three
together, met baseline needs. It also reports population kept, people-weighted coverage, lives
lost, average happiness and stability. Reaching year 20 only counts as keeping the guarantee if
at least 90% of the starting population is alive and at least 95% of person-days were fully
covered; otherwise the run is reported as "20 years reached, guarantee failed". Stability rises
while needs are met and falls sharply on shortfalls, boosting health recovery and births.

Starting water and food stocks and storage capacity are scaled to population needs. Production
comes from facilities: each facility has fixed output and energy use regardless of settlement
population, and there is no passive per-person production. Each difficulty starts with prebuilt
infrastructure, with most starting power stations burning fossil fuels, but it does not cover
every need. Larger populations therefore need more facilities to meet the same per-person demand.
Power-plant ratings and burn rates are explicit gameplay assumptions in
`src/construction_data.json`: a 50 MW coal station, a 25 MW gas station, a 1 GW nuclear reactor,
a 10 MW hydro site averaging 45% capacity, and a 5 MW geothermal plant averaging 90% capacity.
Hydro output follows a yearly river cycle (±40%, peaking in spring) and drops 40% in three random
drought years; its reservoir adds water storage, and it is costly and slow to build but cheap to maintain.
Geothermal is steady and costly to maintain. Some facilities also amplify others through a `boosts` field
in `construction_data.json`: each working booster adds its bonus to every facility of the target type
(there is no overall cap; boosters with a `boostFalloff`, such as wind and hydro, diminish with each extra
copy, while food boosters stay linear). Geothermal heat boosts greenhouses (+5% each), hydro irrigation and poultry
manure boost crop farms (+3% / +2%), fish-farm water boosts greenhouses (+3%), scrap yards boost arc
furnaces (+5%) and e-waste workshops boost quartz works (+5%). Boosts apply to recycling and mining
capacity as well as production. Both plants are limited by
per-difficulty site caps (`buildingLimits` in `difficulties.json`), which also cover plant conversions.
Each prebuilt fossil-fuel extraction site can supply up to 22,320 GJ per day from finite reserves;
the starting fleets include two sites in Survival, one in Emancipation, and three in Vanguard.
From the infrastructure list, operating coal and gas stations can be converted to nuclear, hydro,
or geothermal plants. Conversion costs half the target facility's construction materials and takes
the target's listed build time; the existing station continues operating until conversion finishes.
The assumed full-output fossil burn rates are about 0.5 kg of coal or 0.18 m³ of natural gas per
kWh; actual plants vary by fuel quality and efficiency, so these are representative rather than
site-specific engineering data.

Use **Save game** to download the settlement as a binary `.oasave` file and **Load game** to
restore one (format: magic header, version, length and CRC-32 checksum; see `src/save_manager.js`).
Corrupted or non-save files are rejected without changing the current game.

## Structure

- `src/save_manager.js` encodes and decodes binary save files.
- `src/game.js` contains simulation state and daily game rules.
- `src/time_manager.js` advances the calendar and invokes daily simulation ticks.
- `src/construction_data.json` contains editable facility recipes and material delivery amounts.
- `src/construction_manager.js` loads that data and handles construction, production, and upkeep.
- `src/components/LineChart.vue` is a reusable SVG line chart for numeric x-values and one or more data series.
- `src/App.vue` displays the current simulation state and forwards player actions to the game.

`LineChart` accepts `x` values, `series` entries shaped as `{ key, label, color, unit, values }`,
and optional `domain`, `xTicks` (`{ value, label }`), `formatValue`, `formatX`, `valueSuffix`,
and `aria-label` props. Series values correspond by index to the x-values.

## Build

```sh
npm run build
```

### GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and deploys the game when changes
are pushed to `main`. In the repository's **Settings → Pages**, set the build and deployment
source to **GitHub Actions**. The workflow can also be started manually from the Actions tab.
GitHub Pages for a private repository requires an eligible GitHub plan; a published Pages site
is publicly accessible even when its source repository is private.
