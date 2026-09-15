Source artwork for the WhiSPa brand.

`whispa_wallet.png` (1254×1254) is the master icon. It lives here rather than in
`public/` because everything in `public/` is copied verbatim into `dist/` and
deployed — the master is 1.5 MB and the app never requests it.

The three icons the web app actually uses are derived from it:

  public/icon.png             512×512  RGBA, transparent rounded corners
  public/favicon.png           64×64   RGBA, transparent rounded corners
  public/apple-touch-icon.png 180×180  RGB, full-bleed on the icon's own black
                                       (iOS masks it itself and renders any
                                       transparency as white)

To regenerate after changing the master, see the commit that added this file —
the corners are cut by flood-filling the near-white that is CONNECTED TO A
CORNER, not by a radius, so the white inside the wordmark and the hood survives.
