# Bridge Deterioration Model

A static website for exploring bridge element condition-state profiles by bridge age. It
uses National Bridge Inventory (NBI) element data, prepared into small JSON files. There
is no database, no server code and no build step, so it runs on the Vercel Hobby plan.

## The four steps

1. **State.** A US map coloured in seven bands by the number of bridges with element data.
   Small states and territories (VT, NH, MA, RI, CT, NJ, DE, MD, DC, HI, PR, GU) are also
   offered as buttons. States without data are hatched. The "Every bridge" switch above the map
   shows one dot per bridge instead (see "Every bridge view" below).
2. **Period.** Any start and end year, as long as the period holds at least 5 data years
   (for 2016–2025 states that is 21 possible periods). Click a year bar to move the nearer
   end of the period there, use the start/end lists, slide the whole period with
   Earlier/Later, or use the Latest 5 years / All years buttons. The default is the latest
   5 years. A state with 5 or fewer data years uses all of them. The bar chart shows how
   many bridges have records in each year.
   **Switching state starts afresh.** Picking a state on the map, a button or the list
   resets the period to the latest 5 years, clears the analysis level, the element type, the
   element search and the category filter, and returns the z-axis to Non-normalized and the analysis to Basic
   Insights (`resetFilters()` in `index.html`). Links that name a period and element, such
   as `/#/TX/2016-2025/107`, still open exactly that.
3. **Analysis level.** Two cards (`.lvl`, `selectLevel()` in `index.html`):
   - **Element type analytics** opens the element type list below the cards: every element
     type with records in that state and period, grouped by category, with a search box and
     the number of bridges.
   - **Bridge level analytics** needs nothing more. No element type is selected at this level:
     the health scores use every element type on every bridge (choosing it clears any element
     type picked before).
4. **Analysis.** Both levels open with the bridge locations map (see below). Then:
   - at element type level, three tabs: Basic Insights, Basic Analytics and Advanced Analytics
   - at bridge level, Basic Analytics (Bridge Level) as the only view

   The views in detail:
   - **Basic Insights (Element Type Level):** four 3D bar charts (CS1 Good, CS2 Fair, CS3 Poor, CS4 Severe).
     The floor axes are bridge age (5-year bands, 1–100) and CS% (5% bands). The z-axis
     (deck area) can be **non-normalized** (sq ft) or **normalized** (%), either by all
     deck area in the profile (each chart adds up to 100%) or by each age band (each age
     band adds up to 100%). Drag to rotate all four charts; hover a bar to see its values
     and highlight that age band. There is an age-band table and a CSV download.

     Below them, **Bridges by condition-state range** (drawn by `public/csdist.js`):
     - *Distribution*: four small histograms, one per condition state, of the share of
       bridges by how much of the element quantity is in that state: exactly 0% (gray bar),
       >0–5%, >5–10% … >95–100%. Each chart has its own y-axis. When the 0% bar is taller
       than the axis it is drawn with a white break and its value is printed beside it.
     - *More than x%*: one chart with a line per condition state, showing the share of
       bridges with more than x% of the element in that state (x = 0, 5 … 95).
       **Switched off for now:** set `SHOW_MORE_THAN = true` in `public/index.html` to bring
       back the View switch and this chart.
     - *Measure*: % of bridges, or % of deck area (each bridge weighted by its deck area,
       as in the 3D charts).
     - *Bridge age*: all ages, or one 5-year age band.
     - Hover for exact counts and deck area; Download CSV gives the table for the current
       age filter. Picking a new state resets these controls.
   - **Basic Analytics (Element Type Level):**
     1. **CS1 → CS2: time in the best condition state (Weibull)** (`public/weibull.js`).
        For each 5-year age band, the observed share of the element quantity still in CS1
        (sum of CS1 quantity ÷ sum of total quantity over the band's bridges), plotted at the
        band midpoint (3, 8 … 98 years). A Weibull survival curve
        S(t) = exp(−(t/η)^β) is fitted to these shares by maximum likelihood (binomial,
        each band weighted by its number of bridges, Nelder–Mead on log β and log η).
        Shown: median time in CS1 (η·(ln 2)^(1/β); "Beyond 100 years" when the fit puts it
        past the data), share still in CS1 at age 50, shape β, scale η, the chart with the
        median marked, a "How this is calculated" list directly below the chart, a table by
        age band, and a CSV. Warnings appear for fewer than 3 age
        bands, fewer than 20 bridges, or when nothing has left CS1.
     2. **CS2 → CS3 → CS4: movement to worse condition states (Markov)** (`public/markov.js`).
        A yearly Markov chain on the share of element quantity in CS1–CS4, starting all in
        CS1 when new. CS1 → CS2 uses the Weibull curve above (yearly chance at age a =
        1 − S(a+1)/S(a)). CS2 → CS3 and CS3 → CS4 have one yearly chance per 20-year age
        category (1–20 … 81–100), giving one transition probability matrix (TPM) per
        category. These are fitted by maximum likelihood (multinomial) so the predicted
        CS1–CS4 mix matches the observed mix in each 5-year age band, each band weighted by
        its bridges, with a small penalty on jumps between neighbouring categories
        (Nelder–Mead in logit space; chances kept between 0.001% and 50% a year).
        Shown: the three yearly chances at ages 41–60, the fit error, a chart of the yearly
        chances by age category, a table by category, the 4×4 TPM for a chosen category, a
        chart of predicted against observed shares by age, a "How this is calculated" list,
        a table by age band and a CSV.
     3. CS quantity propagation: still to come.
   - **Basic Analytics (Bridge Level):** health scores for whole bridges, from
     `data/<ST>/health.json.gz` (loaded when bridge level is first opened).
     1. **Health score by data year.** Each bridge gets a score from 0% to 100%: element score
        = 100 × (CS1 + 0.67 CS2 + 0.33 CS3) ÷ total quantity, and the bridge score is
        Σ(quantity × unit cost × element score) ÷ Σ(quantity × unit cost) over its element
        types. The NBI has no unit costs, so the defaults are placeholders: $40 per sq ft,
        $1,200 per ft and $16,000 each. Visitors can change them in the **BHI unit costs** bar
        above the bridge level map (see "Health scores" below). For each data year, the chart shows the average score of every bridge
        with a score that year, and a shaded band for the interquartile range (25th to 75th
        percentile, so half of those bridges score inside it), with a hover box per year. **Find a bridge** adds that bridge's
        own line. Key findings, a facts line, and a note when a year has far fewer bridges
        than the state's other years (under 60% of the usual count, such as Texas 2017).
        Download CSV lists every bridge and data year of the period: structure number, year
        built, age, score (%) and element types counted. Drawn by `renderBridgeTab()` /
        `drawHealth()` in `public/index.html`. The same scores show in the bridge map's hover
        box (see below).
     2. **Health score forecast.** Where the scores are heading over the next 10 years if no
        repairs are made. Every element on the bridges with a score in the period's last data
        year starts from its condition in that year and ages one year at a time with
        Prediction Methods #1 and #2, fitted to the state's data for the selected period as in
        Basic Analytics (Element type level). The chart continues section 1's average and
        interquartile range as a dashed forecast in a shaded zone, with a hover box per year.
        A bridge picked with **Find a bridge** in section 1 gets its own forecast line and a
        line of text. A **back-check** starts the same forecast at the period's first year
        and shows it in its own small chart under the forecast chart, next to the actual
        average of the same bridges, with two key findings. Key findings (average, share below 70%, share at 95% or more, median and
        5th percentile in the last forecast year), a facts line, and a CSV with one row per bridge (score in the last
        data year, then the forecast for each of the next 10 years). New unit costs rescore
        the forecast too. The note under the chart on the share of element quantity kept as it is
        is hidden at Alvin's request (25 Nov). One line in `renderForecast()` brings it back.
        Drawn by `renderForecast()` / `drawForecast()` in
        `public/index.html`, modelled by `public/forecast.js` (see "Health score forecast"
        below).
     3. **Average health by age.** One bar per 5-year age band (1–5 … 96–100 years, the same
        bands as Basic Insights): the average health score of the bridges with a score in the
        period's last data year, at their age in that year (that year − year built, from
        `health.json`). A line on each bar spans the interquartile range, and a dashed line
        marks the average of all these bridges. Bridges older than 100 years, built in that
        year or later, or with no year built are left out and counted in the facts line. Hover
        a band for its average, interquartile range, median, 5th percentile and bridge count.
        Key findings: the highest and lowest band, ages 1–20 against 81–100 (61–80 when fewer
        than 10 bridges are 81–100), and the share and average of bridges older than 50 years.
        A picked bridge (Find a bridge) shows as an orange square beside its age band, with a
        line of text. CSV: one row per age band. The scale starts a little below the lowest
        value shown, on a multiple of the grid step, so small differences stay visible.
     4. **Health by age (3D).** The same bridges, counted by age band and 5-point score band
        (0% to below 5% … 90% to below 95%, then 95% to 100%, closed at the bottom like the map's
        bands), drawn with `profile3d.js` like Basic Insights. Bar height is the number of
        bridges, or each bar's share of its age band ("Share of each age band (%)"). Drag to
        rotate, hover a bar for its counts and to highlight its age band, Reset view. Key
        findings: the shares at 95% or more and below 70%, the age band where scores below 70%
        are most common, and the age band with the most bridges. A picked bridge's bar is
        outlined in orange. CSV: one row per bar.
        Sections 3 and 4 are worked out together by `healthByAge()` in `public/index.html`
        (drawn by `drawAgeAvg()` and `drawAge3D()`) and follow the unit costs.
     5. Trend (improved, steady, declined): still to come.
   - **Advanced Analytics:** placeholder. The element type tabs are filled by
     `renderBasicAnalytics(ctx)` and `renderAdvancedAnalytics(ctx)` in `public/index.html`,
     which run whenever the selection changes; `ctx` (documented above the functions)
     carries the state, period, element, the period data (including CS quantities by age
     band) and the decoded profile.

Selections are kept in the URL (`writeHash()` and `route()` in `index.html`):
- `/#/TX/2016-2025`: state and period, no analysis level yet
- `/#/TX/2016-2025/element`: element type analytics, no element type yet
- `/#/TX/2016-2025/107`: element type 107, with an optional fourth part for the tab, such as
  `/#/TX/2016-2025/107/analytics`
- `/#/TX/2016-2025/bridge`: bridge level analytics

Older links of the form `/#/TX/2016-2025/107/bridge` open bridge level.

## How the profiles are computed (`scripts/prepare_nbi.py`)

Only data years from **2016** onwards are used (`MIN_YEAR` in the script); 2015 is dropped
because it is too sparse.

For each state × element type × period:
- Each bridge counts **once**, at its **latest data year inside the period**. A bridge is
  identified by state + structure number with spaces and leading zeros removed: some states
  report the same bridge as `000037SR0010004` in one year and `37SR0010004` in another.
  Where both spellings occur in the **same** year they are two bridges (64 cases, nearly all in
  MN: `02585` and `2585` are 120 km apart), and those keep their leading zeros.
- Where the element data has two records of the same bridge, element and year, the one with a
  positive and larger quantity counts (further ties go by the CS figures), so a rebuild from
  the same input files gives byte-identical data.
- Age = `BRIDGE_AGE_YEARS` at that year (data year − year built).
- CSk share = CSk / TOTALQTY × 100. Bins: age 1–5 … 96–100; CS% [0,5], (5,10] … (95,100].
- Each cell stores the summed deck area (sq ft) and the number of bridges.
- Missing ages and deck areas are filled from the NBI inventory when its folder is given
  (`scripts/nbi_inventory.py`): age = data year − year built (item 27), deck area = structure
  length × deck width (items 49 × 52, the export's own formula); otherwise from the same
  bridge's other years. Values the export already has are never changed.
- Records are excluded, and counted, for: no element quantity, a failed quantity check, no
  deck area, no year built, or an age outside 1–100.
- All figures on the page are shown to 3 significant figures.

## Layout

```
public/
  index.html            the site (HTML, CSS and app script)
  profile3d.js          3D bar chart renderer (SVG, drag to rotate), for Basic Insights and the
                        bridge level "Health by age (3D)"
  csdist.js             condition-state range histograms and "more than x%" curves (SVG)
  weibull.js            CS1 → CS2 Weibull fit and chart (also runs in Node for testing)
  markov.js             CS2 → CS3 → CS4 Markov fit, TPMs and line charts (also runs in Node)
  forecast.js           health score forecast: fits both methods per element type and steps
                        every element ahead (also runs in Node for testing)
  bridgedots.js         "Every bridge" view of the step 1 map (projection, insets, dot drawing)
  bridgemap.js          bridge locations map at the top of step 4 (Leaflet)
  mapconfig.js          your map settings: CARTO key, credits, state border (left out of updates)
  vendor/leaflet/       Leaflet 1.9.4 (BSD-2-Clause licence inside)
  geo/states.json.gz    state outlines (US Census via us-atlas), drawn on the bridge map
  usmap.js              US state shapes (us-atlas, ISC licence, notice inside)
  assets/               logo
  data/                 every file is gzip-compressed JSON (<name>.json.gz)
    index.json.gz       jurisdictions, data years, bridge counts
    all-bridges.json.gz every bridge with a position, for the "Every bridge" view (about 290 KB)
    <ST>/index.json.gz  the state's periods, bridges per year, element types and bridges per period
    <ST>/<EN>.json.gz   one element type: profile cells, >0–5% counts and CS quantities by age
                        band, grouped by end year and record year
    <ST>/bridges.json.gz  every bridge in the element data: position and the years it is in the
                        NBI inventory and in the element data (see "Bridge positions" below)
    <ST>/loc/<EN>.json.gz  the bridges with that element and their record for every data year,
                        for the bridge map (see "Bridge locations map" below)
    <ST>/health.json.gz every bridge's health score for each data year, for Basic Analytics
                        (Bridge Level) (see "Health scores" below)
    <ST>/fit.json.gz    the inputs of Prediction Methods #1 and #2 for every element type (each
                        element file's CS quantities by age band) and its unit, for the health
                        score forecast (Texas about 81 KB, all states about 2.4 MB)
scripts/
  prepare_nbi.py        builds public/data/ from the NBI export (and the NBI inventory, if given)
  nbi_inventory.py      reads the NBI inventory files: positions, year built, deck area
  health.py             bridge health scores per data year (health.json)
  geo/states-10m.geojson  state outlines (US Census via us-atlas) for checking positions
vercel.json
```

The data files are stored gzip-compressed: about 64 MB across roughly 7,790 files (the
`loc/` files for the bridge map are about 25 MB of that), well inside the Hobby plan's 100 MB limit for static files. The site asks
for `<file>.json.gz` and unpacks it in the browser with `DecompressionStream`
(`loadJSON()` in `index.html`; current Chrome, Edge, Firefox and Safari). If a server
unpacks the file itself (`Content-Encoding: gzip`), the site reads it as plain JSON.
`vercel.json` serves the `.gz` files as `application/gzip`. To look inside a file:
`python -c "import gzip,json,sys; print(json.dumps(json.load(gzip.open(sys.argv[1])), indent=1)[:2000])" public/data/TX/index.json.gz`.

Each `<EN>.json.gz` is at most about 105 KB, and the browser
loads only the file for the element type you select.

Periods are not stored one by one (21 periods per state would be about 160 MB). Instead,
`<EN>.json` has `ends[e][g]`: for each valid end year `e`, the bridges whose latest record
up to `e` is from year `g`. The latest record inside a period `[s, e]` is the latest
record up to `e` whenever it is from year `s` or later, so the browser builds any period
by adding up `ends[e][s]` … `ends[e][e]` (`periodData()` in `index.html`). The result is
identical to computing the period directly.

Each group `ends[e][g]` is a list, in the order given by the file's `groupFields`:
`[bridges, deckArea, excluded, cells, low, qty]` (names are not repeated in every group, to
save about 6 MB). `excluded` is `[no_quantity, quantity_check, no_deck_area, no_age,
age_out_of_range]`, or `0` when nothing was left out. `qty` holds flat 6-tuples per age band
`[ageBin, bridges, qCS1, qCS2, qCS3, qCS4]`: the element quantity in each condition state,
in the element's unit, for the analytics.

Cells are stored as flat triples `[code, deckAreaSqFt, bridges]`, where
`code = (cs − 1)·400 + ageBin·20 + csBin`. CS% band 0 is [0, 5] and so holds both the
bridges with exactly 0% and those with >0–5%. To split them, each group also has `low`:
triples `[code, deckAreaSqFt, bridges]` with `code = (cs − 1)·20 + ageBin` for the bridges
with >0–5% only. The 0% count is CS% band 0 minus `low`. (`low` is stored instead of the
zeros because it is much smaller: most bridges have no CS3 or CS4, so storing the zeros
would have added about 19 MB.)

## Updating the data

```
pip install duckdb shapely
python scripts/prepare_nbi.py path/to/summary_states_nbi_data.zip path/to/nbi_inventory
```

On Windows: `py -m pip install duckdb shapely`, then
`py scripts\prepare_nbi.py "C:\path\to\summary_states_nbi_data.zip" "C:\path\to\nbi_inventory"`.

The first argument is the element export (zip or extracted folder); the script reads
`<STATE>/bridge_element_yearly.csv` only (the `by_element/` files hold the same rows and are
ignored). The second, optional argument is the NBI inventory folder: one sub-folder per year
(`2015/` … `2025/`) holding the FHWA delimited state files such as `2025/TX25.txt`. Without
it, no `bridges.json` is written and missing ages and deck areas stay missing.

The script replaces everything in `public/data/` and takes about 4–5 minutes with the
inventory. The database part uses up to 40% of the machine's RAM (between 3 and 8 GB); if it
stops with "Out of Memory", set a higher limit first, for example in PowerShell
`$env:NBI_MEMORY_LIMIT = "6GB"`, and run it again. Commit the new `public/data/` and push
(`git add -A public/data` so that removed files are removed in git too).

## Every bridge view (step 1, `bridgedots.js`)

The switch above the state map changes "Bridges per state" (the default) to "Every bridge": one
dot per bridge with element data and a usable position (294,373), coloured by the latest year it
appears in the element data (2025, 2022 to 2024, 2019 to 2021, 2016 to 2018). The data file loads
only the first time the view is opened. States without element data get red stripes, a "No data"
label and a note beside the map. Puerto Rico and Guam, which the map's projection leaves out, get
two small insets that select the territory when clicked. Hovering a state adds how many of its
bridges are on the map and how many have data up to 2025.

The dots use the same projection as the state shapes in `usmap.js` (Albers USA, scale 1300,
centre 487.5, 305), written out in `bridgedots.js` and checked against the d3-geo library on every
bridge. They are painted once at the map's size on screen (about 45 ms on a laptop) and again only
when the map's width changes. The coverage differs a lot between states: element data is required
for National Highway System bridges, and some states report it for every bridge.

`all-bridges.json.gz` (written by `nbi_inventory.write_national`): `first` (first year with
element data), `states` and `count` (bridges per state, in order), `lon` and `lat` (degrees × 100,
delta-encoded over the whole list, grouped by state then sorted west to east) and `last` (latest
year with element data minus `first`). Positions are rounded to 0.01 degree, about 1 km, which is
finer than a pixel at national scale.

## Health scores (`<ST>/health.json.gz`, `scripts/health.py`)

Written with the inventory folder, one file per state (Texas: about 1.1 MB, 36,455 bridges;
all states about 11.3 MB, so the data folder is about 61.5 MB).
An element record counts when its total quantity is positive and it has not failed the quantity
check, the same records the charts use. Deck area and age are not needed for the score.

The bridge score follows Alvin's formula Σ(Qₑ × cₑ × EHIₑ) ÷ Σ(Qₑ × cₑ), where Qₑ is the
element's total quantity, cₑ its unit cost and EHIₑ its element score. Since EHIₑ divides by
Qₑ, Qₑ × EHIₑ = 100 × (CS1 + 0.67 CS2 + 0.33 CS3). The score is a percentage rounded to 0.1.

**Unit costs.** One cost per unit of quantity: sq ft, ft and each. The NBI has no unit costs, so
the defaults are placeholders (`UNIT_COST_BY_UNIT` in `scripts/health.py`, also `COST_DEFAULT`
in `index.html`):

| Unit | Placeholder cost | Typical element in 2025 (median) | Typical weight |
| --- | --- | --- | --- |
| sq ft | $40 | 5,100 sq ft | about 204,000 |
| ft | $1,200 | 162 ft | about 194,000 |
| each | $16,000 | 12 each | about 192,000 |

The costs follow the typical element size in each unit, so a typical element weighs about the
same whatever its unit, and a bigger element weighs more than a smaller one in the same unit.
Shares of the weight now roughly follow shares of the records. In Texas (2025), elements in ft
are 62% of records and 71% of the weight, "each" 22% and 16%, sq ft 16% and 14% (Minnesota: ft
56% and 65%, sq ft 26% and 24%, each 17% and 11%). With every cost at 1, sq ft elements take
85% of the Texas weight and 92% in Minnesota.

**Changing the costs on the site.** At bridge level, the **BHI unit costs** bar above the map
shows the costs in use, marked "placeholders" or "your costs". "Change" opens three inputs ($ per
sq ft, $ per ft, $ each). "Apply" rescores every bridge, then redraws the chart, key findings,
facts, map colours, legend counts and hover boxes. Every cost must be above $0. "Reset to
placeholders" goes back to the defaults. A visitor's costs apply to every state, including the
bridge health score in the element type level hover box, and are kept in their browser
(`localStorage` key `bhiUnitCosts`). They are not part of the link, so a shared link always
opens with the costs of whoever opens it.

**How the browser rescores.** With one cost per unit, a bridge's score only needs two totals per
unit u: Q_u, the total quantity of its elements in that unit, and N_u = Σ(100 CS1 + 67 CS2 +
33 CS3) over those elements. Then score = Σ(c_u × N_u) ÷ Σ(c_u × Q_u). NBI quantities are whole
numbers, so Q_u and N_u are whole numbers too. `healthScores()` in `index.html` works this out
in double precision, the same way as `bridge_score()` in `scripts/health.py`, so the browser
gets exactly the same score as the script for any costs. All states loaded so far are rescored
when the costs change (a few milliseconds for Texas).

**Units.** A record with no unit takes its element type's usual unit. Fifteen element types
never have a unit (2,380 records, mostly agency elements 600 to 610 in one state, plus a few
approach slabs, 321). No unit cost can apply to them, so they are left out of the BHI. At a cost
of 1 they carried almost no weight anyway: 4 of the 2,134,329 bridge-year scores move by 0.1
(3 in Minnesota, 1 in Alaska), and no bridge loses its score.

Columns:
`base` (first data year), `units` (`["sq ft", "ft", "each"]`), `cost` (the default cost per
unit, same order), `row` (each bridge's row in `bridges.json`, delta-encoded), `yb` (year
built, 0 if unknown), `nrun` (runs per bridge), and per run of consecutive data years with the
same element count and per-unit totals: `yy` (first year × 100 + last year, as offsets from
`base`), `ne` (element types counted), `q` (one list per unit: Q_u, 0 when none) and `n` (one
list per unit: N_u). Sums are exact, so the file is identical byte for byte whenever the input
is. Checks at the default costs: Texas 2016–2025 averages 95.8% in 2016 and 96.4% in 2025 (all
bridges with a score each year), median 98.2% and 5th percentile 86.8% in 2025. Minnesota
bridge L5920 scores 40.3% in 2025. At costs of 1, 1, 1: Minnesota 2016–2025 94.5% → 89.5%,
L5920 27.2%.

## Health score forecast (`forecast.js`, `<ST>/fit.json.gz`)

Section 2 of Basic Analytics (Bridge Level). It answers: if no repairs, rehabilitation or
replacement are made, where are this state's health scores heading over the next 10 years?

**Models.** For every element type of the state, `FC.fitElement()` fits Prediction Method #1
(time in CS1) and Prediction Method #2 (CS2 → CS3 → CS4) with exactly the same inputs as Basic
Analytics (Element type level): the element quantity in CS1 to CS4 per 5-year age band, for the
selected period. These come from `<ST>/fit.json.gz`, which holds just those lists for every
element type, so one small file replaces loading every element file. An element type keeps its
condition (no model) when the period has fewer than 20 bridges with it, fewer than 3 age bands,
none of it has left CS1, or Prediction Method #2 cannot be fitted. Fitting takes about 1.4 s for
Texas and runs in short steps, so the page stays responsive. A progress line shows meanwhile.

**Start.** The forecast covers every bridge with a health score in the period's last data year
E (Texas 2016–2025: 18,243 bridges). Each of its element records in year E
(`<ST>/loc/<EN>.json.gz`) starts from its CS1 to CS4 quantities at its age in E. These are the
same records the health score counts: positive quantity, quantity check passed, and a unit. An
element with no year built takes the bridge's year built from `health.json`, and an element of
unknown age keeps its condition.

**Stepping.** Each year, the element ages by one year, in the same way as `propagate()` in
`markov.js`:
- CS1 → CS2 with chance p12(a) = 1 − S(a+1) ÷ S(a), from Prediction Method #1
- CS2 → CS3 with chance p23, and CS3 → CS4 with chance p34, of the element's 20-year age group,
  from Prediction Method #2 (ages over 100 use the 81–100 group)

where a is the element's age in that year. Nothing moves back to a better state, so a forecast
score never goes up.

**Scores.** For each bridge, year and unit, the forecast keeps N = Σ(100 CS1 + 67 CS2 + 33 CS3)
and the total quantity Q, like `health.json`, so new unit costs only rescore it. The loc files
keep CS shares in steps of 0.1% and quantities to 3 significant figures, so the score rebuilt
from them (F₀) is close to, but not exactly, the bridge's health score (Texas: 0.03 points apart
on average, at most 0.13). The forecast therefore adds the predicted change to the exact score:
forecast in year E + k = score in E + (F_k − F₀), rounded to 0.1 like the health scores. One
forecast is kept per state and period (the last four), about 5 MB in memory for Texas.

**Back-check.** The same forecast also starts at the period's first year (with any bridges),
even when section 1 flags it as thin, so the start is never in doubt (Alvin, 25 Nov). It follows
one fixed set of bridges, those with a score in
both that year and the last year, so the set never changes from year to year, and compares the
average predicted score with the average actual score of those bridges each year
(`FC.backcheck()`). It has its own small chart under the forecast chart (`drawBackcheck()`,
Alvin, 25 Nov), titled with the number of bridges, because it follows a different set of bridges
from the forecast chart's average line, which counts every bridge with a score each year. In
Minnesota 2016–2025 that average jumps from 1,995 bridges in 2017 to 13,299 in 2018, so the two
cannot be read against each other. Both lines are teal: actual solid with filled dots, predicted
dashed with open dots, the gap between them lightly shaded, the 2025 values written at the line
ends, and a hover box per year with the number of bridges and the difference in points. Two key
findings give the numbers and a reading: "fell faster than predicted, so this forecast may be
optimistic", "stayed higher than predicted, as repairs would explain", or "tracks closely" (a
gap of more than 0.2 points decides). The models are fitted to the same period, so this checks
how well they reproduce history, not an independent test. A fixed set matters: Texas reported
31,058 bridges in 2016 but only 13,273 of them by 2025, and a changing set made the prediction
seem to rise. A thin first year gives a small set: Minnesota 2016 holds only 1,257 bridges, of
which 1,140 also have 2025 data. Checks (2016–2025, default costs): Minnesota, 1,140 bridges from
2016, 94.2% → predicted 92.2%, actual 88.4%. Texas, 13,273 from 2016, 96.8% → 96.2%, actual 95.9%.
New York, 116 from 2016, 89.2% → 87.3%, actual 86.0%. Minnesota 2021–2025, 13,061 from 2021,
89.6% → 88.5%, actual 87.9%. The same numbers come from Node.

**Checks** (default unit costs, 2016–2025, from 2025 to 2035): Texas 96.4% → 95.8%, share below
70% 0.84% → 0.95%, median 97.6% and 5th percentile 85.8% in 2035, 0.18% of the weighted element
quantity kept as it is. Minnesota 88.4% → 85.8%, below 70% 15.7% → 17.5% (4.1% kept). Delaware
92.1% → 90.9% (19.4% kept, since many of its element types have fewer than 20 bridges).
California 95.8% → 95.2%. The same numbers come from Node (`forecast.js` runs there too).

## Bridge locations map (top of step 4, `bridgemap.js`)

Step 4 opens with the map at both analysis levels. The colour buttons depend on the level, and
each level remembers its own choice:

| Level | Colour by |
| --- | --- |
| Element type | Condition, Bridge age, Location |
| Bridge | BHI, Bridge age, Location |

"Location" is a single colour, so only the positions stand out.

At both levels:
- **Dot size follows the zoom** (`dotR()`, `dotW()` in `bridgemap.js`). At state zoom the dots
  are small (radius 1.6 to 2 px) with no white outline, so crowded areas show their real mix of
  colours. They grow to full size (3.6 px with an outline) by zoom 9. Hovering still works on
  small dots, because the map accepts a hover within 4 px.
- **The legend groups are buttons.** Click or tap a group to hide or show its dots. At least one
  group stays on. Each group shows its count and its share of the bridges shown, for example
  "2,498 17%". Hidden groups show again when the colour, state, period, element type or level
  changes, and when Find a bridge picks a bridge in a hidden group.

**Element type level.** One dot per bridge that has the element in the period, at its latest
record in the period, left out for the same reasons as the charts (so the count matches the
figures above the charts). Condition is the share of the element in CS3 or CS4 (none, above
0% to 5%, above 5%). Bridge age uses 20-year groups. Dots with more of the element in CS3 or
CS4 (or older bridges) are drawn last, so they stay visible. Most dots are in the "None" group,
so this does not swamp the map the way it did for BHI. Hover or tap a dot for the structure number, built year, age at the record, the
element's quantity (labelled Length, Area or Count by its unit), latitude and longitude, and a
bar with the CS1–CS4 shares listed under it. "Show other bridges" adds, in purple, the state's other bridges with element data in the
period: those without the element, those left out of the charts and those outside the age band. The map's age band and the age filter of "Bridges by condition-state range" follow
each other. "Hide map" folds the card away and is remembered in the browser. A change of
selection made while the map is hidden is drawn when it is shown again.

**Bridge level.** One dot per bridge with a health score in the period, at its latest score
year in the period (`opts.bridgeScores` in `index.html`, from `health.json`, and
`pickBridges()` in `bridgemap.js`). Every bridge with a score is kept, so the count can be a
little higher than any single year's count in Basic Analytics (Bridge Level). Minnesota
2018–2025: 14,704 bridges, 261 of them without a recorded position.
- **BHI** (Bridge Health Index, legend title "Bridge Health Index (BHI)"): 95% or more (green), 85% to below 95% (yellow), 70% to below 85% (orange)
  and below 70% (red), in the CS1 to CS4 colours, with counts. The bands are finer at the top
  because most bridges score high (half of Texas bridges score above 97%). The dots are drawn
  in a fixed shuffled order (by bridge row), so in crowded areas each band shows in proportion
  to its share. Drawing the lowest scores on top made red look far more common than it is
  (17% in Minnesota). To see only the lowest scores, click the other three groups off.
- **Bridge age:** the same 20-year groups, with age at the latest score year. Two more groups
  show only when they hold bridges: "Over 100 years" and "Year built unknown".
- **Hover box:** structure number, built year, age, latitude and longitude, then the bridge
  health score with the number of element types and the data year, and a bar in the band
  colour. Below that, the total quantity of the bridge's elements in each unit: "Total sq ft",
  "Total ft" and "Total units (each)", 0 when it has none in that unit. These are the elements
  counted in the health score in that data year (the Q_u totals in `health.json`, looked up per
  bridge and year through the run index `R` in `loadHealth()`). Minnesota bridge L5920 in 2025:
  1,198 sq ft, 304 ft, 0 each. Find a bridge works the same way.
- "Show other bridges" and the age band filter are element type level only.

**Map settings: `public/mapconfig.js`.** This file holds your own settings, and site updates
leave it out, so they stay as you set them:
- `cartoKey`: a CARTO basemaps API key (https://carto.com/basemaps/) for the light grey Positron
  map. Empty: OpenStreetMap's standard tiles, which are fine for testing but not for heavy use.
  CARTO's free tier allows up to 1 million tile requests a month for commercial use.
- `credits`: `"compact"` (a small (i) button that shows the credits when clicked), `"full"`
  (credit line always shown) or `"none"`. CARTO and OpenStreetMap ask for their credit to be
  visible on a published map.
- `stateOutline`: draw the selected state's border (`false` by default). If no tiles load (a
  blocked network), the border is drawn anyway so the dots still have a reference.

`<ST>/loc/<EN>.json.gz` (written with the inventory folder): `row` (each bridge's row in
`bridges.json`, delta-encoded), `nrun` (runs per bridge) and one column per run: `yy`
(first and last year, `y0·100 + y1` as offsets from `base`), `yb` (year built), `q` (quantity, 3
significant figures), `s1`, `s2`, `s3` (CS1–CS3 share in 0.1%; CS4 is the rest) and `ex`
(exclusion: 0 none, 1 no quantity, 2 quantity check, 3 no deck area, 4 no age). A run is a
stretch of consecutive years with identical values; most elements are inspected every two years
and carried over in between, so 14.7 million yearly records fit in 4.7 million runs.

The hover box and the pinned box also show two scores. **Element score** is the selected element's
own score, worked out from the CS shares listed below it (100 × (CS1 + 0.67 CS2 + 0.33 CS3)).
**Bridge health score** uses every element type on the bridge, weighted by quantity × unit
cost, in its latest data year of the period, for example "Bridge health score: 40.3%" with the
note "Weighted by quantity × unit cost over 7 element types on this bridge, 2025 data" for
Minnesota bridge L5920. Its wearing surface (510) and steel coating (515) are 100% CS4 and score
0%, but carry only 2% and 4% of the weight. Its steel girders (107, 168 ft, 24.2%) carry 49%. The
bridge scores come from
`<ST>/health.json.gz`, loaded after the dots are drawn (shared with Basic Analytics (Bridge
Level) through `healthFor()` in `index.html`, passed to the map as `opts.health`).

## Bridge positions (`<ST>/bridges.json.gz`)

One file per state, columns of equal length, one entry per bridge in the element data,
sorted by `id`:

| Field | Meaning |
| --- | --- |
| `years` | the years the bit masks refer to (bit 0 = first year, 2015) |
| `id` | structure number with spaces and leading zeros removed (zeros kept for the 64 numbers that are two bridges) |
| `lat`, `lon` | position in degrees × 100,000 (integers), from the bridge's latest NBI year with a usable position; `null` if none |
| `nbi` | bit mask of the years the bridge is in the NBI inventory (built / removed over time) |
| `el` | bit mask of the years it has element data |
| `flag` | 0 position from its latest NBI year · 1 latest year unusable, position from an earlier year · 2 no usable position · 3 not in the NBI inventory |
| `moved` | `{"<row>": [[firstYear, lastYear, lat, lon], …]}` for years whose position differs by more than 100 m (relocations and coordinate corrections) |

Positions come from NBI items 16 and 17 (DDMMSSss and DDDMMSSss; longitudes under 100°
sometimes lose their leading zero; Guam is east longitude). A position is unusable if it
does not decode, is a placeholder such as `00000000`, or lies more than 10 km outside its
own state (a few km outside is normal for bridges on state lines and coasts). To draw them
on the site's map, project with the same projection as `usmap.js`:
`d3.geoAlbersUsa().scale(1300).translate([487.5, 305])` (Puerto Rico and Guam fall outside it).

## Run locally

The page loads its data with `fetch()`, so serve the folder rather than opening the file:

```
npx serve public        # or: python -m http.server -d public 8080
```

### On Windows (PowerShell)

1. Check the tools (Python, or Node.js, is enough to serve the site):
   ```powershell
   git --version
   python --version      # if not found, try: py --version
   ```
2. Go to your local copy of the repo and bring it up to date:
   ```powershell
   cd "C:\path\to\bridges"
   git pull
   ```
3. Unpack a new package over it (the zip has a top-level `bridges` folder):
   ```powershell
   Expand-Archive -Path "$HOME\Downloads\bridges-nbi.zip" -DestinationPath "$env:TEMP\bridges-nbi" -Force
   robocopy "$env:TEMP\bridges-nbi\bridges" . /E /NFL /NDL /NJH /NJS
   ```
   robocopy returns exit code 1 when it copied files; that is success. Unpacking never
   deletes files, so remove any files a release drops with `git rm` (see the release notes).
4. Start a local web server and open http://localhost:8000:
   ```powershell
   python -m http.server 8000 --directory public     # or: py -m http.server 8000 --directory public
   ```
   With Node.js instead: `npx.cmd serve public` (use `npx.cmd`, not `npx`, if PowerShell
   says running scripts is disabled). Press Ctrl+C to stop the server.
5. Check the site: choose a state and a period, then try both analysis levels. At element type
   level, pick an element type and try the z-axis switch and the three tabs. At bridge level,
   try the three map colours. Press F12 and look at the Console tab for red errors. If you see an
   old version, press Ctrl+F5.
6. Commit and push; Vercel redeploys automatically:
   ```powershell
   git status
   git add -A
   git commit -m "Describe the change"
   git push
   ```

## Deploy on Vercel

Import the repo and leave Root Directory as the repo root. `vercel.json` serves `public/`
with no build step. Every push to `main` redeploys.

## Data notes (current release)

- 49 jurisdictions: 46 states, DC, Puerto Rico and Guam. There is no data for Georgia,
  Iowa, Maryland or Pennsylvania.
- 295,532 distinct bridges (334,838 structure numbers as written; the difference is the same
  bridge reported with and without leading zeros, mostly in SC, TN, AR and VA).
- Positions: 294,373 bridges (99.6%) have one. The NBI inventory files run 2015–2025; Iowa
  is missing from 2019, Maryland from 2022 and Pennsylvania from 2024, and Guam in most
  years.
- Data years 2016–2025 on the site. The export also has 2015, which the script drops.
- Unknown element numbers (88–90, 321, 600–610) appear under "Unclassified".
