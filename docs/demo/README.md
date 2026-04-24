# Demo Readiness Docs

This folder contains the demo-specific data specification, scenario wiring guide, templates, and current scenario packet.

## Start here

1. `DATA_SPEC.md` — exact data requirements and parser-compatible Markdown format.
2. `SCENARIO_WIRING.md` — where the data wires into the UI and isolated eval flow.
3. `data/` — current self-serve onboarding launch demo packet.
4. `templates/` — copyable templates for future demo scenarios.

## Verification command

After updating the wired seed corpus, run:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

A demo packet is ready when this command exits `0` with `summary.failed_checks` equal to `0`.
