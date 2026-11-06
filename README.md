# World Capitals Quiz

Name every country in the world together with its capital, on a map. Each blue dot is a
country/capital pair you haven't named yet; get one and it turns green, with its country shaded.

**Play:** https://roibl.github.io/world-capitals-quiz/

## How to play

- Press **Start**, type a country in the first box and its capital in the second.
  The pair counts only when both are right, and you don't need to press Enter.
- Once the country is recognised (a green ✓ appears) the cursor jumps to the capital box by itself.
  If the name could still be the start of a longer one (Niger → Nigeria), it waits for a short pause,
  or you can press Enter/Next. Backspace in an empty capital box goes back; Esc clears both.
- Accents, capitals and punctuation don't matter (`bogota`, `St Johns`, `port of spain` all count),
  and common alternatives are accepted: for countries USA, UK, Czech Republic, Burma, Swaziland, Ivory Coast...;
  for capitals Kiev/Kyiv, Ulan Bator, Cape Town for South Africa, La Paz for Bolivia...
  "Congo" works for both Congos; the capital decides which one you meant.
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
| `js/capitals.js` | Countries, capitals, accepted alternative names and coordinates |
| `js/world-map.js` | Pre-projected country outlines (generated) |
| `tools/build_map.py` | Generates `js/world-map.js` from Natural Earth TopoJSON |
| `tools/make_icons.py` | Renders the app icons (needs Pillow) |

To regenerate the map, download `countries-50m.json` from the
[world-atlas](https://github.com/topojson/world-atlas) package and run
`python tools/build_map.py countries-50m.json js/world-map.js`.

## Credits

Map data: [Natural Earth](https://www.naturalearthdata.com/) (public domain), via
[world-atlas](https://github.com/topojson/world-atlas).
