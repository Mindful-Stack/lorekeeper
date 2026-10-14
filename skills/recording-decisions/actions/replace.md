# replace

Read `<plugin-root>/skills/recording-decisions/reference/lifecycle.md` first.

Only an `accepted` record (or a legacy `deprecated` one) can be replaced. A `superseded` one points
at its successor: offer to replace that.

A record that no longer applies, with nothing new in its place, is replaced the same way: the
successor is short and its Decision states what is true now (for example, "the API keeps no
sessions"). A `proposed` one takes **amend** instead. A `rejected` option
comes back as a new record with `related: [<id>]` whose Context says why.

1. Run `record.md` with the new decision: the draft carries `supersedes: [<old id>]`, its Context
   opens with what changed, and it classifies itself (so it may land in another home).
2. The old record is not touched now: it binds until the successor is accepted. The successor gets
   its own PR, never a ride-along.
3. On **ratify** of the successor: in the same home, the predecessor flips in the same PR. In
   another home, dispatch the updater twice: accept the successor where it lies (its PR), then
   open the predecessor's flip PR in its home. Give the user both URLs with "merge the successor
   first" (or use the `stack` skill to show the order). Nothing checks the link across homes
   mechanically: the reviewers do, and `/lore:doctor` reports the pair until both merge.

A record in the wrong home is replaced by one in the right home whose Context says "refiled;
decision unchanged", or is left where it is.
