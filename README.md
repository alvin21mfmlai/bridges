# Bridge Deterioration Curves

A static site for browsing element-level bridge deterioration curves. You filter by
**State → Element type → Element ID**. The site then fits the element's deterioration
model **in the browser** from its inspection records and draws the curves, tables and
key figures. All reported figures are rounded to 3 significant figures. There are no
dependencies and no framework. The only build step is a small Node script that indexes
the data folders.

## How the curves are computed (`public/model.js`)

- Share in poor/severe condition (CS3 + CS4): `b(t) = 1 − (1 − b0) · e^(−r·t)`, t in years
  (days / 365.25).
- Intervals: consecutive inspections with `used_in_fit = True`. An interval is excluded
  when the element's `total` quantity changes between its two inspections. Each interval
  has weight 1/n.
- Rate: r ≥ 0 minimises the weighted squared error of the predicted end shares (grid scan
  followed by golden-section search).
- Fitting RMSE (pp) and a persistence baseline. Forecast from the latest inspection over
  10, 20, 30 or 50 years, with no intervention.
- On the demonstration data (x1000, x2000, x3000, x5000) this reproduces `model.csv`,
  `intervals.csv` and `curve.csv` to within 1e-6. The page shows "Fit matches pipeline"
  when the browser's rate equals `model.csv` at 3 s.f.

## Layout

```
public/
  index.html                 the site (HTML, CSS, charts and UI)
  model.js                   the deterioration model: interval building, rate fit, forecast, 3 s.f. formatting
  profile.js                 condition-state profile: per-bridge age and CS% binning
  profile3d.js               3D bar chart renderer (SVG, drag to rotate)
  catalog.js                 generated: element index + shared source datasets (committed, so the site also works without a build)
  assets/BentleySystemsBlackLogo.png   header logo
  data/
    TX/                                  two-letter USPS state code
      steel-open-girder-beam/            one folder per element type (any slug)
        _profile/                        condition-state profile: members.csv, model.csv, bins.csv, bridges.csv, excluded.csv
        x1000/                           one folder per element ID
          observations.csv               inspection history (required): date, total, b, cs1–cs4, used_in_fit, is_latest
          model.csv                      pipeline outputs, used only to cross-check the browser fit (optional)
          curve.png, *.csv               any other files are offered as downloads
scripts/build-catalog.mjs    walks public/data, applies synthetic.config.json, writes public/catalog.js
synthetic.config.json        synthetic coverage: which states and element types reuse the demonstration data
vercel.json
```

The element-type display name comes from `element_name` in `model.csv`. If that column
is missing, the name is taken from the folder name. A state lights up on the map as soon
as it has at least one element folder containing `observations.csv`. An element with fewer
than two usable inspections falls back to showing its `curve.png`, if there is one.

## Condition-state profile (`public/profile.js`, `public/profile3d.js`)

After Step 2 (element type), the page shows four 3D bar charts, one per condition state
(CS1 Good, CS2 Fair, CS3 Poor, CS4 Severe). The browser builds them from
`public/data/<STATE>/<type>/_profile/members.csv`:

- Included members are summed per bridge into CS1–CS4 quantities. Bridge age = profile
  year − year built (`model.csv` `profile_year`).
- Floor axes: bridge age in 5-year bins (1–5 … 96–100), and the CS share
  (CSk quantity / total × 100) in 5% bins ([0,5], (5,10] … (95,100]).
- Bar height and colour show the total deck area of the bridges in each cell, on one colour
  scale for all four figures. Each bridge counts its full deck area once per figure.
- Drag any figure to rotate all four. Hover a bar to see its cell, total area and bridges;
  the same bridges are highlighted in the other three figures and in the bridge table.
- `bins.csv` is used only as a cross-check. The page shows "Bins match pipeline" when the
  browser's cells equal its non-empty rows. If `members.csv` is missing, `bridges.csv`
  is used instead.
- Synthetic element types share the source type's profile.
- Figures are shown to 3 significant figures (for example 8,977 sq ft is shown as 8,980).

## Synthetic coverage (`synthetic.config.json`)

The prototype reuses the Texas Steel Open Girder/Beam demonstration data for **every state
(50 + DC)** and for **six element types**: Steel Open Girder/Beam, Prestressed Concrete
Open Girder/Beam, Reinforced Concrete Open Girder/Beam, Reinforced Concrete Deck,
Reinforced Concrete Column and Reinforced Concrete Abutment. Nothing is copied on disk.
The build script lists the copies in the catalog, and they all point at the same four
source datasets (`catalog.sources`). Pages for copied data show a "Synthetic data" tag.

- To add or rename element types, edit `types` (the `slug` is used in the URL, the `name`
  is what the page shows).
- To limit coverage, replace `"states": "all"` with a list such as `["TX", "CA"]`.
- Real data always wins: a folder at `public/data/<STATE>/<type-slug>/` replaces the
  synthetic copy for that state and type.
- Set `"enabled": false` to show real folders only.

## Adding data

1. Copy the element folders into `public/data/<STATE>/<element-type>/`.
2. Run `node scripts/build-catalog.mjs`. Vercel also runs this on every deploy.
3. Commit and push.

## Logo

The header loads `public/assets/BentleySystemsBlackLogo.png`. If the file is missing,
the header shows the text "Bentley Systems" instead.

## Run locally

```
node scripts/build-catalog.mjs
npx serve public        # or: python -m http.server -d public 8080
```

Because the catalog is a `<script>`, opening `public/index.html` directly from disk also works.

## Deploy on Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, choose **Add New → Project**, import the repo and leave **Root Directory**
   as the repo root. `vercel.json` already sets the build command
   (`node scripts/build-catalog.mjs`) and the output directory (`public`).
3. Deploy. Every push to `main` rebuilds the catalog and redeploys.

You can also deploy from the CLI: run `npx vercel` in this folder, then `npx vercel --prod`.

## Deep links

Each selection is written to the URL, for example
`/#/TX/steel-open-girder-beam/x1000`, so a specific curve can be shared directly.
