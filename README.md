# Bridge Deterioration Model

A static website for exploring bridge element condition-state profiles by bridge age. It
uses National Bridge Inventory (NBI) element data, prepared into small JSON files. There
is no database, no server code and no build step, so it runs on the Vercel Hobby plan.

## The four steps

1. **State.** A US map coloured by the number of bridges with element data (√ scale).
   Small states and territories (VT, NH, MA, RI, CT, NJ, DE, MD, DC, HI, PR, GU) are also
   offered as buttons. States without data are hatched.
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
4. **Analysis**, in three tabs:
   - **Basic Insights:** four 3D bar charts (CS1 Good, CS2 Fair, CS3 Poor, CS4 Severe).
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
   - **Basic Analytics:**
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
     2. CS2 → CS3 → CS4 (Markov) and 3. CS quantity propagation: still to come.
   - **Advanced Analytics:** placeholder. Both analytics tabs are filled by
     `renderBasicAnalytics(ctx)` and `renderAdvancedAnalytics(ctx)` in `public/index.html`,
     which run whenever the selection changes; `ctx` (documented above the functions)
     carries the state, period, element, the period data (including CS quantities by age
     band) and the decoded profile.

Selections are kept in the URL, for example `/#/TX/2016-2025/107` (state / period /
element number), with an optional fourth part for the tab: `/#/TX/2016-2025/107/analytics`.

## How the profiles are computed (`scripts/prepare_nbi.py`)

Only data years from **2016** onwards are used (`MIN_YEAR` in the script); 2015 is dropped
because it is too sparse.

For each state × element type × period:
- Each bridge counts **once**, at its **latest data year inside the period**.
- Age = `BRIDGE_AGE_YEARS` at that year (data year − year built).
- CSk share = CSk / TOTALQTY × 100. Bins: age 1–5 … 96–100; CS% [0,5], (5,10] … (95,100].
- Each cell stores the summed deck area (sq ft) and the number of bridges.
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
  usmap.js              US state shapes (us-atlas, ISC licence, notice inside)
  assets/               logo
  data/
    index.json          jurisdictions, data years, bridge counts
    <ST>/index.json     the state's periods, bridges per year, element types and bridges per period
    <ST>/<EN>.json      one element type: profile cells, >0–5% counts and CS quantities by age
                        band, grouped by end year and record year
scripts/
  prepare_nbi.py        builds public/data/ from the NBI export
vercel.json
```

The data files total about 85 MB across roughly 3,840 files (under the Hobby plan's
100 MB limit for static files). Each `<EN>.json` is at most about 245 KB, and the browser
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
pip install duckdb
python scripts/prepare_nbi.py path/to/summary_states_nbi_data.zip   # or an extracted folder
```

On Windows: `py -m pip install duckdb`, then
`py scripts\prepare_nbi.py "C:\path\to\summary_states_nbi_data.zip"`.

The script reads `<STATE>/bridge_element_yearly.csv` only. The `by_element/` files hold
the same rows and are ignored. It replaces everything in `public/data/` and takes about
2 minutes. Commit the new `public/data/` and push.

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
   and the three tabs. Press F12 and look at the Console tab for red errors. If you see an
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
- Data years 2016–2025 on the site. The export also has 2015, which the script drops.
- Unknown element numbers (88–90, 321, 600–610) appear under "Unclassified".
