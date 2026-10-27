# Opus 5.5 rollout — activation required before deployment

## Scope and current state

This change upgrades Strategy's model defaults and pricing support. It does **not** enable assistants, increase budgets, change the data boundary, or migrate the database.

- Customer-data roles stay on US Bedrock: `us.anthropic.claude-opus-5-5`.
- Public web research stays on direct Anthropic: `claude-opus-5-5`.
- Existing explicit environment selections still win. In particular, a deployment pinned to an older `BEDROCK_MODEL_ID` will not switch merely by installing this code.
- The runtime's approved budgets and manual-only scheduler state must remain unchanged.
- The model-only rollout was activated and verified at `ba9660d`. The AWS agreement is available, and both provider paths and cache reads were verified. Integrated releases must preserve those settings and repeat the applicable release gates below.

## AWS activation

Use an administrator identity in the AWS account hosting Strategy:

1. Open [Amazon Bedrock in us-west-2](https://us-west-2.console.aws.amazon.com/bedrock/home?region=us-west-2).
2. Select **Model catalog → Claude Opus 5.5**. Review the provider terms and complete any required Anthropic first-use form.
3. Open the playground and make a small synthetic request. In commercial regions, first use initiates subscription; the old Model access request page is not the normal path.
4. Confirm the agreement is available before deploying. A temporarily successful call is not sufficient: AWS documents that calls can initially succeed while subscription is being attempted, then fail if Marketplace permissions are missing.

The deployment operator currently lacks `bedrock:CreateFoundationModelAgreement`. The application runtime should not be granted broad permanent Marketplace management permissions just to resolve that operator prerequisite. An administrator can enable the model once; ordinary runtime invocation then needs only the selected model/profile permissions.

The US inference profile needs `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the specific profile and its returned regional foundation-model ARNs. Preserve the old model permissions while a rollback remains possible. Do not switch to global routing or direct Anthropic for customer-data roles to bypass this gate.

Reference: [AWS model access and auto-enablement](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).

## Pricing and deployment wiring

Published standard USD rates per million tokens:

| Path | Input | Output | Cache read | Five-minute cache write |
| --- | ---: | ---: | ---: | ---: |
| Direct Anthropic Opus 5.5 | 4.00 | 20.00 | 0.20 | 5.00 |
| US regional Bedrock Opus 5.5 | 4.40 | 22.00 | 0.22 | 5.50 |

The direct rates come from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). The regional rates were verified against the AWS `ListFoundationModelAgreementOffers` rate card's USW2 standard dimensions. The code conservatively labels its Bedrock fallback as estimated until explicit deployed rates are supplied; negotiated or future prices can differ.

On deployment, explicitly select both model IDs and verify the actual container environment, not just the environment file. Compose forwards `DIRECT_MODEL_ID` and both sets of Opus 5.5 price overrides. Legacy override variables remain forwarded for rollback and older explicit model selections.

Do not reuse the old model's price variable names for the new model. The new prefixes are:

- `AI_PRICE_US_ANTHROPIC_CLAUDE_OPUS_5_5_`
- `AI_PRICE_CLAUDE_OPUS_5_5_`

Each accepts `INPUT`, `OUTPUT`, `CACHE_READ`, and `CACHE_WRITE`. Omitted cache overrides retain baseline model-specific cache rates; they are not recalculated from an overridden input price.

## Prompt caching

Caching is already requested in both `runStructured.ts` and `runWebResearch.ts` through an ephemeral cache breakpoint on the system prompt. Usage aggregation and costing account for cache creation and cache reads separately. This patch retains that request behavior and corrects Opus 5.5's cache-read price to 5% of base input, not older models' 10%.

The default TTL is five minutes. A cache marker is not proof of a cache hit: prefixes must meet the provider/model token minimum, match, and remain unexpired. Check `cache_creation_input_tokens` on the first request and `cache_read_input_tokens` on a repeated request. Use synthetic inputs for release probes; do not publish customer prompts or results.

Reference: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## Release gate

- Exact-head typecheck, privacy scan, unit tests, CI and review.
- AWS agreement available; regional profile access verified repeatedly.
- Real synthetic native structured-output calls on both paths, including adaptive thinking and the existing JSON-schema format.
- Repeated synthetic prompts demonstrate cache writes followed by cache reads on both paths.
- Fresh backup/rollback; new exact image deployed without pulling unrelated commits.
- Both live provider checks return served model `claude-opus-5-5` with known pricing.
- Customer records preserved; scheduler remains disabled; existing daily/monthly/manual-share settings unchanged.

Do not describe the upgrade as live until all applicable gates pass. PR evidence records partial results and the activation blocker separately from implementation readiness.
