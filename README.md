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
   - **Basic Analytics** and **Advanced Analytics:** placeholders for now. Add their
     content in `renderBasicAnalytics(ctx)` and `renderAdvancedAnalytics(ctx)` in
     `public/index.html`. Both run whenever the selection changes; `ctx` (documented above
     the functions) carries the state, period, element and the decoded profile data.

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
  usmap.js              US state shapes (us-atlas, ISC licence, notice inside)
  assets/               logo
  data/
    index.json          jurisdictions, data years, bridge counts
    <ST>/index.json     the state's periods, bridges per year, element types and bridges per period
    <ST>/<EN>.json      profile cells for one element type, grouped by end year and record year
scripts/
  prepare_nbi.py        builds public/data/ from the NBI export
vercel.json
```

The data files total about 77 MB across roughly 3,840 files (under the Hobby plan's
100 MB limit for static files). Each `<EN>.json` is at most about 215 KB, and the browser
loads only the file for the element type you select.

Periods are not stored one by one (21 periods per state would be about 160 MB). Instead,
`<EN>.json` has `ends[e][g]`: for each valid end year `e`, the bridges whose latest record
up to `e` is from year `g`. The latest record inside a period `[s, e]` is the latest
record up to `e` whenever it is from year `s` or later, so the browser builds any period
by adding up `ends[e][s]` … `ends[e][e]` (`periodData()` in `index.html`). The result is
identical to computing the period directly.

Cells
are stored as flat triples `[code, deckAreaSqFt, bridges]`, where
`code = (cs − 1)·400 + ageBin·20 + csBin`.

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
