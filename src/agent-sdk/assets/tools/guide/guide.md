---
description: "Guide tools: load a tool family's full guide (guardrails, contract, examples) before using its gated tools, or load a progressively disclosed skill's full workflow on demand."
---

# Guide tools

- `load_guide({area})` returns one tool family's full guide and opens that family's gate. A granted family always shows its name and one-line description in your prompt; load the guide before the first call to any of its tools.
- `load_skill({name})` returns the full body of a skill your profile discloses progressively. Load it when you start that skill's work, not before.
