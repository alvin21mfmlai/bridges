#!/usr/bin/env python3
"""Pre-build the site's data files from the NBI element export.

    python scripts/prepare_nbi.py <summary_states_nbi_data.zip | extracted folder> [<nbi_inventory folder>]

Reads every <STATE>/bridge_element_yearly.csv (the by_element/ files hold the same rows and
are ignored) and writes small JSON files to public/data/:

    public/data/index.json            jurisdictions, years, bridge counts
    public/data/<ST>/index.json       element types of a state, valid periods, bridges per period
    All files are written gzip-compressed (<name>.json.gz); the site decompresses them.
    public/data/<ST>/<EN>.json        condition-state profile cells and (0, 5]% counts, grouped by end year
                                      and record year
    public/data/<ST>/bridges.json     (with the inventory folder) every bridge's position and the years it
                                      appears in the NBI inventory and in the element data

With the NBI inventory folder (one sub-folder per year, 2015 ... 2025, holding the FHWA delimited
state files), missing ages and deck areas are also filled from it; see scripts/nbi_inventory.py.

Profile rule, per state × element type × period:
  - Each bridge counts once, at its latest data year inside the period.
  - A bridge is identified by state + structure number with spaces and leading zeros removed
    (some states report the same bridge as "000037SR0010004" in one year and "37SR0010004"
    in another; compared as written, it would be counted twice).
  - Age = BRIDGE_AGE_YEARS at that year (data year − year built), 5-year bins 1–5 … 96–100.
  - CSk share = CSk / TOTALQTY × 100, 5% bins [0,5], (5,10] … (95,100].
  - A cell holds the summed deck area (sq ft) and the number of bridges.
  - Excluded, with counts: no quantity, quantity check failed, no deck area, no age,
    age outside 1–100.
Only data years from MIN_YEAR (2016) onwards are used.
Periods: any start and end data year holding at least 5 data years. A state with 5 or fewer
data years has one period covering all of them.

Storage: for each valid end year e, every bridge's latest record up to e is grouped by that
record's year g (ends[e][g]). A period [s, e] is the sum of the groups g = s … e at end e,
which is exactly "latest record inside [s, e]". The browser does that sum.

Requires: pip install duckdb (and shapely, when the inventory folder is given)
"""
import duckdb, gzip, json, os, shutil, sys, tempfile, time, zipfile

GROUP_FIELDS = ["bridges", "deckArea", "excluded", "cells", "low", "qty"]
EXCLUSIONS = ["no_quantity", "quantity_check", "no_deck_area", "no_age", "age_out_of_range"]
AGE_MIN, AGE_MAX, AGE_W, CS_W, WIN = 1, 100, 5, 5, 5
MIN_YEAR = 2016  # data years before this are dropped (2015 is too sparse)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data")
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico", "GU": "Guam",
    "VI": "U.S. Virgin Islands", "AS": "American Samoa", "MP": "Northern Mariana Islands",
}


def source_glob(src):
    """Return a glob of yearly CSVs, extracting them from the zip if needed."""
    if os.path.isdir(src):
        return os.path.join(src, "*", "bridge_element_yearly.csv"), None
    tmp = tempfile.mkdtemp(prefix="nbi_")
    with zipfile.ZipFile(src) as z:
        names = [n for n in z.namelist() if n.endswith("/bridge_element_yearly.csv") and n.count("/") == 1]
        for n in names:
            z.extract(n, tmp)
    return os.path.join(tmp, "*", "bridge_element_yearly.csv"), tmp


def total_ram_bytes():
    """Physical memory of this machine, or None if it cannot be read."""
    try:
        if os.name == "nt":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS(); m.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.ullTotalPhys
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except Exception:
        return None


def memory_limit():
    """DuckDB memory limit: NBI_MEMORY_LIMIT if set (e.g. "6GB"), else 40% of RAM, between 3 and 8 GB."""
    if os.environ.get("NBI_MEMORY_LIMIT"):
        return os.environ["NBI_MEMORY_LIMIT"]
    ram = total_ram_bytes()
    gb = 3 if not ram else min(8, max(3, int(ram / 2**30 * 0.4)))
    return f"{gb}GB"


def write_json(path, obj):
    """Write obj as compact JSON, gzip-compressed, to path + ".gz" (the site reads the .gz files).
    mtime=0 keeps the bytes identical when the data is unchanged, so git only sees real changes."""
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    with open(path + ".gz", "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=9, mtime=0, filename="") as gz:
        gz.write(data)


def main(src, inv_dir=None):
    t0 = time.time()
    pattern, tmp = source_glob(src)
    work = tempfile.mkdtemp(prefix="nbi_db_")
    con = duckdb.connect(os.path.join(work, "work.duckdb"))
    mem = memory_limit()
    con.execute(f"SET memory_limit='{mem}'; SET threads=2; SET temp_directory='{work}'; SET preserve_insertion_order=false")
    print(f"database memory limit {mem} (set NBI_MEMORY_LIMIT, e.g. 6GB, to change it)")
    con.execute(f"""
        CREATE TABLE y AS SELECT
            STATE_CODE AS st, ltrim(upper(replace(STRUCNUM, ' ', '')), '0') AS sn, EN::INTEGER AS en, ELEMENT_NAME AS name, QUANTITY_UNIT AS unit,
            DATA_YEAR::INTEGER AS yr, TOTALQTY::DOUBLE AS tot,
            CS1::DOUBLE AS cs1, CS2::DOUBLE AS cs2, CS3::DOUBLE AS cs3, CS4::DOUBLE AS cs4,
            BRIDGE_AGE_YEARS::INTEGER AS age, DECK_AREA_SQFT::DOUBLE AS area, QUANTITY_CHECK AS qc
        FROM read_csv('{pattern}', header=true, union_by_name=true, sample_size=-1)
        WHERE DATA_YEAR >= {MIN_YEAR}""")
    print(f"loaded {con.execute('select count(*) from y').fetchone()[0]:,} rows in {time.time()-t0:.0f}s")
    if inv_dir:
        import nbi_inventory
        nf, nr = nbi_inventory.load(con, inv_dir, work)
        print(f"loaded {nr:,} inventory records from {nf} files in {time.time()-t0:.0f}s")
        nbi_inventory.fill_age_and_area(con)
        con.execute("CHECKPOINT")

    # data years, valid periods and valid end years per state.
    # A period [s, e] runs between two data years and holds at least WIN data years;
    # a state with WIN or fewer data years has one period: all of them.
    years = {st: sorted(ys) for st, ys in con.execute("select st, list(distinct yr) from y group by st").fetchall()}
    windows = []  # (st, key, start, end)
    for st, ys in years.items():
        if len(ys) <= WIN:
            windows.append((st, f"{ys[0]}-{ys[-1]}", ys[0], ys[-1]))
        else:
            for i, s in enumerate(ys):
                for j in range(i + WIN - 1, len(ys)):
                    windows.append((st, f"{s}-{ys[j]}", s, ys[j]))
    ends = sorted({(st, e) for st, _, _, e in windows})
    con.execute("CREATE TABLE ends (st VARCHAR, e INTEGER)")
    con.executemany("INSERT INTO ends VALUES (?,?)", ends)

    # For each valid end year e: the latest record per bridge × element up to e, labelled with
    # that record's year g. The latest record in a period [s, e] is the latest record up to e
    # whenever its year g >= s, so any period is the sum of groups g = s..e at end e.
    pick_sql = f"""
        SELECT *,
          CASE WHEN tot IS NULL OR tot <= 0 THEN 'no_quantity'
               WHEN qc IS NOT NULL AND qc <> 'ok' THEN 'quantity_check'
               WHEN area IS NULL OR area <= 0 THEN 'no_deck_area'
               WHEN age IS NULL THEN 'no_age'
               WHEN age < {AGE_MIN} OR age > {AGE_MAX} THEN 'age_out_of_range'
               ELSE NULL END AS excl
        FROM (
          SELECT y.*, ends.e, y.yr AS g FROM y JOIN ends ON y.st = ends.st AND y.yr <= ends.e
          WHERE y.st = $st
          QUALIFY row_number() OVER (PARTITION BY y.st, y.en, ends.e, y.sn ORDER BY y.yr DESC, (y.tot > 0) DESC, y.tot DESC) = 1
        )"""
    # one state at a time keeps memory bounded
    con.execute(f"CREATE TABLE pick AS {pick_sql.replace('$st', repr(sorted(years)[0]))} LIMIT 0")
    for st in sorted(years):
        con.execute(f"INSERT INTO pick {pick_sql}", {"st": st})
    print(f"picked latest records per end year in {time.time()-t0:.0f}s")
    # long format: one row per bridge × CS; bin indices
    con.execute(f"""
        CREATE TABLE cellsz AS
        WITH long AS (
          SELECT st, en, e, g, sn, area, age, k, 100.0 * q / tot AS pct FROM (
            SELECT st, en, e, g, sn, area, age, tot, unnest([1,2,3,4]) AS k, unnest([cs1,cs2,cs3,cs4]) AS q
            FROM pick WHERE excl IS NULL)
        ), b AS (
          SELECT *, ((age - {AGE_MIN}) // {AGE_W})::INTEGER AS u,
                 CASE WHEN round(pct, 9) <= {CS_W} THEN 0
                      ELSE least({100 // CS_W - 1}, ceil(round(pct, 9) / {CS_W} - 1e-9)::INTEGER - 1) END AS v,
                 round(pct, 9) <= 0 AS z
          FROM long
        )
        SELECT st, en, e, g, k, u, v, z, sum(area) AS area, count(*) AS n
        FROM b GROUP BY ALL""")
    # cells: the 3D profile bins (a 0% share falls in the first bin, [0, 5]);
    # low: bridges with a share above 0% and up to 5% (csBin 0 without the exact zeros), per age
    # band. Stored instead of the zeros because it is far sparser (most bridges have no CS3/CS4);
    # the browser gets the 0% count as csBin 0 minus low.
    print(f"binned cells in {time.time()-t0:.0f}s")
    con.execute("CREATE TABLE cells AS SELECT st, en, e, g, k, u, v, sum(area) AS area, sum(n) AS n FROM cellsz GROUP BY ALL")
    con.execute("CREATE TABLE zeros AS SELECT st, en, e, g, k, u, area, n FROM cellsz WHERE v = 0 AND NOT z")

    # sanity: in every state × element × end × group, each CS figure holds the same bridges and area
    bad = con.execute("""
        SELECT count(*) FROM (SELECT st, en, e, g, count(DISTINCT round(a, 3)) d, count(DISTINCT nn) dn
          FROM (SELECT st, en, e, g, k, sum(area) a, sum(n) nn FROM cells GROUP BY ALL) GROUP BY ALL)
        WHERE d > 1 OR dn > 1""").fetchone()[0]
    assert bad == 0, f"{bad} groups have inconsistent totals across CS figures"

    meta_el = con.execute("""
        SELECT en, mode(name) AS name, mode(unit) AS unit FROM y GROUP BY en""").fetchall()
    el_info = {en: {"name": n, "unit": u} for en, n, u in meta_el}

    if os.path.isdir(OUT):
        for d in os.listdir(OUT):
            p = os.path.join(OUT, d)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    os.makedirs(OUT, exist_ok=True)

    bridges_state = dict(con.execute("SELECT st, count(DISTINCT sn) FROM y GROUP BY st").fetchall())
    rows_year = {}
    for st, yr, n in con.execute("SELECT st, yr, count(DISTINCT sn) FROM y GROUP BY st, yr").fetchall():
        rows_year.setdefault(st, {})[yr] = n
    nv = 100 // CS_W
    nu = (AGE_MAX - AGE_MIN + 1) // AGE_W

    # one state at a time, so that only one state's cells are held in memory
    states_index = {}
    for st in sorted(years):
        groups = con.execute("""
            SELECT en, e, g, count(*) FILTER (WHERE excl IS NULL) n, coalesce(sum(area) FILTER (WHERE excl IS NULL), 0) a,
                   count(*) FILTER (WHERE excl='no_quantity'), count(*) FILTER (WHERE excl='quantity_check'),
                   count(*) FILTER (WHERE excl='no_deck_area'), count(*) FILTER (WHERE excl='no_age'),
                   count(*) FILTER (WHERE excl='age_out_of_range')
            FROM pick WHERE st = ? GROUP BY ALL ORDER BY en, e, g""", [st]).fetchall()
        by_group = {}
        for en, e, g, k, u, v, area, n in con.execute(
                "SELECT en, e, g, k, u, v, area, n FROM cells WHERE st = ? ORDER BY en, e, g, k, u, v", [st]).fetchall():
            # packed cell: code = (cs − 1)·nu·nv + ageBin·nv + csBin, then deck area (sq ft, rounded), then bridges
            by_group.setdefault((en, e, g), []).extend([(k - 1) * nu * nv + u * nv + v, round(area), n])
        zero_group = {}
        for en, e, g, k, u, area, n in con.execute(
                "SELECT en, e, g, k, u, area, n FROM zeros WHERE st = ? ORDER BY en, e, g, k, u", [st]).fetchall():
            # packed low count: code = (cs − 1)·nu + ageBin, then deck area (sq ft, rounded), then bridges
            zero_group.setdefault((en, e, g), []).extend([(k - 1) * nu + u, round(area), n])
        # element quantity in each condition state, summed per age band, for the analytics
        # (Weibull CS1 survival, Markov transitions, quantity propagation)
        qty_group = {}
        for en, e, g, u, n, q1, q2, q3, q4 in con.execute(f"""
                SELECT en, e, g, ((age - {AGE_MIN}) // {AGE_W})::INTEGER AS u, count(*) AS n,
                       sum(cs1), sum(cs2), sum(cs3), sum(cs4)
                FROM pick WHERE excl IS NULL AND st = ? GROUP BY ALL ORDER BY en, e, g, u""", [st]).fetchall():
            # [ageBin, bridges, CS1 qty, CS2 qty, CS3 qty, CS4 qty], quantities rounded
            qty_group.setdefault((en, e, g), []).extend([u, n, round(q1), round(q2), round(q3), round(q4)])

        files = {}
        for en, e, g, n, a, e1, e2, e3, e4, e5 in groups:
            f = files.setdefault(en, {"en": en, **el_info[en], "state": st, "groupFields": GROUP_FIELDS, "ends": {}})
            # ends[e][g]: bridges whose latest record up to end year e is from year g.
            # Each group is a list in GROUP_FIELDS order (names are not repeated, to save space):
            #   bridges, deckArea (sq ft),
            #   excluded: [no_quantity, quantity_check, no_deck_area, no_age, age_out_of_range], or 0 if none,
            #   cells: flat triples [code, deckAreaSqFt, bridges]; code = (cs−1)·400 + ageBin·20 + csBin,
            #   low: flat triples [code, deckAreaSqFt, bridges] for a CS share above 0% and up to 5%;
            #        code = (cs−1)·20 + ageBin. csBin 0 of cells minus low = exactly 0%,
            #   qty: flat 6-tuples per age band [ageBin, bridges, qCS1, qCS2, qCS3, qCS4] in the element's unit.
            ex = [e1, e2, e3, e4, e5]
            f["ends"].setdefault(str(e), {})[str(g)] = [
                n, round(a), ex if any(ex) else 0,
                by_group.get((en, e, g), []), zero_group.get((en, e, g), []), qty_group.get((en, e, g), [])]

        sw = [(k, s, e) for (s_, k, s, e) in windows if s_ == st]
        els = []
        os.makedirs(os.path.join(OUT, st), exist_ok=True)
        for en, f in files.items():
            els.append({"en": en, "name": f["name"], "unit": f["unit"],
                        "bridges": [sum(grp[0] for gy, grp in f["ends"].get(str(e), {}).items() if int(gy) >= s)
                                    for _, s, e in sw]})
            write_json(os.path.join(OUT, st, f"{en}.json"), f)
        els.sort(key=lambda x: x["en"])
        write_json(os.path.join(OUT, st, "index.json"),
                   {"state": st, "name": STATE_NAMES.get(st, st), "years": years[st],
                    "windows": [{"key": k, "start": s, "end": e} for k, s, e in sw],
                    "bridgesPerYear": rows_year[st], "elements": els})
        states_index[st] = {"name": STATE_NAMES.get(st, st), "years": years[st], "bridges": bridges_state[st],
                            "elementTypes": len(els)}
    print(f"wrote element files in {time.time()-t0:.0f}s")

    if inv_dir:
        inv_years = [r[0] for r in con.execute("SELECT DISTINCT yr FROM inv ORDER BY yr").fetchall()]
        years_all = list(range(min(inv_years[0], MIN_YEAR), max(inv_years[-1], max(max(v) for v in years.values())) + 1))
        loc = nbi_inventory.write_locations(con, OUT, years_all, write_json)
        for st, v in loc.items():
            if st in states_index:
                states_index[st]["locations"] = v
        print(f"wrote bridges.json for {len(loc)} states: {sum(v['withPosition'] for v in loc.values()):,} of "
              f"{sum(v['bridges'] for v in loc.values()):,} bridges have a position")

    write_json(os.path.join(OUT, "index.json"),
               {"generated": time.strftime("%Y-%m-%d"), "source": os.path.basename(src.rstrip("/")),
                "rule": {"minYear": MIN_YEAR, "ageMin": AGE_MIN, "ageMax": AGE_MAX, "ageBinWidth": AGE_W, "csBinWidth": CS_W, "minPeriodYears": WIN},
                "states": states_index})
    con.close()
    shutil.rmtree(work, ignore_errors=True)
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    nfiles = sum(len(fs) for _, _, fs in os.walk(OUT))
    print(f"wrote {nfiles} files, {total/1e6:.1f} MB, to {os.path.normpath(OUT)} in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
