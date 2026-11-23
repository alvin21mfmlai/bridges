"""NBI inventory files (items 8, 16, 17, 27, 49, 52): bridge positions, and age and deck area where
the element export lacks them.

Used by prepare_nbi.py when it is given the inventory folder:

    python scripts/prepare_nbi.py <element export> <nbi_inventory folder>

The inventory folder holds one sub-folder per year (2015 ... 2025), each with the FHWA delimited
state files (e.g. 2025/TX25.txt from https://www.fhwa.dot.gov/bridge/nbi/2025/delimited/TX25.txt).

Bridges are matched on state + structure number (item 8) with spaces and leading zeros removed,
the same key prepare_nbi.py uses for the element data.

Positions (items 16 and 17, stored as DDMMSSss and DDDMMSSss):
  - Latitude has 8 digits. Longitude has 9 digits, or 8 when the leading zero of a longitude
    under 100 degrees was dropped. All longitudes are west, except Guam (east).
  - A position is unusable if it does not decode (minutes or seconds of 60 or more, blanks),
    is a placeholder such as 00000000 / 01000000, falls outside a rough box around its state,
    or lies more than MAX_OUTSIDE_KM outside its own state's boundary (US Census outlines via
    us-atlas states-10m, in scripts/geo/states-10m.geojson). A few km outside is normal for
    bridges on state lines and coasts.

Requires: pip install duckdb shapely
"""
import csv, glob, json, math, os, re

GEO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geo", "states-10m.geojson")
MAX_OUTSIDE_KM = 10
MOVE_KM = 0.1          # a year's position is listed separately when it differs by more than this
SQFT_PER_M2 = 10.7639104
WANT = ["STRUCTURE_NUMBER_008", "LAT_016", "LONG_017", "YEAR_BUILT_027", "STRUCTURE_LEN_MT_049", "DECK_WIDTH_MT_052"]
FIPS = {"AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11", "FL": "12",
        "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23",
        "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
        "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
        "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55",
        "WY": "56", "PR": "72"}
_FIELD = re.compile(r"'(?:[^']|'(?!,|$))*'|[^,]*")


def _split_tolerant(line):
    """Split a line whose quoted text holds stray apostrophes (a quote closes only before a comma)."""
    out, pos = [], 0
    while True:
        m = _FIELD.match(line, pos)
        v = m.group(0)
        if len(v) >= 2 and v[0] == "'" and v[-1] == "'":
            v = v[1:-1]
        out.append(v)
        pos = m.end()
        if pos >= len(line) or line[pos] != ",":
            return out
        pos += 1


def extract(folder, csv_out):
    """Write st, yr, sn, lat_s, lon_s, yb, len_m, width_m for every record of every file to csv_out."""
    files = sorted(glob.glob(os.path.join(folder, "[0-9]" * 4, "*.txt")))
    if not files:
        raise SystemExit(f"no inventory files found under {folder}/<year>/*.txt")
    n = 0
    with open(csv_out, "w", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["st", "yr", "sn", "lat_s", "lon_s", "yb", "len_m", "width_m"])
        for path in files:
            yr = int(os.path.basename(os.path.dirname(path)))
            st = os.path.basename(path)[:2].upper()
            with open(path, encoding="latin-1", newline="") as f:
                lines = f.read().lstrip("﻿").splitlines()
            header = [h.strip().strip("'") for h in lines[0].split(",")]
            idx = [header.index(x) for x in WANT]
            for line in lines[1:]:
                if not line.strip():
                    continue
                r = next(csv.reader([line], quotechar="'"))
                if len(r) != len(header):
                    r = _split_tolerant(line)
                    if len(r) != len(header):
                        continue
                w.writerow([st, yr] + [r[i].strip() for i in idx])
                n += 1
    return len(files), n


def load(con, folder, work):
    """Create table inv (st, yr, k, lat, lon, pos_ok, yb, area_sqft): one row per bridge and year."""
    tmp = os.path.join(work, "inventory.csv")
    nfiles, nrows = extract(folder, tmp)
    con.execute(f"""
        CREATE TABLE inv_raw AS
        WITH d AS (
          SELECT st, yr::INTEGER AS yr, ltrim(upper(replace(sn, ' ', '')), '0') AS k,
            (length(replace(sn, ' ', '')) - length(ltrim(replace(sn, ' ', ''), '0')))::UTINYINT AS pad,
            yb, len_m, width_m,
            CASE WHEN regexp_full_match(lat_s, '[0-9]{{8}}') AND substr(lat_s,3,2)::INT < 60 AND substr(lat_s,5,2)::INT < 60
                 THEN substr(lat_s,1,2)::INT + substr(lat_s,3,2)::INT/60.0 + substr(lat_s,5,4)::INT/360000.0 END AS lat,
            CASE WHEN regexp_full_match(lon_s, '[0-9]{{9}}') AND substr(lon_s,4,2)::INT < 60 AND substr(lon_s,6,2)::INT < 60
                      THEN substr(lon_s,1,3)::INT + substr(lon_s,4,2)::INT/60.0 + substr(lon_s,6,4)::INT/360000.0
                 WHEN regexp_full_match(lon_s, '[0-9]{{8}}') AND substr(lon_s,3,2)::INT < 60 AND substr(lon_s,5,2)::INT < 60
                      THEN substr(lon_s,1,2)::INT + substr(lon_s,3,2)::INT/60.0 + substr(lon_s,5,4)::INT/360000.0 END AS lon_abs
          FROM read_csv('{tmp}', header=true, all_varchar=true))
        SELECT st, yr, k, pad,
          lat, CASE WHEN st = 'GU' THEN lon_abs ELSE -lon_abs END AS lon,
          CASE WHEN lat IS NULL OR lon_abs IS NULL THEN false
               WHEN st = 'GU' THEN lat BETWEEN 13 AND 14 AND lon_abs BETWEEN 144 AND 146
               WHEN st = 'PR' THEN lat BETWEEN 17.5 AND 18.7 AND lon_abs BETWEEN 65 AND 68
               WHEN st = 'HI' THEN lat BETWEEN 18.5 AND 22.5 AND lon_abs BETWEEN 154 AND 161
               WHEN st = 'AK' THEN lat BETWEEN 51 AND 72 AND lon_abs BETWEEN 129 AND 180
               ELSE lat BETWEEN 24 AND 50 AND lon_abs BETWEEN 66 AND 125 END AS rough_ok,
          CASE WHEN regexp_full_match(yb, '[0-9]{{4}}') AND yb::INT BETWEEN 1700 AND yr THEN yb::INT END AS yb,
          CASE WHEN TRY_CAST(len_m AS DOUBLE) > 0 AND TRY_CAST(width_m AS DOUBLE) >= 0
               THEN round(len_m::DOUBLE * width_m::DOUBLE, 2) * {SQFT_PER_M2} END AS area_sqft
        FROM d""")
    os.remove(tmp)
    # Structure numbers spelled with and without leading zeros in the same year of the element
    # data are two bridges (table splitk, from prepare_nbi.py): keep their zeros here too.
    con.execute("CREATE TEMP TABLE elsp AS SELECT DISTINCT st, repeat('0', pad) || sn AS raw FROM y")
    con.execute("""ALTER TABLE inv_raw ADD COLUMN el_spelling BOOLEAN DEFAULT false;
                   UPDATE inv_raw SET el_spelling = true FROM elsp
                   WHERE elsp.st = inv_raw.st AND elsp.raw = repeat('0', inv_raw.pad) || inv_raw.k""")
    con.execute("DROP TABLE elsp")
    con.execute("UPDATE inv_raw SET k = repeat('0', inv_raw.pad) || inv_raw.k FROM splitk WHERE splitk.st = inv_raw.st AND splitk.k = inv_raw.k")
    # one row per bridge and year. Where the inventory has the number spelled two ways in a year
    # (the element data never does), prefer the spelling the element data uses (AR "3001" and
    # "000000000003001" in 2015-2016); then a record with a usable position, then one with a deck
    # area; the remaining columns only make the pick independent of the order rows are read in
    con.execute("""
        CREATE TABLE inv AS SELECT st, yr, k, lat, lon, rough_ok AS pos_ok, yb, area_sqft FROM (
          SELECT *, row_number() OVER (PARTITION BY st, k, yr ORDER BY el_spelling DESC, rough_ok DESC,
                                       area_sqft IS NOT NULL DESC, area_sqft DESC, yb DESC NULLS LAST,
                                       lat NULLS LAST, lon NULLS LAST, pad) AS rn
          FROM inv_raw) WHERE rn = 1""")
    con.execute("DROP TABLE inv_raw")
    _check_boundaries(con)
    return nfiles, nrows


def _check_boundaries(con):
    """Set pos_ok = false for positions more than MAX_OUTSIDE_KM outside their own state."""
    import numpy as np
    import shapely
    from shapely.geometry import shape
    from shapely.affinity import scale
    states = {f["properties"]["fips"]: shape(f["geometry"]) for f in json.load(open(GEO))["features"]}
    pts = con.execute("SELECT DISTINCT st, lat, lon FROM inv WHERE pos_ok").fetchall()
    by_st = {}
    for st, lat, lon in pts:
        by_st.setdefault(st, []).append((lat, lon))
    bad = []
    for st, ll in by_st.items():
        g = states.get(FIPS.get(st))
        if g is None:            # Guam: rough box only
            continue
        lat = np.array([p[0] for p in ll]); lon = np.array([p[1] for p in ll])
        inside = shapely.contains_xy(g, lon, lat)
        if inside.all():
            continue
        # distance outside, in km, on a plane scaled for longitude at the state's mid-latitude
        c = math.cos(math.radians(g.centroid.y))
        gs = scale(g, xfact=c, yfact=1, origin=(0, 0))
        for i in np.nonzero(~inside)[0]:
            d_km = gs.distance(shapely.Point(lon[i] * c, lat[i])) * 111.2
            if d_km > MAX_OUTSIDE_KM:
                bad.append((st, float(lat[i]), float(lon[i])))
    if bad:
        con.execute("CREATE TEMP TABLE badpos (st VARCHAR, lat DOUBLE, lon DOUBLE)")
        con.executemany("INSERT INTO badpos VALUES (?, ?, ?)", bad)
        con.execute("UPDATE inv SET pos_ok = false FROM badpos b WHERE inv.st = b.st AND inv.lat = b.lat AND inv.lon = b.lon")
        con.execute("DROP TABLE badpos")
    print(f"inventory positions: {len(pts):,} distinct, {len(bad):,} more than {MAX_OUTSIDE_KM} km outside their state")


def fill_age_and_area(con):
    """Fill missing BRIDGE_AGE_YEARS / DECK_AREA_SQFT in table y (element records).

    1. From the inventory record of the same bridge and year: age = year − year built (item 27),
       deck area = structure length (item 49) × deck width (item 52), the export's own formula.
    2. Otherwise from the same bridge's other years: year built = data year − age, and its latest
       deck area.
    Values the export already has are never changed.
    """
    before = con.execute("SELECT count(*) FILTER (WHERE age IS NULL), count(*) FILTER (WHERE area IS NULL) FROM y").fetchone()
    con.execute("""UPDATE y SET age = y.yr - i.yb FROM inv i
                   WHERE y.age IS NULL AND i.st = y.st AND i.k = y.sn AND i.yr = y.yr AND i.yb IS NOT NULL""")
    con.execute("""UPDATE y SET area = i.area_sqft FROM inv i
                   WHERE y.area IS NULL AND i.st = y.st AND i.k = y.sn AND i.yr = y.yr AND i.area_sqft IS NOT NULL""")
    # year built: the most common one among the bridge's records (ties: the latest); deck area:
    # from its latest year (ties: the largest)
    con.execute("""CREATE TEMP TABLE ref AS
                   SELECT st, sn, b.yb, a.area FROM
                     (SELECT st, sn, arg_max(yb, n * 10000 + yb) AS yb FROM
                        (SELECT st, sn, yr - age AS yb, count(*) AS n FROM y WHERE age IS NOT NULL GROUP BY ALL)
                      GROUP BY st, sn) b
                   FULL JOIN
                     (SELECT st, sn, area FROM y WHERE area IS NOT NULL
                      QUALIFY row_number() OVER (PARTITION BY st, sn ORDER BY yr DESC, area DESC) = 1) a
                   USING (st, sn)""")
    con.execute("UPDATE y SET age = y.yr - r.yb FROM ref r WHERE y.age IS NULL AND r.st = y.st AND r.sn = y.sn AND r.yb IS NOT NULL")
    con.execute("UPDATE y SET area = r.area FROM ref r WHERE y.area IS NULL AND r.st = y.st AND r.sn = y.sn AND r.area IS NOT NULL")
    con.execute("DROP TABLE ref")
    after = con.execute("SELECT count(*) FILTER (WHERE age IS NULL), count(*) FILTER (WHERE area IS NULL) FROM y").fetchone()
    print(f"filled age on {before[0] - after[0]:,} element records and deck area on {before[1] - after[1]:,} "
          f"(still missing: age {after[0]:,}, deck area {after[1]:,})")


def write_locations(con, out_dir, years_all, write_json):
    """Write <out_dir>/<ST>/bridges.json for every bridge in the element data.

    Columns (one entry per bridge, sorted by id):
      id    structure number with spaces and leading zeros removed (the key used everywhere); the
            zeros stay where both spellings occur in the same year, as those are two bridges
      lat, lon  position in degrees × 1e5 (integers), from the bridge's latest NBI year with a usable
            position; null if it never has one
      nbi   bit mask of the years in which the bridge is in the NBI inventory (bit 0 = first year)
      el    bit mask of the years in which it has element data
      flag  0 = position from its latest NBI year; 1 = latest NBI year unusable, position from an
            earlier year; 2 = no usable position; 3 = not found in the NBI inventory
    moved: {"<row>": [[firstYear, lastYear, lat, lon], ...]} for years whose usable position differs
           by more than MOVE_KM from lat/lon (relocations and coordinate corrections).

    Also writes <out_dir>/all-bridges.json, every bridge with a usable position in one file, for the
    "Every bridge" view of the step 1 map (see write_national).
    """
    y0 = years_all[0]
    el = con.execute("SELECT st, sn, list(DISTINCT yr) FROM y GROUP BY st, sn").fetchall()
    inv = con.execute("SELECT st, k, yr, lat, lon, pos_ok FROM inv ORDER BY st, k, yr").fetchall()
    inv_by = {}
    for st, k, yr, lat, lon, ok in inv:
        inv_by.setdefault((st, k), []).append((yr, lat, lon, ok))
    by_state = {}
    for st, sn, yrs in el:
        by_state.setdefault(st, []).append((sn, yrs))
    summary, national = {}, []
    for st, rows in by_state.items():
        rows.sort()
        out = {"state": st, "years": years_all, "id": [], "lat": [], "lon": [], "nbi": [], "el": [], "flag": [], "moved": {}}
        counts = [0, 0, 0, 0]
        for i, (sn, yrs) in enumerate(rows):
            recs = inv_by.get((st, sn), [])
            good = [(yr, lat, lon) for yr, lat, lon, ok in recs if ok]
            if not recs:
                flag, lat, lon = 3, None, None
            elif not good:
                flag, lat, lon = 2, None, None
            else:
                yr_m, lat, lon = good[-1]
                flag = 0 if yr_m == recs[-1][0] else 1
                runs = []
                for yr, la, lo in good:
                    dkm = math.hypot((la - lat) * 111.2, (lo - lon) * 111.2 * math.cos(math.radians(lat)))
                    if dkm <= MOVE_KM:
                        continue
                    if runs and runs[-1][1] == yr - 1 and math.hypot((la - runs[-1][2]) * 111.2,
                                                                      (lo - runs[-1][3]) * 111.2 * math.cos(math.radians(la))) <= MOVE_KM:
                        runs[-1][1] = yr
                    else:
                        runs.append([yr, yr, la, lo])
                if runs:
                    out["moved"][str(i)] = [[a, b, round(la * 1e5), round(lo * 1e5)] for a, b, la, lo in runs]
            counts[flag] += 1
            out["id"].append(sn)
            out["lat"].append(None if lat is None else round(lat * 1e5))
            out["lon"].append(None if lon is None else round(lon * 1e5))
            out["nbi"].append(sum(1 << (yr - y0) for yr, *_ in recs if yr >= y0))
            out["el"].append(sum(1 << (yr - y0) for yr in yrs if yr >= y0))
            out["flag"].append(flag)
            if lat is not None:
                national.append((st, lat, lon, max(yrs)))
        os.makedirs(os.path.join(out_dir, st), exist_ok=True)
        write_json(os.path.join(out_dir, st, "bridges.json"), out)
        summary[st] = {"bridges": len(rows), "withPosition": counts[0] + counts[1], "noPosition": counts[2], "notInInventory": counts[3]}
    write_national(out_dir, national, write_json)
    return summary


def write_national(out_dir, points, write_json):
    """Write <out_dir>/all-bridges.json: every bridge in the element data with a usable position.

    It feeds the "Every bridge" view of the step 1 map, a national preview, so positions are rounded
    to 0.01 degree (about 1 km, finer than a pixel at that scale), which halves the file.
      first   first year with element data; `last` values are offsets from it
      states  state codes in order, and count: the number of bridges of each, in the same order
      lon, lat  degrees x 100, delta-encoded over the whole list (each value minus the one before);
            bridges grouped by state, then sorted by longitude and latitude
      last    latest year with element data, as an offset from `first`
    """
    first = min(p[3] for p in points)
    states = sorted({p[0] for p in points})
    out = {"first": first, "states": states, "count": [], "lon": [], "lat": [], "last": []}
    px = py = 0
    for st in states:
        rows = sorted((round(lon * 100), round(lat * 100), last) for s, lat, lon, last in points if s == st)
        out["count"].append(len(rows))
        for x, y, last in rows:
            out["lon"].append(x - px); out["lat"].append(y - py); px, py = x, y
            out["last"].append(last - first)
    write_json(os.path.join(out_dir, "all-bridges.json"), out)


def _sig3(v):
    """Round a positive number to 3 significant figures (as the site displays it)."""
    if not v:
        return 0
    d = len(str(int(v))) - 3
    return int(round(v, -d)) if d > 0 else int(v)


def write_element_locations(con, out_dir, base_year, age_min, age_max, write_json, tiebreak):
    """Write <out_dir>/<ST>/loc/<EN>.json(.gz): which bridges have the element and their record
    for every data year, so the site can map the bridges of any period.

    One record per bridge, element and year, picked as in prepare_nbi.py (positive quantity first,
    then the larger quantity). Consecutive years with identical values (the element is usually
    inspected every two years and carried over in between) are stored once as a run.

      base   first data year; run years are offsets from it
      row    for each bridge: its row in <ST>/bridges.json (sorted ids), delta-encoded
             (each value is the difference from the previous row)
      nrun   for each bridge: how many runs it has (runs are listed bridge by bridge)
      Per run, one column each (stored as columns because they compress far better):
      yy     y0·100 + y1, as offsets from base (first and last year of the run)
      yb     year built (0 if unknown)
      q      element quantity in the element's unit, to 3 significant figures
      s1, s2, s3  CS1, CS2, CS3 share in 0.1% (CS4 = 1000 − the others)
      ex     exclusion: 0 none, 1 no quantity, 2 quantity check, 3 no deck area, 4 no age
    Age at a record year = year − year built; ages outside age_min..age_max are left out as in
    the charts ("age out of range"), which the site checks itself.
    """
    con.execute(f"""
        CREATE TABLE locrec AS
        WITH d AS (
          SELECT st, en, sn, yr, tot, cs1, cs2, cs3, age, area, qc FROM y
          QUALIFY row_number() OVER (PARTITION BY st, en, sn, yr ORDER BY {tiebreak}) = 1),
        v AS (
          SELECT st, en, sn, yr,
            CASE WHEN tot IS NULL OR tot <= 0 THEN 1
                 WHEN qc IS NOT NULL AND qc <> 'ok' THEN 2
                 WHEN area IS NULL OR area <= 0 THEN 3
                 WHEN age IS NULL THEN 4 ELSE 0 END AS ex,
            CASE WHEN age IS NULL THEN 0 ELSE yr - age END AS yb,
            CASE WHEN tot > 0 THEN round(tot)::BIGINT ELSE 0 END AS q,
            CASE WHEN tot > 0 THEN round(coalesce(cs1, 0) / tot * 1000)::INTEGER ELSE 0 END AS s1,
            CASE WHEN tot > 0 THEN round(coalesce(cs2, 0) / tot * 1000)::INTEGER ELSE 0 END AS s2,
            CASE WHEN tot > 0 THEN round(coalesce(cs3, 0) / tot * 1000)::INTEGER ELSE 0 END AS s3
          FROM d),
        f AS (
          SELECT *, CASE WHEN lag(yr) OVER w = yr - 1 AND lag(ex) OVER w = ex AND lag(yb) OVER w = yb
                          AND lag(q) OVER w = q AND lag(s1) OVER w = s1 AND lag(s2) OVER w = s2
                          AND lag(s3) OVER w = s3 THEN 0 ELSE 1 END AS brk
          FROM v WINDOW w AS (PARTITION BY st, en, sn ORDER BY yr)),
        g AS (SELECT *, sum(brk) OVER (PARTITION BY st, en, sn ORDER BY yr) AS run FROM f)
        SELECT st, en, sn, run, min(yr) AS y0, max(yr) AS y1, any_value(yb) AS yb, any_value(q) AS q,
               any_value(s1) AS s1, any_value(s2) AS s2, any_value(s3) AS s3, any_value(ex) AS ex
        FROM g GROUP BY st, en, sn, run""")
    nrec, nruns = con.execute("SELECT (SELECT count(*) FROM y), count(*) FROM locrec").fetchone()
    states = [r[0] for r in con.execute("SELECT DISTINCT st FROM locrec ORDER BY st").fetchall()]
    nfiles = 0
    for st in states:
        ids = [r[0] for r in con.execute("SELECT DISTINCT sn FROM y WHERE st = ? ORDER BY sn", [st]).fetchall()]
        row_of = {sn: i for i, sn in enumerate(ids)}
        cur = None
        for en, sn, y0, y1, yb, q, s1, s2, s3, ex in con.execute(
                "SELECT en, sn, y0, y1, yb, q, s1, s2, s3, ex FROM locrec WHERE st = ? ORDER BY en, sn, y0", [st]).fetchall():
            if cur is None or cur["en"] != en:
                if cur:
                    write_json(os.path.join(out_dir, st, "loc", f"{cur['en']}.json"), cur); nfiles += 1
                os.makedirs(os.path.join(out_dir, st, "loc"), exist_ok=True)
                cur = {"en": en, "state": st, "base": base_year, "row": [], "nrun": [],
                       "yy": [], "yb": [], "q": [], "s1": [], "s2": [], "s3": [], "ex": []}
                last = None; prev_row = 0
            if sn != last:
                r_ = row_of[sn]
                cur["row"].append(r_ - prev_row); prev_row = r_
                cur["nrun"].append(0); last = sn
            cur["nrun"][-1] += 1
            cur["yy"].append((y0 - base_year) * 100 + (y1 - base_year)); cur["yb"].append(yb)
            cur["q"].append(_sig3(q)); cur["s1"].append(s1); cur["s2"].append(s2); cur["s3"].append(s3); cur["ex"].append(ex)
        if cur:
            write_json(os.path.join(out_dir, st, "loc", f"{cur['en']}.json"), cur); nfiles += 1
    con.execute("DROP TABLE locrec")
    return nfiles, nrec, nruns
