# Claude Code add-ons for the ERP repo (Nov 1, 2026)

## Decision
Rudy works across several computers (iMac, MacBook Air), so add-ons must follow the
repo or his Claude account, not live on one machine.

## Enabled in .claude/settings.json (loads on any computer or cloud session that opens this repo)
- claude-code-setup@claude-plugins-official: Anthropic's read-only analyzer that recommends hooks, MCPs, skills and subagents for this project.

## On his Claude account instead
- Task Observer: uploaded as an account skill, so it follows him everywhere without adding third-party code to this repo.

## Not installed, and why
- claude-mem: local database on one machine; Claude account memory already syncs everywhere.
- Headroom: local background proxy on one machine.
- OmniRoute: dropped; free-tier providers may train on prompts, and a cloud deploy adds cost.

## Standing rule
Keep a .md knowledge record in docs/claude-notes/ for work done in this repo so knowledge builds up over time.
