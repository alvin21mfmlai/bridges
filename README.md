# Bridge Deterioration Model

A static website for exploring bridge element condition-state profiles by bridge age. It
uses National Bridge Inventory (NBI) element data, prepared into small JSON files. There
is no database, no server code and no build step, so it runs on the Vercel Hobby plan.

## The four steps

1. **State.** A US map coloured by the number of bridges with element data (√ scale).
   Small states and territories (VT, NH, MA, RI, CT, NJ, DE, MD, DC, HI, PR, GU) are also
   offered as buttons. States without data are hatched.
2. **Period.** Any 5 consecutive data years (start and end are linked, end = start + 4).
   A state with 5 or fewer data years uses all of them. The bar chart shows how many bridges
   have records in each year.
3. **Element type.** Every element type with records in that state and period, grouped by
   category, with a search box and the number of bridges.
4. **Profiles.** Four 3D bar charts (CS1 Good, CS2 Fair, CS3 Poor, CS4 Severe):
   - Floor axes: bridge age (5-year bands, 1–100) × CS% (5% bands).
   - Bar height and colour, switchable:
     - **Deck area (sq ft):** the total deck area of the bridges in the cell.
     - **% of total deck area:** each figure sums to 100%.
     - **% within age band:** each age band sums to 100% in each figure.
   - Drag to rotate all four charts; hover a bar to see its values and highlight that age
     band. There is an age-band summary table and a CSV download.

Selections are kept in the URL, for example `/#/TX/2017-2021/107` (state / period /
element number).

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
    <ST>/<EN>.json      profile cells per period for one element type
scripts/
  prepare_nbi.py        builds public/data/ from the NBI export
vercel.json
```

The data files total about 47 MB across roughly 3,840 files. Each `<EN>.json` is at most
about 130 KB, and the browser loads only the file for the element type you select. Cells
are stored as flat triples `[code, deckAreaSqFt, bridges]`, where
`code = (cs − 1)·400 + ageBin·20 + csBin`.

## Updating the data

```
pip install duckdb
python scripts/prepare_nbi.py path/to/summary_states_nbi_data.zip   # or an extracted folder
```

The script reads `<STATE>/bridge_element_yearly.csv` only. The `by_element/` files hold
the same rows and are ignored. It replaces everything in `public/data/` and takes about
2 minutes. Commit the new `public/data/` and push.

## Run locally

The page loads its data with `fetch()`, so serve the folder rather than opening the file:

```
npx serve public        # or: python -m http.server -d public 8080
```

## Deploy on Vercel

Import the repo and leave Root Directory as the repo root. `vercel.json` serves `public/`
with no build step. Every push to `main` redeploys.

## Data notes (current release)

- 49 jurisdictions: 46 states, DC, Puerto Rico and Guam. There is no data for Georgia,
  Iowa, Maryland or Pennsylvania.
- Data years 2016–2025 on the site. The export also has 2015, which the script drops.
- Unknown element numbers (88–90, 321, 600–610) appear under "Unclassified".
