"""Bridge health scores (Basic Analytics, bridge level): one score per bridge and data year.

Used by prepare_nbi.py, which writes public/data/<ST>/health.json(.gz) for every state.

Scores
  Element score  = 100 × (CS1 + 0.67 × CS2 + 0.33 × CS3) ÷ total quantity
                   (100 when all of the element is in CS1, 0 when all of it is in CS4)
  Bridge score   = Σ(quantity × unit cost × element score) ÷ Σ(quantity × unit cost), over the
                   element types on the bridge. Since the element score divides by the same
                   quantity, quantity × element score = 100 × (CS1 + 0.67 × CS2 + 0.33 × CS3).
  Unit costs       One cost per unit of quantity (sq ft, ft, each). Visitors can change them on
                   the site, which recomputes every score in the browser from the per-unit columns
                   below. The NBI has no unit costs, so the defaults are placeholders
                   (UNIT_COST_BY_UNIT): $40 per sq ft, $1,200 per ft and $16,000 each. They follow
                   the typical (median) element size in each unit in the 2025 data (5,100 sq ft,
                   162 ft, 12 each), so a typical element weighs about the same whatever its unit
                   (5,100 × 40 ≈ 162 × 1,200 ≈ 12 × 16,000 ≈ 200,000), and a bigger element weighs
                   more than a smaller one in the same unit.
  Per unit         With one cost per unit, a bridge score only needs, for each unit u, the total
                   quantity Q_u of its elements in that unit and N_u = Σ(100 × CS1 + 67 × CS2 +
                   33 × CS3) over them (quantity × element score, summed). Then
                   bridge score = Σ(c_u × N_u) ÷ Σ(c_u × Q_u).
                   NBI quantities are whole numbers, so Q_u and N_u are whole numbers and the
                   browser gets exactly the same score as this script for any costs.
  Units            A record with no unit takes its element type's usual unit. Element types that
                   never have a unit (15 types, 2,380 records, mostly agency elements 600–610 in
                   one state) are left out, since no unit cost can apply to them.
  An element record counts when it has a positive total quantity and has not failed the
  quantity check (the same records the charts use). Deck area and age are not needed for the
  score. Each bridge, element type and year has one record, picked as for the charts.

File columns (bridges are rows of <ST>/bridges.json, which lists every bridge sorted by id)
  base   first data year; run years are offsets from it
  row    for each bridge with a score: its row in bridges.json, delta-encoded
  yb     year built (0 if unknown): from the bridge's latest data year with an age
  nrun   number of runs per bridge
  units  the unit names, in the order of the per-unit columns: ["sq ft", "ft", "each"]
  cost   the default (placeholder) cost per unit, in the same order
  Per run (consecutive data years with the same element count and per-unit values):
  yy     y0·100 + y1, as offsets from base (first and last year of the run)
  ne     number of element types in the score
  q      one list per unit: Q_u, total quantity of the bridge's elements in that unit (0 if none)
  n      one list per unit: N_u, Σ(100 × CS1 + 67 × CS2 + 33 × CS3) over those elements
  The score at given costs is round(Σ c_u N_u ÷ Σ c_u Q_u × 10) ÷ 10, worked out in double
  precision (bridge_score() below and healthScores() in index.html do the same).
Sums are exact, so the file is identical byte for byte whenever the input is.
"""
import math
import os


# default (placeholder) unit costs ($ per unit of quantity). Visitors can change them on the site.
UNIT_COST_BY_UNIT = {"sq ft": 40, "ft": 1200, "each": 16000}
UNITS = list(UNIT_COST_BY_UNIT)


def bridge_score(q, n, cost):
    """Score × 10 for per-unit totals q, n and per-unit costs, as healthScores() in index.html."""
    w = float(sum(c * x for c, x in zip(cost, q)))
    return int(math.floor(float(sum(c * x for c, x in zip(cost, n))) / w * 10 + 0.5)) if w > 0 else -1


def write_health(con, out_dir, base_year, write_json, tiebreak):
    units_sql = ", ".join(f"'{u}'" for u in UNITS)
    # per unit: Q_u (total quantity) and N_u (Σ 100 CS1 + 67 CS2 + 33 CS3), so the browser can
    # recompute the score for any unit costs
    per_unit = ", ".join(
        f"coalesce(sum(tot) FILTER (WHERE un = '{u}'), 0)::BIGINT AS q{i}, "
        f"coalesce(round(sum(num) FILTER (WHERE un = '{u}')), 0)::BIGINT AS n{i}"
        for i, u in enumerate(UNITS))
    pu_cols = [f"{c}{i}" for i in range(len(UNITS)) for c in ("q", "n")]
    con.execute(f"""
        CREATE TEMP TABLE hrec AS
        WITH u AS (
          -- each element type's usual unit, for the few records that have none
          SELECT en, unit AS eu FROM (SELECT en, unit, count(*) AS n FROM y WHERE unit IS NOT NULL GROUP BY en, unit)
          QUALIFY row_number() OVER (PARTITION BY en ORDER BY n DESC, unit) = 1),
        d AS (
          SELECT y.st, y.en, y.sn, y.yr, y.tot, y.cs1, y.cs2, y.cs3, y.age, y.qc, y.unit, u.eu FROM y LEFT JOIN u USING (en)
          QUALIFY row_number() OVER (PARTITION BY y.st, y.en, y.sn, y.yr ORDER BY {tiebreak}) = 1),
        e AS (
          -- un: the record's unit, or its element type's usual unit (records without either are
          -- left out). num = quantity × element score = 100 CS1 + 67 CS2 + 33 CS3
          SELECT st, sn, yr, age, coalesce(unit, eu) AS un, tot::DECIMAL(28,6) AS tot,
            (100 * coalesce(cs1, 0) + 67 * coalesce(cs2, 0) + 33 * coalesce(cs3, 0))::DECIMAL(28,6) AS num
          FROM d WHERE tot > 0 AND (qc IS NULL OR qc = 'ok') AND coalesce(unit, eu) IN ({units_sql}))
        SELECT st, sn, yr, count(*)::INTEGER AS ne,
               max(yr - age) FILTER (WHERE age IS NOT NULL) AS yb, {per_unit}
        FROM e GROUP BY st, sn, yr""")
    # runs: consecutive years with the same element count and per-unit values
    same = " AND ".join(f"lag({c}) OVER w = {c}" for c in ["ne"] + pu_cols)
    con.execute(f"""
        CREATE TEMP TABLE hrun AS
        WITH f AS (
          SELECT *, CASE WHEN lag(yr) OVER w = yr - 1 AND {same} THEN 0 ELSE 1 END AS brk
          FROM hrec WINDOW w AS (PARTITION BY st, sn ORDER BY yr)),
        g AS (SELECT *, sum(brk) OVER (PARTITION BY st, sn ORDER BY yr) AS run FROM f)
        SELECT st, sn, run, min(yr) AS y0, max(yr) AS y1, any_value(ne) AS ne,
               {", ".join(f"any_value({c}) AS {c}" for c in pu_cols)}
        FROM g GROUP BY st, sn, run""")
    # year built per bridge: from its latest year with an age (ties: the later year built)
    ybs = {(st, sn): yb for st, sn, yb in con.execute("""
        SELECT st, sn, arg_max(yb, yr * 10000 + yb) FROM hrec WHERE yb IS NOT NULL GROUP BY st, sn""").fetchall()}
    states = [r[0] for r in con.execute("SELECT DISTINCT st FROM hrun ORDER BY st").fetchall()]
    nruns = 0
    for st in states:
        ids = [r[0] for r in con.execute("SELECT DISTINCT sn FROM y WHERE st = ? ORDER BY sn", [st]).fetchall()]
        row_of = {sn: i for i, sn in enumerate(ids)}
        out = {"state": st, "base": base_year, "units": UNITS, "cost": [UNIT_COST_BY_UNIT[u] for u in UNITS],
               "row": [], "yb": [], "nrun": [], "yy": [], "ne": [],
               "q": [[] for _ in UNITS], "n": [[] for _ in UNITS]}
        last, prev_row = None, 0
        for sn, y0, y1, ne, *pu in con.execute(
                f"SELECT sn, y0, y1, ne, {', '.join(pu_cols)} FROM hrun WHERE st = ? ORDER BY sn, y0", [st]).fetchall():
            if sn != last:
                r = row_of[sn]
                out["row"].append(r - prev_row); prev_row = r
                yb = ybs.get((st, sn))
                out["yb"].append(int(yb) if yb is not None and 1700 <= yb <= 2100 else 0)
                out["nrun"].append(0); last = sn
            out["nrun"][-1] += 1
            out["yy"].append((y0 - base_year) * 100 + (y1 - base_year))
            out["ne"].append(int(ne))
            for i in range(len(UNITS)):
                out["q"][i].append(int(pu[2 * i])); out["n"][i].append(int(pu[2 * i + 1]))
            nruns += 1
        write_json(os.path.join(out_dir, st, "health.json"), out)
    nrec = con.execute("SELECT count(*) FROM hrec").fetchone()[0]
    con.execute("DROP TABLE hrec; DROP TABLE hrun")
    return len(states), nrec, nruns
