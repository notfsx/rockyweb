# Light vs Full: measured on 2026-11-15

Five tabs opened one after another, each in the foreground for 4 s and left open (article with newsletter overlay, ordinary page, checkout overlay, cookie banner, busy DOM page), median of 3 runs, headless Chromium, 4 CPUs. The model is a deterministic double, so model latency and memory are not included.

| Configuration | Script injections | CSS injections | Third-party request events handled | Learning checks | Header observation | Model calls | CPU s, all Chrome | CPU s, extension process | RSS MB, all Chrome | Busy page main-thread ms | Article overlay hidden | Checkout overlay hidden |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Light | 5 | 5 | 0 | 0 | no | 0 | 1.73 | 0.03 | 1655 | 168 | no | no |
| Full, AI off | 100 | 5 | 70 | 20 | yes | 0 | 2.17 | 0.16 | 1681 | 195 | no | no |
| Full, auto-optimisation (model double) | 100 | 5 | 70 | 20 | yes | 1 | 2.15 | 0.17 | 1686 | 195 | yes | no |
