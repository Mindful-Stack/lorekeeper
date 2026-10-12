# replace

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/lifecycle.md` first.

Only an `accepted` or `deprecated` record can be replaced. A `superseded` one points at its
successor: offer to replace that. A `proposed` one takes **amend** instead. A `rejected` option
comes back as a new record with `related: [<id>]` whose Context says why.

1. Run **record** (`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/record.md`) with the new
   decision: the draft carries `supersedes: [<old id>]`, its Context
   opens with what changed, and it classifies itself (so it may land in another home). The
   architect will name the old record: that is expected.
2. The old record is not touched now: it binds until the successor is accepted. The successor gets
   its own PR, never a ride-along.
3. On **ratify** of the successor: in the same home, the predecessor flips in the same PR. In
   another home, open both PRs at once — the accepted successor in its home and the predecessor's
   flip in its own — and tell the user to merge the successor first (use the `stack` skill to show
   the order or, where no stack skill is available, list the two PR URLs with "merge the
   successor first"). Nothing checks the link across homes mechanically: the reviewers do.

A record in the wrong home is replaced by one in the right home whose Context says "refiled;
decision unchanged", or is left where it is.
