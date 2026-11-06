"""Build js/world-map.js from a Natural Earth TopoJSON file (world-atlas).

Usage:
    python tools/build_map.py path/to/countries-50m.json js/world-map.js

The map uses a Miller cylindrical projection centred on 10°E, so the Pacific
island nations (Samoa, Tonga, Fiji, Tuvalu...) sit together on the right edge.
The same projection is implemented in js/app.js (projectLonLat) for the
capital dots, so keep the constants below in sync with WORLD_MAP's metadata.
"""
import json
import math
import sys

WIDTH = 2000.0
LON0 = 10.0       # central meridian
LAT_MAX = 84.0
LAT_MIN = -57.0
TOLERANCE = 0.12  # Douglas-Peucker tolerance, in map units

# Features without an ISO code in Natural Earth
NAME_IDS = {"Kosovo": "XK", "Somaliland": "706"}
DROP = {"Antarctica"}

K = WIDTH / (2 * math.pi)


def miller_y(lat):
    phi = math.radians(lat)
    return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * phi))


Y_TOP = miller_y(LAT_MAX)
Y_BOTTOM = miller_y(LAT_MIN)
HEIGHT = (Y_TOP - Y_BOTTOM) * K


def project(lon, lat):
    """lon is relative to LON0 (may poke slightly past ±180 at the map edges)."""
    lat = max(min(lat, 89.0), -89.0)
    x = (lon + 180.0) / 360.0 * WIDTH
    y = (Y_TOP - miller_y(lat)) * K
    return x, y


def decode_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def unwrap(points):
    """Make longitudes continuous (no ±360° jumps across the antimeridian)."""
    out = [points[0]]
    for lon, lat in points[1:]:
        prev = out[-1][0]
        while lon - prev > 180:
            lon -= 360
        while lon - prev < -180:
            lon += 360
        out.append((lon, lat))
    return out


_ARC_CACHE = {}


def simplified_arc(arcs, i):
    """Arc i, longitudes unwrapped, simplified in (unshifted) projected space.

    Simplifying per arc keeps shared borders identical on both sides. A shift of
    the whole arc by 360° only translates x, so the kept points don't change.
    """
    if i not in _ARC_CACHE:
        pts = unwrap(arcs[i])
        proj = [(lon / 360.0 * WIDTH, (Y_TOP - miller_y(max(min(lat, 89.0), -89.0))) * K) for lon, lat in pts]
        _ARC_CACHE[i] = [pts[j] for j in dp_indices(proj, TOLERANCE)]
    return _ARC_CACHE[i]


def ring_lonlat(ring, arcs):
    """Assemble a ring from simplified arcs, keeping longitudes continuous."""
    pts = []
    for idx in ring:
        seg = simplified_arc(arcs, ~idx if idx < 0 else idx)
        if idx < 0:
            seg = seg[::-1]
        if pts:
            shift = round((pts[-1][0] - seg[0][0]) / 360.0) * 360.0
            pts.extend((lon + shift, lat) for lon, lat in seg[1:])
        else:
            pts.extend(seg)
    return pts


def dp_indices(points, tol):
    """Douglas-Peucker on a list of (x, y); returns the indices to keep."""
    if len(points) < 3:
        return list(range(len(points)))
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, best_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, best_i = d, i
        if best > tol:
            keep[best_i] = True
            stack.append((a, best_i))
            stack.append((best_i, b))
    return [i for i, k in enumerate(keep) if k]


def wrap_offset(mean_lon):
    """Multiple of 360 that brings a (LON0-relative) mean longitude into [-180, 180)."""
    return -360.0 * math.floor((mean_lon + 180.0) / 360.0)


def fmt(v):
    s = f"{v:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    if s == "-0":
        s = "0"
    return s


def path_for(rings):
    parts = []
    for ring in rings:
        pts = [(round(x, 1), round(y, 1)) for x, y in ring]
        dedup = [pts[0]]
        for p in pts[1:]:
            if p != dedup[-1]:
                dedup.append(p)
        if len(dedup) > 1 and dedup[-1] == dedup[0]:
            dedup.pop()
        if len(dedup) < 3:
            continue
        x0, y0 = dedup[0]
        seg = [f"M{fmt(x0)} {fmt(y0)}l"]
        nums = []
        px, py = x0, y0
        for x, y in dedup[1:]:
            nums.append(f"{fmt(x - px)} {fmt(y - py)}")
            px, py = x, y
        seg.append(" ".join(nums).replace(" -", "-"))
        seg.append("z")
        parts.append("".join(seg))
    return "".join(parts)


def main(src, dst):
    with open(src, encoding="utf-8") as fh:
        topo = json.load(fh)
    arcs = decode_arcs(topo)
    countries = []
    for geom in topo["objects"]["countries"]["geometries"]:
        name = geom["properties"].get("name")
        if name in DROP or geom["type"] not in ("Polygon", "MultiPolygon"):
            continue
        cid = geom.get("id") or NAME_IDS.get(name)
        polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
        rings_out = []
        for poly in polys:
            # Re-centre on LON0 and keep each polygon in one piece: a polygon that
            # crosses the new edge of the map pokes slightly out of it instead of
            # being smeared across the whole width.
            rings = [ring_lonlat(r, arcs) for r in poly]
            outer_mean = sum(lon - LON0 for lon, _ in rings[0]) / len(rings[0])
            offset = wrap_offset(outer_mean)
            for k, ring in enumerate(rings):
                ring_off = offset
                if k > 0:  # align holes with their outer ring
                    mean = sum(lon - LON0 for lon, _ in ring) / len(ring)
                    ring_off = offset + 360.0 * round((outer_mean - mean) / 360.0)
                if len(ring) >= 4:
                    rings_out.append([project(lon - LON0 + ring_off, lat) for lon, lat in ring])
        d = path_for(rings_out)
        if d:
            countries.append({"id": cid, "n": name, "d": d})

    data = {
        "width": WIDTH,
        "height": round(HEIGHT, 2),
        "lon0": LON0,
        "latMax": LAT_MAX,
        "latMin": LAT_MIN,
        "countries": countries,
    }
    with open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("// Generated by tools/build_map.py from Natural Earth data (public domain).\n")
        fh.write("window.WORLD_MAP = ")
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print(f"{len(countries)} shapes, height {HEIGHT:.1f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
