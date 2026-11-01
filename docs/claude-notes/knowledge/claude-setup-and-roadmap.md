# Claude Setup and Roadmap

## Principles
- Rudy works on multiple computers (iMac, MacBook Air). Only use add-ons that follow him across machines (repo-based or Claude account skills). claude-mem and Headroom were not installed for this reason.
- Prefer building tools into the beyondGREEN ERP over adding outside apps.
- Stop and ask if anything needs a login or payment.

## Connectors approved (Oct 2026)
- Amazon Selling Partner, QuickBooks, Stripe (reconnect), Docusign, Klaviyo, Canva.
- Creative/media: Higgsfield, Artlist (connected; use for image generation), Fathom, Gamma, HyperFrames by HeyGen, ElevenLabs.
- SEO/analytics: Google Analytics, Search Console, OpenSEO, GEO optimizer skill.
- Power-user MCPs: Exa or Perplexity, Sequential Thinking, Playwright.

## Skills to build
- Quote builder, Walmart program ops, sourcing brief (supplier evaluation), sales outreach (Apollo plus email in his voice), contract review, financial reporting.
- Custom skills for every repeat job: RFQ drafting first, then die lines, quotes, Walmart reports, supplier vetting.

## Claude Code add-ons
- In use: Claude Code Setup (via the ERP repo), Task Observer (Claude account skill).
- Plugins to add (claude-plugins-official): Context7, Supabase, Vercel, Playwright, security-guidance, code-review, feature-dev, commit-commands, claude-md-management, hookify, typescript-lsp; Sentry if added to the ERP.
- Repos/skills on the list: anthropics/skills, gsd-build/get-shit-done, plus a set of skill/plugin repos (humanizer, impeccable, ui-ux-pro-max, diagram-design, superpowers, marketingskills, financial-services, claude-for-legal, others). Skip all-in-one packs.
- Practices: strong CLAUDE.md per project, parallel sessions in git worktrees for ERP builds, hooks (block deploy on failed tests; no prod DB changes without asking), Claude Code in GitHub Actions for ERP code review, more scheduled tasks.

## ERP builds pending
1. RFQ reply tracker (all PLA and packaging RFQs, quotes compared side by side).
2. Outlook inbox sync (supplier replies attach to the right RFQ/vendor; needs Microsoft 365 admin app approval).
3. QuickBooks two-way sync for invoices and customers (QuickBooks stays the books of record).
4. Built-in e-sign for NDAs and quotes with signature and audit log (Docusign still for big contracts).

## Account setup to-dos
- Scheduled tasks: weekday morning briefing, weekly Walmart check, WildKind store health report, inbox triage, weekly brief on new Claude connectors and AI workflows.
- Projects per business; saved writing style profile; consider a Team plan for colleagues.
- Install Google Analytics where missing (check epsilonpacific.com and forevergreentech.com).
