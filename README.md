# World Capitals Quiz

Name the capital city of every country in the world, on a map. Each blue dot is a
capital you haven't named yet; type one and it turns green, with its country shaded.

**Play:** https://roiblumberg.github.io/world-capitals-quiz/

## How to play

- Press **Start** and type capitals into the box. You don't need to press Enter:
  a correct answer is picked up as soon as you finish typing it.
- Accents, capitals and punctuation don't matter (`bogota`, `St Johns`, `port of spain` all count),
  and common alternatives are accepted (Kiev/Kyiv, Ulan Bator, Cape Town for South Africa, La Paz for Bolivia...).
- The chips above the map show how many you have per continent; tap one to zoom there.
- Zoom with the mouse wheel, pinch or double-tap, and drag to pan.
- **Aa** hides the answer labels; the **dot** button hides the blue dots for a harder game.
- When time runs out (or you give up), the ones you missed are shown in red on the map and in the list below it.

197 countries: the 193 UN members plus Kosovo, Palestine, Taiwan and Vatican City.

On a phone, use "Add to Home Screen" to play it full-screen like an app.

## Run locally

It's a static site with no build step:

```bash
python -m http.server 8000
```

then open http://localhost:8000.

## Files

| Path | What |
| --- | --- |
| `index.html`, `css/style.css`, `js/app.js` | The game |
| `js/capitals.js` | Countries, capitals, accepted alternatives and coordinates |
| `js/world-map.js` | Pre-projected country outlines (generated) |
| `tools/build_map.py` | Generates `js/world-map.js` from Natural Earth TopoJSON |
| `tools/make_icons.py` | Renders the app icons (needs Pillow) |

To regenerate the map, download `countries-50m.json` from the
[world-atlas](https://github.com/topojson/world-atlas) package and run
`python tools/build_map.py countries-50m.json js/world-map.js`.

## Credits

Map data: [Natural Earth](https://www.naturalearthdata.com/) (public domain), via
[world-atlas](https://github.com/topojson/world-atlas).
