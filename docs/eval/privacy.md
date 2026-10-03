# Provider privacy probe

Run 2026-10-03T21:35:33.585Z by `npm run eval:privacy` (src/__eval__/privacy/providers.test.ts). Every request carried
`provider: {"data_collection":"deny","zdr":true}` (PROVIDER_PRIVACY in src/lib/server/openrouter.ts), so OpenRouter could only
route it to an endpoint that does not train on prompts and keeps no data (Zero Data Retention).
Each cell: the result, the provider OpenRouter reports serving it, and the time.

| Model | Text (JSON mode) | Picture | Stream |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | ok (Amazon Bedrock, 1082 ms) | ok (Amazon Bedrock, 906 ms) | ok (876 ms) |
| `anthropic/claude-sonnet-5.5` | ok (Google, 753 ms) | not used | not used |
| `deepseek/deepseek-v4.1-flash` | ok (DeepInfra, 409 ms) | ok (DeepInfra, 1095 ms) | ok (312 ms) |
| `google/gemini-3.1-flash-lite` | ok (Google, 1247 ms) | ok (Google, 1362 ms) | not used |
| `google/gemini-3.5-flash` | ok (Google, 893 ms) | ok (Google, 1218 ms) | ok (717 ms) |
| `google/gemini-3.5-flash-lite` | ok (Google, 562 ms) | ok (Google, 823 ms) | not used |
| `google/gemini-3.8-flash` | ok (Google, 1254 ms) | not used | not used |
| `openai/gpt-5.4-mini` | ok (Azure, 1575 ms) | ok (Azure, 2430 ms) | ok (768 ms) |

Control: `qwen/qwen3.7-flash` has no ZDR endpoint. Refused as expected: 404 No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy
