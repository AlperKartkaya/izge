# Hero gate blocker

The assembled first viewport is user-approved, but the Impeccable hero phase remains open.

## Evidence

- Review session: `f5e768a45d696b0d771ccba2911b204c27b80ceedcbff88cb9b2ea869e32886f`
- Accepted screenshot: `/Users/alperkartkaya/.impeccable/component-reviews/f5e768a45d696b0d771ccba2911b204c27b80ceedcbff88cb9b2ea869e32886f/blobs/0cfcc011a8b5978074853745eb9d9b89ac4b94172b97d47c5f65d49a90d74396`
- Fresh current capture: `.impeccable/review/hero-repro.png`
- Both captures are `1536x1024`; the current page loads Cambay and Inter.
- ImageMagick comparison: SSIM `0.999903`, RMSE `0.00250354`. The visible first viewport is effectively unchanged; differences are subpixel edge rasterization.
- The measured spec has zero plates. Current veto messages concern text, controls, and chrome, which `.agents/skills/impeccable/reference/component-review.md:61` says become advisory after acceptance while the approved viewport still renders.

Reproduce:

```sh
SESSION=f5e768a45d696b0d771ccba2911b204c27b80ceedcbff88cb9b2ea869e32886f
STORE="$HOME/.impeccable/component-reviews/$SESSION"
ACCEPTED="$STORE/blobs/0cfcc011a8b5978074853745eb9d9b89ac4b94172b97d47c5f65d49a90d74396"

.agents/skills/impeccable/scripts/impeccable component-review lifecycle \
  --session-dir "$STORE" --require hero --hosted
.agents/skills/impeccable/scripts/impeccable component-review verify \
  --manifest .impeccable/review/hero.json
.agents/skills/impeccable/scripts/impeccable build-phase status --json
sips -g pixelWidth -g pixelHeight "$ACCEPTED" .impeccable/review/hero-repro.png
magick compare -metric SSIM "$ACCEPTED" .impeccable/review/hero-repro.png null:
magick compare -metric RMSE "$ACCEPTED" .impeccable/review/hero-repro.png null:
```

The lifecycle command reports `status: accepted` and `reviewClosed: true`; manifest verification succeeds. Build status still reports `hero.status: open` with a score near `0.77` and applies numeric region vetoes.

## Diagnosis

This is an Impeccable gate integration issue, not demonstrated UI drift. The unresolved implementation detail is whether the gate fails to link the valid external CLI receipt or links it but requires exact screenshot/input hashes instead of a perceptual match. Post-approval below-fold additions changed `website/index.html` and `website/styles.css` hashes without materially changing the first viewport.

No `--force` was used. No receipt or build-state file was edited. Do not request the closed review again. The `hero` phase remains open and blocks formal build-phase completion until the tool can apply the accepted-review contract.
