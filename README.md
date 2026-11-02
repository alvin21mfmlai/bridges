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
  catalog.js                 generated: element index + raw inspection records (committed, so the site also works without a build)
  assets/bentley-logo.svg    ← put the official logo file here
  data/
    TX/                                  two-letter USPS state code
      steel-open-girder-beam/            one folder per element type (any slug)
        x1000/                           one folder per element ID
          observations.csv               inspection history (required): date, total, b, cs1–cs4, used_in_fit, is_latest
          model.csv                      pipeline outputs, used only to cross-check the browser fit (optional)
          curve.png, *.csv               any other files are offered as downloads
scripts/build-catalog.mjs    walks public/data and writes public/catalog.js
vercel.json
```

The element-type display name comes from `element_name` in `model.csv`. If that column
is missing, the name is taken from the folder name. A state lights up on the map as soon
as it has at least one element folder containing `observations.csv`. An element with fewer
than two usable inspections falls back to showing its `curve.png`, if there is one.

## Adding data

1. Copy the element folders into `public/data/<STATE>/<element-type>/`.
2. Run `node scripts/build-catalog.mjs`. Vercel also runs this on every deploy.
3. Commit and push.

## Logo

The header loads `public/assets/bentley-logo.svg`. Use the official file from the Bentley
brand resources. A PNG works too: change the `src` in `index.html`. Until the file is
there, the header shows the text "Bentley Systems" on the white logo pill instead.

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
