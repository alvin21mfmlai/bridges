# Bridge Deterioration Curves

A static site for browsing element-level bridge deterioration curves. You filter by
**State → Element type → Element ID**, and the site shows that element's `curve.png`, its
key model numbers and its data files. There are no dependencies and no framework.
The only build step is a small Node script that indexes the data folders.

## Layout

```
public/
  index.html                 the whole site (HTML, CSS and JS in one file)
  catalog.js                 generated index of public/data (committed, so the site also works without a build)
  assets/bentley-logo.svg    ← put the official logo file here
  data/
    TX/                                  two-letter USPS state code
      steel-open-girder-beam/            one folder per element type (any slug)
        x1000/                           one folder per element ID
          curve.png                      the figure shown on the page (required)
          model.csv                      rate, RMSE, intervals… (recommended)
          forecast_origins.csv           latest inspection date + share (optional)
          curve.csv                      forecast series, used for the card sparkline (optional)
          *.csv                          any other files are offered as downloads
scripts/build-catalog.mjs    walks public/data and writes public/catalog.js
vercel.json
```

The element-type display name comes from `element_name` in `model.csv`. If that column
is missing, the name is taken from the folder name. A state lights up on the map as soon
as it has at least one element folder containing an image.

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
