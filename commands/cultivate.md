---
description: Cultivate a bounded-context domain. With a name argument, work on that specific domain. Without an argument, discover candidate bounded contexts in the codebase and audit existing ones.
---

# Cultivate Command

If the user provided a domain name argument, invoke the `lore:cultivating-domains` skill with the Skill
tool and follow it exactly as presented, passing the domain name through. (In runtimes without a
Skill tool, read `skills/cultivating-domains/SKILL.md` and follow it, with the domain name as input.)

If no argument was provided, invoke the `lore:cultivate-discovery` skill with the Skill tool and
follow it exactly as presented. (In runtimes without a Skill tool, read
`skills/cultivate-discovery/SKILL.md` and follow it.)
