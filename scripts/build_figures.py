#!/usr/bin/env python3
"""Build the small SVG figures used on the portfolio pages.

Every figure is drawn from the data behind the project it represents, and the
script stops if a figure no longer matches the number published with it.

Usage (from the repository root):
  python scripts/build_figures.py --wage-xlsx <path/to/productivity_wage_puzzle.xlsx>
      [--tiers <path/to/performance.json>]

The workbook is public: github.com/rahulsh97/India-Productivity-Wage-Puzzle.
The tier rates come from the Industrial Employment Risk Monitor repository.
"""
import argparse, gzip, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "figures")
INK, SOFT, MUTED, LINE = "#173247", "#355367", "#60727e", "#cfdae0"
BLUE, COPPER, PALE = "#376b88", "#aa6849", "#eaf4f8"
FONT = "'Segoe UI',Inter,Arial,sans-serif"


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" '
            f'aria-label="{title}" font-family="{FONT}"><title>{title}</title>'
            f'<rect width="{w}" height="{h}" fill="#fff"/>{body}</svg>\n')


def text(x, y, s, size=13, fill=MUTED, anchor="start", weight=400):
    s = str(s).replace("&", "&amp;")
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{s}</text>')


def line(x1, y1, x2, y2, stroke=LINE, width=1, dash=""):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{stroke}" stroke-width="{width}"{d}/>')


def save(name, content):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print(f"  {name}: {len(content) / 1024:.1f} KB")


def check(label, got, want, tol):
    if abs(got - want) > tol:
        raise SystemExit(f"CHECK FAILED {label}: got {got}, published {want}")
    print(f"  check {label}: {got:.4f} (published {want})")


def ols(x, y):
    n = len(x)
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    slope = sxy / sxx
    return slope, my - slope * mx, sxy / math.sqrt(sxx * syy)


# ---- Productivity up, wages flat: Figure 2 redrawn from the replication workbook
MAJOR = {"Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana",
         "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra",
         "Odisha", "Punjab", "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh",
         "Uttarakhand", "West Bengal"}
EXTRACTIVE = {"Jharkhand", "Odisha", "Goa", "Chhattisgarh", "Himachal Pradesh", "Madhya Pradesh"}


def wage_share_states(xlsx):
    import openpyxl
    rows = list(openpyxl.load_workbook(xlsx, data_only=True, read_only=True)["Sheet1"].iter_rows(values_only=True))
    ix = {name: i for i, name in enumerate(rows[0])}
    pts, india = [], None
    for r in rows[1:]:
        st, gva, wage = r[ix["state/UT"]], r[ix["GVA/Worker (ASI)"]], r[ix["Wages/worker (ASI)"]]
        if not st or gva in (None, "") or wage in (None, ""):
            continue
        share = 100 * float(wage) / float(gva)
        if st == "All India":
            india = share
        elif st in MAJOR:
            pts.append((st, float(gva) / 1e5, share))
    if len(pts) != 22:
        raise SystemExit(f"expected 22 major states, found {len(pts)}")
    lx = [math.log(p[1] * 1e5) for p in pts]
    sl, ic, r = ols(lx, [p[2] for p in pts])
    check("22-state correlation", r, -0.72, 0.006)

    W, H, L, R, T, B = 640, 400, 58, 22, 18, 54
    lo, hi = math.log(8.5), math.log(32)
    X = lambda v: L + (math.log(v) - lo) / (hi - lo) * (W - L - R)
    Y = lambda v: T + (25 - v) / 25 * (H - T - B)
    b = []
    for v in (0, 5, 10, 15, 20, 25):
        b += [line(L, Y(v), W - R, Y(v), "#e8eef1"), text(L - 10, Y(v) + 5, f"{v}%", 14, anchor="end")]
    for v in (10, 15, 20, 30):
        b.append(text(X(v), H - B + 24, f"₹{v} lakh", 14, anchor="middle"))
    b.append(line(L, H - B, W - R, H - B, MUTED))
    b.append(text((L + W - R) / 2, H - 6, "Output (GVA) per worker, log scale", 14, SOFT, "middle"))
    b.append(line(L, Y(india), W - R, Y(india), MUTED, 1, "2 4"))
    b.append(text(W - R, Y(india) - 7, f"All-India {india:.1f}%", 13, MUTED, "end"))
    x0, x1 = min(p[1] for p in pts), max(p[1] for p in pts)
    f = lambda v: sl * math.log(v * 1e5) + ic
    b.append(line(X(x0), Y(f(x0)), X(x1), Y(f(x1)), INK, 2))
    for st, x, y in pts:
        if st in EXTRACTIVE:
            b.append(f'<rect x="{X(x) - 6:.1f}" y="{Y(y) - 6:.1f}" width="12" height="12" fill="{COPPER}" stroke="#fff"/>')
        else:
            b.append(f'<circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="6.5" fill="{BLUE}" stroke="#fff"/>')
    b.append(f'<circle cx="{W - 208}" cy="28" r="6.5" fill="{BLUE}"/>' + text(W - 196, 33, "Diversified", 14, SOFT))
    b.append(f'<rect x="{W - 112}" y="22" width="12" height="12" fill="{COPPER}"/>' + text(W - 94, 33, "Extractive", 14, SOFT))
    save("wage-share-states.svg", svg(W, H, "".join(b),
         "Scatter of 22 Indian states: wage share of value added falls as output per worker rises"))


# ---- small card figures, all on a 480 x 300 canvas
def atlas():
    d = json.load(open(os.path.join(ROOT, "industry-productivity-pay-atlas", "data", "atlas_klems.json"), encoding="utf-8"))
    ind = [i for i in d["industries"] if i["is_mfg"]]
    years = d["years"]
    share = []
    for j in range(len(years)):
        w = [i["va_nom"][j] for i in ind]
        share.append(100 * sum(a * i["lsh_va"][j] for a, i in zip(w, ind)) / sum(w))
    check("Atlas share 2011-12", share[years.index("2011-12")], 29.30, 0.06)
    check("Atlas share 2022-23", share[years.index("2022-23")], 32.55, 0.06)
    W, H, L, R, T, B = 480, 300, 48, 24, 18, 40
    lo, hi = 20, 50
    X = lambda j: L + j / (len(years) - 1) * (W - L - R)
    Y = lambda v: T + (hi - v) / (hi - lo) * (H - T - B)
    b = []
    for v in (20, 30, 40, 50):
        b += [line(L, Y(v), W - R, Y(v), "#e8eef1"), text(L - 8, Y(v) + 6, f"{v}%", 17, anchor="end")]
    for lab in ("1980-81", "2000-01", "2022-23"):
        b.append(text(X(years.index(lab)), H - 10, lab[:4], 17, anchor="middle"))
    pts = " ".join(f"{X(j):.1f},{Y(v):.1f}" for j, v in enumerate(share))
    b.append(f'<polyline points="{pts}" fill="none" stroke="{BLUE}" stroke-width="3.5" stroke-linejoin="round"/>')
    save("atlas.svg", svg(W, H, "".join(b), "Labour-income share of Indian manufacturing value added, 1980-81 to 2022-23"))


def green():
    with gzip.open(os.path.join(ROOT, "green-supplier-finance-lab", "data", "cases", "DEU_C29.json.gz")) as f:
        L_ = json.load(f)["links"]
    with gzip.open(os.path.join(ROOT, "green-supplier-finance-lab", "data", "multipliers_2022.json.gz")) as f:
        mult = json.load(f)["sectors"]
    direct = alltier = 0.0
    for c, i, z, g in zip(L_["country"], L_["industry"], L_["input_usd_m"], L_["alloc_ghg_t"]):
        s = mult.get(f"{c}_{i}")
        if s:
            direct += g
            alltier += s[1] * z
    vis = 100 * direct / alltier
    check("Green visibility DEU_C29", vis, 12.4, 0.06)
    W, H, L, R = 480, 300, 28, 28
    full = W - L - R
    vw = full * vis / 100
    b = [text(L, 66, f"{direct / 1e6:.1f} Mt", 34, BLUE, weight=600), text(L, 94, "visible at the first tier", 17),
         text(W - R, 66, f"{(alltier - direct) / 1e6:.1f} Mt", 34, COPPER, "end", 600), text(W - R, 94, "hidden deeper upstream", 17, anchor="end"),
         f'<rect x="{L}" y="122" width="{vw:.1f}" height="66" fill="{BLUE}"/>',
         f'<rect x="{L + vw:.1f}" y="122" width="{full - vw:.1f}" height="66" fill="{COPPER}" opacity=".82"/>',
         text(L, 226, f"{vis:.0f}% of embodied emissions are visible", 18, SOFT),
         text(L, 254, "Germany, motor vehicles, 2022", 17)]
    save("green.svg", svg(W, H, "".join(b), f"Germany motor vehicles: {vis:.0f} percent of embodied emissions visible at the first tier"))


def monitor(perf):
    p = json.load(open(perf, encoding="utf-8"))
    tiers = p["tier_event_rates"]
    base = p["base_rate"] * 100
    names = ["Low", "Watch", "Elevated", "High"]
    cols = ["#2f8f6b", "#e3b23c", "#d98032", "#b4452f"]
    vals = [tiers[n]["event_rate"] * 100 for n in names]
    check("Monitor High tier", vals[-1], 27.7, 0.06)
    W, H, T, B = 480, 300, 26, 42
    top = 32
    Y = lambda v: T + (top - v) / top * (H - T - B)
    bw, gap, x0 = 78, 26, 34
    b = [line(20, H - B, W - 20, H - B, MUTED)]
    for k, (n, c, v) in enumerate(zip(names, cols, vals)):
        x = x0 + k * (bw + gap)
        b.append(f'<rect x="{x}" y="{Y(v):.1f}" width="{bw}" height="{H - B - Y(v):.1f}" fill="{c}"/>')
        b.append(text(x + bw / 2, Y(v) - 8, f"{v:.0f}", 21, INK, "middle", 600))
        b.append(text(x + bw / 2, H - 14, n, 17, SOFT, "middle"))
    b.append(line(20, Y(base), W - 20, Y(base), INK, 1.5, "5 5"))
    b.append(text(24, Y(base) - 8, f"average {base:.0f}", 16, SOFT))
    save("monitor.svg", svg(W, H, "".join(b), "Severe contractions per 100 observations, by calibrated risk tier"))


def maize():
    d = json.load(open(os.path.join(ROOT, "maize-compensation-lab", "data.json"), encoding="utf-8"))
    r = d["central_rules"]
    rows = [("No compensation", r["R0_none"]["P1"], COPPER), ("Equal per person", r["R1_universal"]["P1"], BLUE),
            ("Geographic", r["R2_geographic"]["P1"], BLUE), ("Maize exposure", r["R4_exposure"]["P1"], BLUE),
            ("Poverty proxy", r["R3_pmt"]["P1"], BLUE)]
    pre = d["shock"]["P1 pre"]
    check("Maize baseline gap", r["R0_none"]["P1"], d["shock"]["P1 post"], 0.002)
    W, H, L, R, T = 480, 300, 172, 34, 20
    lo, hi = 15.6, 16.8
    X = lambda v: L + (v - lo) / (hi - lo) * (W - L - R)
    b = [line(X(pre), T, X(pre), 240, MUTED, 1.5, "5 5")]
    for k, (n, v, c) in enumerate(rows):
        y = T + 22 + k * 44
        b.append(text(L - 16, y + 6, n, 17, SOFT, "end"))
        b.append(line(L, y, W - R, y, "#e8eef1"))
        b.append(f'<circle cx="{X(v):.1f}" cy="{y}" r="9" fill="{c}"/>')
    b.append(text(X(pre) + 6, 274, f"before the price rise: {pre:.1f}", 16, SOFT, "start"))
    save("maize.svg", svg(W, H, "".join(b), "Poverty gap in Malawi after a maize price rise under each compensation rule"))


def nfhs():
    d = json.load(open(os.path.join(ROOT, "nfhs-lab", "data.json"), encoding="utf-8"))
    pts = [x["v"]["fuel"] for x in d["districts"] if x["v"].get("fuel") and None not in x["v"]["fuel"][:2]]
    if len(pts) != d["matched_counts"]["fuel"]:
        raise SystemExit(f"NFHS matched count differs: {len(pts)}")
    print(f"  check NFHS matched districts: {len(pts)}")
    W, H, L, R, T, B = 480, 300, 48, 26, 16, 40
    X = lambda v: L + v / 100 * (W - L - R)
    Y = lambda v: T + (100 - v) / 100 * (H - T - B)
    b = []
    for v in (0, 50, 100):
        b += [line(L, Y(v), W - R, Y(v), "#e8eef1"), text(L - 8, Y(v) + 6, f"{v}%", 17, anchor="end"),
              text(X(v), H - 10, f"{v}%", 17, anchor="middle")]
    b.append(line(X(0), Y(0), X(100), Y(100), MUTED, 1.5, "5 5"))
    b += [f'<circle cx="{X(a):.1f}" cy="{Y(c):.1f}" r="3.2" fill="{BLUE}" opacity=".55"/>' for a, c in pts]
    save("nfhs.svg", svg(W, H, "".join(b), "Clean cooking fuel use by district, NFHS-4 against NFHS-5"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--wage-xlsx", required=True)
    ap.add_argument("--tiers", required=True)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    wage_share_states(a.wage_xlsx)
    atlas(); green(); monitor(a.tiers); maize(); nfhs()
