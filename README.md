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
   resets the period to the latest 5 years, clears the element type, the element search and
   the category filter, and returns the z-axis to Non-normalized and the analysis to Basic
   Insights (`resetFilters()` in `index.html`). Links that name a period and element, such
   as `/#/TX/2016-2025/107`, still open exactly that.
3. **Element type.** Every element type with records in that state and period, grouped by
   category, with a search box and the number of bridges.
4. **Analysis**, in four tabs. The first two work at element type level (the element chosen in
   step 3), the third at bridge level (every element type on each bridge):
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
     `data/<ST>/health.json.gz` (loaded when the tab is first opened). The element type
     chosen in step 3 does not change it, and a note at the top of the tab says so.
     1. **Health score by data year.** Each bridge gets a score from 0% to 100%: element score
        = 100 × (CS1 + 0.67 CS2 + 0.33 CS3) ÷ total quantity, and the bridge score is the
        average of its element scores, each element type counting equally (the NBI has no
        unit costs). For each data year, the chart shows the average score of every bridge
        with a score that year, and a shaded band for the interquartile range (25th to 75th
        percentile, so half of those bridges score inside it), with a hover box per year. **Find a bridge** adds that bridge's
        own line. Key findings, a facts line, and a note when a year has far fewer bridges
        than the state's other years (under 60% of the usual count, such as Texas 2017).
        Download CSV lists every bridge and data year of the period: structure number, year
        built, age, score (%) and element types counted. Drawn by `renderBridgeTab()` /
        `drawHealth()` in `public/index.html`. The same scores show in the bridge map's hover
        box (see below).
     2. to 4. Trend and forecast, average health by age, health by age (3D): still to come,
        with the health score colour on the bridge map.
   - **Advanced Analytics:** placeholder. The element type tabs are filled by
     `renderBasicAnalytics(ctx)` and `renderAdvancedAnalytics(ctx)` in `public/index.html`,
     which run whenever the selection changes; `ctx` (documented above the functions)
     carries the state, period, element, the period data (including CS quantities by age
     band) and the decoded profile.

Selections are kept in the URL, for example `/#/TX/2016-2025/107` (state / period /
element number), with an optional fourth part for the tab: `/#/TX/2016-2025/107/analytics`
(or `bridge` for Basic Analytics (Bridge Level)).

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
  profile3d.js          3D bar chart renderer (SVG, drag to rotate)
  csdist.js             condition-state range histograms and "more than x%" curves (SVG)
  weibull.js            CS1 → CS2 Weibull fit and chart (also runs in Node for testing)
  markov.js             CS2 → CS3 → CS4 Markov fit, TPMs and line charts (also runs in Node)
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
scripts/
  prepare_nbi.py        builds public/data/ from the NBI export (and the NBI inventory, if given)
  nbi_inventory.py      reads the NBI inventory files: positions, year built, deck area
  health.py             bridge health scores per data year (health.json)
  geo/states-10m.geojson  state outlines (US Census via us-atlas) for checking positions
vercel.json
```

The data files are stored gzip-compressed: about 50 MB across roughly 7,690 files (the
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

Written with the inventory folder, one file per state (Texas: about 240 KB, 36,455 bridges).
An element record counts when its total quantity is positive and it has not failed the quantity
check, the same records the charts use. Deck area and age are not needed for the score. The
bridge score is the plain average of its element scores, as a percentage rounded to 0.1 (stored × 10). Columns:
`base` (first data year), `row` (each bridge's row in `bridges.json`, delta-encoded), `yb` (year
built, 0 if unknown), `nrun` (runs per bridge), and per run of consecutive data years with the
same score and element count: `yy` (first year × 100 + last year, as offsets from `base`), `sc`
(score × 10) and `ne` (element types counted). Element scores are rounded to 6 decimals and summed
as exact decimals, so the file is identical byte for byte whenever the input is. Check: Texas
2016–2025 has 5,344 bridges with data in every year, averaging 96.2% in 2016 and 94.8% in 2025.

## Bridge locations map (top of step 4, `bridgemap.js`)

When an element type is chosen, step 4 opens with "Where these bridges are": one dot per bridge
that has the element in the period, at its latest record in the period, left out for the same
reasons as the charts (so the count matches the figures above the charts). Colour by condition
(share of the element in CS3 or CS4: none, above 0% to 5%, above 5%), bridge age (20-year
groups) or one colour. Hover or tap a dot for the structure number, built year, age at the record, the
element's quantity (labelled Length, Area or Count by its unit), latitude and longitude, and a
bar with the CS1–CS4 shares listed under it. "Show other bridges" adds, in purple, the state's other bridges with element data in the
period: those without the element, those left out of the charts and those outside the age band. The map's age band and the age filter of "Bridges by condition-state range" follow
each other. "Hide map" folds the card away and is remembered in the browser.

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
**Bridge health score** is the average over every element type on the bridge in its latest data
year of the period, for example "Bridge health score: 43.3% (average of 7 element types, 2025 data)" for
Minnesota bridge L5920, whose wearing surface (element 510) is 100% CS4 and scores 0%. The
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
5. Check the site: choose a state, a period and an element type, then try the z-axis switch
   and the four tabs. Press F12 and look at the Console tab for red errors. If you see an
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
