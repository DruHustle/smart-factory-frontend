# Factory models and loading qualification

The actual local application components are shown in the [desktop gallery](gallery-desktop.webp) and [mobile dark gallery](gallery-mobile-dark.webp). The isolated fixture uses the checked-in models and local catalogue responses; these are not production screenshots.

The [qualification record](qualification.json) contains all 28 model/theme/viewport combinations and their phase timings. Explosion, immediate keyboard scrubbing, ghosting, exact restoration and sections passed for every combination. Two gallery scenarios check model switching, component selection and one active canvas. Two failure/loading scenarios check a held GLB preview and unavailable-lighting fallback.

Equipment and runtime checks: 141 passed, eight database cases skipped because disposable PostgreSQL was unavailable. Type checking and the production build passed. Separate HTTP checks cover anonymous denial, forced-password restrictions, known reference delivery and rejection of private imports/unknown revisions.

The first image is an accurate labelled reference preview. Interactive-ready waits for a model draw, nonblocking GPU completion and a presentation frame before replacing it. No private model bytes are cached in the new lighting cache. Hardware GPU and hosted release acceptance remain separate from this software-renderer qualification.
