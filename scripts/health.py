"""Bridge health scores (Basic Analytics, bridge level): one score per bridge and data year.

Used by prepare_nbi.py, which writes public/data/<ST>/health.json(.gz) for every state.

Scores
  Element score  = 100 × (CS1 + 0.67 × CS2 + 0.33 × CS3) ÷ total quantity
                   (100 when all of the element is in CS1, 0 when all of it is in CS4)
  Bridge score   = the average of its element scores, each element type counting equally.
                   The formula with costs is Σ(quantity × unit cost × element score) ÷
                   Σ(quantity × unit cost); the NBI has no unit costs, so every element type gets
                   the same weight for now.
  An element record counts when it has a positive total quantity and has not failed the
  quantity check (the same records the charts use). Deck area and age are not needed for the
  score. Each bridge, element type and year has one record, picked as for the charts.

File columns (bridges are rows of <ST>/bridges.json, which lists every bridge sorted by id)
  base   first data year; run years are offsets from it
  row    for each bridge with a score: its row in bridges.json, delta-encoded
  yb     year built (0 if unknown): from the bridge's latest data year with an age
  nrun   number of runs per bridge
  Per run (consecutive data years with the same score and the same number of element types):
  yy     y0·100 + y1, as offsets from base (first and last year of the run)
  sc     bridge score × 10 (0 … 1000)
  ne     number of element types in the score
Sums are exact decimals, so the file is identical byte for byte whenever the input is.
"""
import os


def write_health(con, out_dir, base_year, write_json, tiebreak):
    con.execute(f"""
        CREATE TEMP TABLE hrec AS
        WITH d AS (
          SELECT st, en, sn, yr, tot, cs1, cs2, cs3, age, qc FROM y
          QUALIFY row_number() OVER (PARTITION BY st, en, sn, yr ORDER BY {tiebreak}) = 1),
        e AS (
          SELECT st, sn, yr, age,
            -- element score, rounded to 6 decimals so the sum below is exact and order-free
            (100 * (coalesce(cs1, 0) + 0.67 * coalesce(cs2, 0) + 0.33 * coalesce(cs3, 0)) / tot)::DECIMAL(18,6) AS ehi
          FROM d WHERE tot > 0 AND (qc IS NULL OR qc = 'ok'))
        SELECT st, sn, yr, count(*)::INTEGER AS ne,
               round(sum(ehi) / count(*) * 10)::INTEGER AS sc,
               max(yr - age) FILTER (WHERE age IS NOT NULL) AS yb
        FROM e GROUP BY st, sn, yr""")
    # runs: consecutive years with the same score and element count
    con.execute("""
        CREATE TEMP TABLE hrun AS
        WITH f AS (
          SELECT *, CASE WHEN lag(yr) OVER w = yr - 1 AND lag(sc) OVER w = sc AND lag(ne) OVER w = ne
                         THEN 0 ELSE 1 END AS brk
          FROM hrec WINDOW w AS (PARTITION BY st, sn ORDER BY yr)),
        g AS (SELECT *, sum(brk) OVER (PARTITION BY st, sn ORDER BY yr) AS run FROM f)
        SELECT st, sn, run, min(yr) AS y0, max(yr) AS y1, any_value(sc) AS sc, any_value(ne) AS ne
        FROM g GROUP BY st, sn, run""")
    # year built per bridge: from its latest year with an age (ties: the later year built)
    ybs = {(st, sn): yb for st, sn, yb in con.execute("""
        SELECT st, sn, arg_max(yb, yr * 10000 + yb) FROM hrec WHERE yb IS NOT NULL GROUP BY st, sn""").fetchall()}
    states = [r[0] for r in con.execute("SELECT DISTINCT st FROM hrun ORDER BY st").fetchall()]
    nruns = 0
    for st in states:
        ids = [r[0] for r in con.execute("SELECT DISTINCT sn FROM y WHERE st = ? ORDER BY sn", [st]).fetchall()]
        row_of = {sn: i for i, sn in enumerate(ids)}
        out = {"state": st, "base": base_year, "row": [], "yb": [], "nrun": [], "yy": [], "sc": [], "ne": []}
        last, prev_row = None, 0
        for sn, y0, y1, sc, ne in con.execute(
                "SELECT sn, y0, y1, sc, ne FROM hrun WHERE st = ? ORDER BY sn, y0", [st]).fetchall():
            if sn != last:
                r = row_of[sn]
                out["row"].append(r - prev_row); prev_row = r
                yb = ybs.get((st, sn))
                out["yb"].append(int(yb) if yb is not None and 1700 <= yb <= 2100 else 0)
                out["nrun"].append(0); last = sn
            out["nrun"][-1] += 1
            out["yy"].append((y0 - base_year) * 100 + (y1 - base_year))
            out["sc"].append(int(sc)); out["ne"].append(int(ne))
            nruns += 1
        write_json(os.path.join(out_dir, st, "health.json"), out)
    nrec = con.execute("SELECT count(*) FROM hrec").fetchone()[0]
    con.execute("DROP TABLE hrec; DROP TABLE hrun")
    return len(states), nrec, nruns
