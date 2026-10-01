---
description: "Ask the human operator a blocking question in the terminal when a decision is genuinely theirs to make: scope, approach, a metered or outward-facing action."
---

# Human in the loop

`ask_user({question, header?, options?, multiSelect?})` blocks until the operator answers in the terminal. Give 2 to 4 mutually exclusive options when the choices are known; the operator can always type a free-form answer.

Use it for a decision that is the operator's to make: anything metered (the X API behind `/fetch`, about $0.005 per post), anything outward-facing, or a choice between readings of the request. Do not use it for facts you can derive from the repository or the data. In a run with no terminal attached it returns an error telling you to proceed on your best judgment and record the assumption in your output.
