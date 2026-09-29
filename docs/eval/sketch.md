# Illustrator eval: free drawing in lecture mode

`npm run eval:sketch` (RUN_SKETCH_EVAL=1): the corpus (`src/__eval__/sketch/corpus.ts`: the owner's four-panel comic of a futuristic police officer, labelled science diagrams, history, business school, geography, a cat — 19 drawings) through the PRODUCTION illustrator (`illustrate`: the prompt, the SVG parser and sampler, the one retry with the parser's complaint), one model at a time, no fallback. Every drawing is rendered as the board inks it (round-capped pen, the palette, pale fills) on a contact sheet per model, LOOKED at, and scored by eye 0–3 for recognisable / clean / on-prompt (total 0–9), and the comic's panels together 0–3 for consistency (`src/__eval__/sketch/scores.ts`).

Catalog prices of 2026-09-29. Spent on this eval so far: $3.49 of a $4.00 cap.

## The pick

**Primary `google/gemini-3.8-flash` (reasoning "low"), fallback `anthropic/claude-sonnet-5.5`**, both US providers (`LIVE_MODELS.sketch` / `sketchFallback`).

Gemini 3.8 Flash scored 8.37 / 9 by eye in round 3 (8.42 in round 2), a whisker below Sonnet 5.5 (8.68), and it is the only model that draws this well within the 10–15 s a panel should take: 7.1 s p50 and 12.6 s p95 over 19 drawings, not one unusable SVG in 57 drawings over three rounds, $0.0092 a drawing. Sonnet 5.5 draws the nicest pictures and the most consistent comic, but it always reasons (OpenRouter: "Reasoning is mandatory for this endpoint and cannot be disabled"): 20 s p50, 36 s p95, three times the cost. So it is the fallback, and gets the time the primary did not use (the primary's attempt is 20 s; the fallback has the rest of the 55 s budget).

Not picked: DeepSeek v4.1 Flash (7.58: three rounds out of three it spent all 8000 tokens reasoning about the heart and drew nothing; p95 31–43 s; not a US provider). GPT-5.4 mini and Claude Haiku 4.5 (4.5–5.1: stick figures and tangles; the knight and the cat are not recognisable). Gemini 3.8 Flash at "medium" (6.79: four times slower, three drawings cut off at the token limit). Gemini 3.5 Flash and GPT-5.4 were dropped after a 4-drawing pilot: 22.4 s and 19.0 s p50 (34.9 s and 28.7 s p95), $0.047 and $0.026 a drawing, and no better-looking than Gemini 3.8 Flash.

Price: keep 4 credits a panel (`live/sketch`). A credit is $0.004 on Plus and $0.00325 on Pro; the primary's $0.0092 a drawing is 2.3–2.8 credits, so 4 leaves room for a retry and the occasional Sonnet fallback ($0.029). A four-panel comic is 16 credits.

The prompt, over three rounds: round 2 (a teacher's drawing order, details that agree with the request, diagrams as textbook diagrams, bodies not stick figures, more fills, labels well inside) took Gemini 3.8 Flash from 8.11 to 8.42 — the night scene got its moon, the heart its chambers, the DNA a clean helix. Round 3 (each part outlined in its own colour and most shapes tinted, the look of the planners' gallery in docs/lecture/sketch.png, at the desk's real aspects: 0.81 for a panel of a four-panel strip, 1.57 for a picture) kept the score (8.37) in the brighter look.

Weak spots left: the human heart (every model draws it blocky or abstract); labels a model sets small (the planner decides the written size); the officer's visor comes and goes between panels.

## Round 3 (2026-09-29): the third prompt, at the desk's real aspects (0.81 comic panels, 1.57 pictures): each part outlined in its own colour and most main shapes filled (the look of the planners' gallery), composed for tall and wide frames; a reply cut off at the token limit is unusable

Reasoning: the illustrator's own (`sketchReasoning`: low; none for Anthropic's). Latency is every attempt of a drawing added up (the retry included); "slow" counts drawings with an attempt past the primary's per-attempt timeout (25 s in rounds 1–2, 20 s from round 3), where production would have gone to the fallback. "Unusable 1st" is a first SVG with nothing drawable in it (the retry was used).

| model | look (0–9) | recognisable | clean | on-prompt | comic consistency | drawn | unusable 1st | slow | p50 | p95 | $ / drawing | strokes | points | sheet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | **8.68** | 2.95 | 2.79 | 2.95 | 3 / 3 | 19/19 | 0 | 9 | 19.9 s | 35.9 s | $0.0288 | 30 | 236 | [png](sketch/3-anthropic-claude-sonnet-5.5.png) |
| `google/gemini-3.8-flash` | **8.37** | 2.95 | 2.42 | 3.00 | 2 / 3 | 19/19 | 0 | 0 | 7.1 s | 12.6 s | $0.0092 | 39 | 267 | [png](sketch/3-google-gemini-3.8-flash.png) |
| `deepseek/deepseek-v4.1-flash` | **7.58** | 2.63 | 2.37 | 2.58 | 2 / 3 | 18/19 | 2 | 5 | 11.1 s | 42.8 s | $0.0054 | 28 | 236 | [png](sketch/3-deepseek-deepseek-v4.1-flash.png) |

What the sheets show:

- `google/gemini-3.8-flash`: the planners' look: each part outlined in its own colour and tinted — a volcano cut open in layers, the knight on a chestnut horse, the rocket on its gantry, the storefront; the comic keeps the long blue coat and Pip, though the visor comes and goes; the heart is blocky but labelled; labels still small.
- `anthropic/claude-sonnet-5.5`: the nicest set: every character has the same helmet, visor, coat and boots, the cat and the knight are charming; the heart is still abstract; but a panel takes 20 s at the median and 36 s at p95.
- `deepseek/deepseek-v4.1-flash`: well-placed labels on the cell and tidy objects, but a sun in the night scene, no leap in panel 2, stacked ovals for DNA, and the heart ran out of tokens a third time; 43 s p95.

<details><summary>Scores per drawing (recognisable / clean / on-prompt)</summary>

| drawing | `claude-sonnet-5.5` | `gemini-3.8-flash` | `deepseek-v4.1-flash` |
|---|---|---|---|
| comic-police-1 | 3/3/3 | 3/2/3 | 3/2/2 |
| comic-police-2 | 3/3/3 | 3/2/3 | 2/2/2 |
| comic-police-3 | 3/3/3 | 3/3/3 | 3/2/3 |
| comic-police-4 | 3/3/3 | 3/2/3 | 3/2/3 |
| plant-cell | 3/2/3 | 3/2/3 | 3/3/3 |
| heart | 2/2/2 | 2/2/3 | 0/0/0 |
| circuit | 3/2/3 | 3/3/3 | 3/3/3 |
| volcano | 3/2/3 | 3/3/3 | 2/2/2 |
| castle | 3/3/3 | 3/3/3 | 3/3/3 |
| knight | 3/3/3 | 3/2/3 | 3/2/3 |
| rocket | 3/3/3 | 3/3/3 | 3/3/3 |
| handshake | 3/3/3 | 3/3/3 | 3/3/3 |
| storefront | 3/3/3 | 3/2/3 | 3/2/3 |
| cold-call | 3/3/3 | 3/3/3 | 3/3/3 |
| supply-chain | 3/3/3 | 3/3/3 | 3/3/3 |
| island | 3/3/3 | 3/2/3 | 3/2/3 |
| dna | 3/3/3 | 3/2/3 | 1/2/1 |
| solar-system | 3/3/3 | 3/2/3 | 3/3/3 |
| cat | 3/3/3 | 3/2/3 | 3/3/3 |

</details>

Drawn: 98% of all drawings in this round.

## Round 2m (2026-09-29): the second prompt, Gemini 3.8 Flash at medium reasoning

Reasoning: medium for every model. Latency is every attempt of a drawing added up (the retry included); "slow" counts drawings with an attempt past the primary's per-attempt timeout (25 s in rounds 1–2, 20 s from round 3), where production would have gone to the fallback. "Unusable 1st" is a first SVG with nothing drawable in it (the retry was used).

| model | look (0–9) | recognisable | clean | on-prompt | comic consistency | drawn | unusable 1st | slow | p50 | p95 | $ / drawing | strokes | points | sheet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `google/gemini-3.8-flash` | **6.79** | 2.42 | 2.00 | 2.37 | 3 / 3 | 19/19 | 0 | 11 | 28.0 s | 35.6 s | $0.0264 | 47 | 288 | [png](sketch/2m-google-gemini-3.8-flash.png) |

What the sheets show:

- `google/gemini-3.8-flash`: medium reasoning draws no better and is four times slower (28 s p50): three replies ran out of tokens thinking and were cut off (a castle of 12 strokes, a knight of 6, a sun and nothing else), and the plant cell lost its labels.

<details><summary>Scores per drawing (recognisable / clean / on-prompt)</summary>

| drawing | `gemini-3.8-flash` |
|---|---|
| comic-police-1 | 3/2/3 |
| comic-police-2 | 3/2/3 |
| comic-police-3 | 3/2/3 |
| comic-police-4 | 3/2/3 |
| plant-cell | 2/3/1 |
| heart | 3/2/3 |
| circuit | 3/3/3 |
| volcano | 3/2/3 |
| castle | 1/1/1 |
| knight | 0/1/0 |
| rocket | 3/3/3 |
| handshake | 3/2/3 |
| storefront | 2/2/2 |
| cold-call | 3/2/3 |
| supply-chain | 3/2/3 |
| island | 3/2/3 |
| dna | 3/2/3 |
| solar-system | 0/1/0 |
| cat | 2/2/2 |

</details>

Drawn: 100% of all drawings in this round.

## Round 2 (2026-09-29): the second prompt: drawn in a teacher's order, faithful details (a night has no sun), diagrams as textbook diagrams (a heart is not a valentine), bodies not stick figures, 2–6 main shapes filled, labels at 36 and well inside

Reasoning: the illustrator's own (`sketchReasoning`: low; none for Anthropic's). Latency is every attempt of a drawing added up (the retry included); "slow" counts drawings with an attempt past the primary's per-attempt timeout (25 s in rounds 1–2, 20 s from round 3), where production would have gone to the fallback. "Unusable 1st" is a first SVG with nothing drawable in it (the retry was used).

| model | look (0–9) | recognisable | clean | on-prompt | comic consistency | drawn | unusable 1st | slow | p50 | p95 | $ / drawing | strokes | points | sheet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | **8.47** | 2.89 | 2.79 | 2.79 | 3 / 3 | 19/19 | 0 | 5 | 10.3 s | 33.0 s | $0.0245 | 30 | 248 | [png](sketch/2-anthropic-claude-sonnet-5.5.png) |
| `google/gemini-3.8-flash` | **8.42** | 2.95 | 2.53 | 2.95 | 3 / 3 | 19/19 | 0 | 0 | 7.6 s | 9.9 s | $0.0094 | 41 | 283 | [png](sketch/2-google-gemini-3.8-flash.png) |
| `deepseek/deepseek-v4.1-flash` | **7.58** | 2.63 | 2.32 | 2.63 | 3 / 3 | 18/19 | 1 | 1 | 11.8 s | 31.3 s | $0.0047 | 30 | 230 | [png](sketch/2-deepseek-deepseek-v4.1-flash.png) |
| `openai/gpt-5.4-mini` | **4.53** | 1.42 | 1.47 | 1.63 | 1 / 3 | 19/19 | 0 | 0 | 8.3 s | 20.9 s | $0.0071 | 46 | 307 | [png](sketch/2-openai-gpt-5.4-mini.png) |

What the sheets show:

- `google/gemini-3.8-flash`: better on every weak spot of round 1: the night has a moon and stars, the heart has its chambers and vessels, the DNA is a clean helix; panel 4's glow is a big circle over the figures, and the labels are still small.
- `anthropic/claude-sonnet-5.5`: clean and charming, the comic the most consistent; the heart is still abstract, the volcano is not a cross-section, OPEN is drawn as letter shapes (it reads OFAN), a sun in the night scene; 10 s p50 but 33 s p95.
- `deepseek/deepseek-v4.1-flash`: plain and tidy; the heart again spent every token reasoning and drew nothing, the DNA is a stack of ovals, the leap still does not read; 31 s p95.
- `openai/gpt-5.4-mini`: no better with the second prompt: the knight, the cat and the heart are not recognisable, the comic is a tangle of small shapes.

<details><summary>Scores per drawing (recognisable / clean / on-prompt)</summary>

| drawing | `claude-sonnet-5.5` | `gemini-3.8-flash` | `deepseek-v4.1-flash` | `gpt-5.4-mini` |
|---|---|---|---|---|
| comic-police-1 | 3/3/2 | 3/3/3 | 3/2/3 | 1/1/2 |
| comic-police-2 | 3/3/3 | 3/2/3 | 2/2/2 | 1/1/1 |
| comic-police-3 | 3/3/3 | 3/3/3 | 3/3/3 | 1/1/2 |
| comic-police-4 | 3/3/3 | 2/2/3 | 3/2/3 | 1/1/1 |
| plant-cell | 3/2/3 | 3/2/3 | 3/2/3 | 2/2/3 |
| heart | 2/2/2 | 3/2/3 | 0/0/0 | 0/1/0 |
| circuit | 3/3/3 | 3/3/3 | 3/3/3 | 1/2/1 |
| volcano | 2/2/2 | 3/2/3 | 3/2/3 | 2/2/2 |
| castle | 3/3/3 | 3/3/3 | 3/3/3 | 2/1/2 |
| knight | 3/3/3 | 3/2/3 | 3/2/3 | 0/1/0 |
| rocket | 3/3/3 | 3/3/3 | 3/3/3 | 2/2/2 |
| handshake | 3/3/3 | 3/3/3 | 3/2/3 | 2/1/2 |
| storefront | 3/2/2 | 3/3/3 | 3/3/3 | 2/2/2 |
| cold-call | 3/3/3 | 3/3/3 | 3/3/3 | 1/1/1 |
| supply-chain | 3/3/3 | 3/3/3 | 3/2/3 | 1/2/2 |
| island | 3/3/3 | 3/2/3 | 2/2/2 | 2/2/2 |
| dna | 3/3/3 | 3/3/3 | 1/2/1 | 3/2/3 |
| solar-system | 3/3/3 | 3/2/3 | 3/3/3 | 3/2/3 |
| cat | 3/3/3 | 3/2/2 | 3/3/3 | 0/1/0 |

</details>

Drawn: 99% of all drawings in this round.

## Round 1 (2026-09-29): the first prompt (outlines, the palette by meaning, 20–60 elements, labels only when asked, the cast honoured, one example)

Reasoning: the illustrator's own (`sketchReasoning`: low; none for Anthropic's). Latency is every attempt of a drawing added up (the retry included); "slow" counts drawings with an attempt past the primary's per-attempt timeout (25 s in rounds 1–2, 20 s from round 3), where production would have gone to the fallback. "Unusable 1st" is a first SVG with nothing drawable in it (the retry was used).

| model | look (0–9) | recognisable | clean | on-prompt | comic consistency | drawn | unusable 1st | slow | p50 | p95 | $ / drawing | strokes | points | sheet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | **8.47** | 2.89 | 2.74 | 2.84 | 2 / 3 | 19/19 | 0 | 5 | 13.9 s | 35.3 s | $0.0258 | 30 | 237 | [png](sketch/1-anthropic-claude-sonnet-5.5.png) |
| `google/gemini-3.8-flash` | **8.11** | 2.89 | 2.32 | 2.89 | 3 / 3 | 19/19 | 0 | 0 | 7.6 s | 11.8 s | $0.0092 | 40 | 290 | [png](sketch/1-google-gemini-3.8-flash.png) |
| `deepseek/deepseek-v4.1-flash` | **7.37** | 2.53 | 2.26 | 2.58 | 3 / 3 | 18/19 | 1 | 1 | 12.3 s | 30.9 s | $0.0045 | 30 | 235 | [png](sketch/1-deepseek-deepseek-v4.1-flash.png) |
| `anthropic/claude-haiku-4.5` | **5.11** | 1.63 | 1.68 | 1.79 | 2 / 3 | 19/19 | 0 | 0 | 7.3 s | 18.4 s | $0.0073 | 29 | 198 | [png](sketch/1-anthropic-claude-haiku-4.5.png) |
| `openai/gpt-5.4-mini` | **4.68** | 1.58 | 1.42 | 1.68 | 1 / 3 | 19/19 | 0 | 0 | 8.1 s | 15.2 s | $0.0062 | 42 | 269 | [png](sketch/1-openai-gpt-5.4-mini.png) |

What the sheets show:

- `google/gemini-3.8-flash`: the most complete pictures: every comic panel reads (the visor, the blue coat and Pip in all four), a real double helix, a castle, a storefront and a rocket a teacher would be proud of; the heart is cluttered and a few labels sit on the left edge.
- `deepseek/deepseek-v4.1-flash`: clean and plain, the comic consistent; the DNA is a stack of ovals, the leap in panel 2 does not read, and the heart spent all 8000 tokens reasoning and drew nothing; a 31 s p95.
- `anthropic/claude-sonnet-5.5`: the cleanest lines and the nicest characters (the cat, the knight, the handshake), but the heart is abstract, the volcano is not a cross-section, labels are tiny, and panel 4's coat loses its blue; always reasons (it cannot be turned off), so 14 s p50 and 35 s p95.
- `openai/gpt-5.4-mini`: cluttered and small: the knight and the cat are not recognisable, the comic's panels 2 and 4 are a tangle.
- `anthropic/claude-haiku-4.5`: stick figures and thin pictures: filled skies left in, a ladder for DNA, a heart that is a valentine, a cat that is a face.

<details><summary>Scores per drawing (recognisable / clean / on-prompt)</summary>

| drawing | `claude-sonnet-5.5` | `gemini-3.8-flash` | `deepseek-v4.1-flash` | `claude-haiku-4.5` | `gpt-5.4-mini` |
|---|---|---|---|---|---|
| comic-police-1 | 3/3/2 | 3/2/3 | 3/2/2 | 1/1/2 | 2/1/2 |
| comic-police-2 | 3/3/3 | 3/2/3 | 2/2/2 | 2/1/2 | 1/1/1 |
| comic-police-3 | 3/3/3 | 3/2/3 | 3/3/3 | 2/2/3 | 2/2/3 |
| comic-police-4 | 3/2/3 | 2/2/3 | 3/2/3 | 1/1/1 | 1/1/1 |
| plant-cell | 3/2/3 | 3/2/3 | 3/2/3 | 2/2/3 | 2/1/2 |
| heart | 2/2/2 | 2/1/2 | 0/0/0 | 1/2/1 | 2/1/2 |
| circuit | 3/3/3 | 3/3/3 | 3/3/3 | 1/2/1 | 2/2/2 |
| volcano | 2/2/2 | 3/2/3 | 3/2/3 | 2/2/2 | 1/1/1 |
| castle | 3/3/3 | 3/3/3 | 3/3/3 | 2/2/2 | 2/1/2 |
| knight | 3/3/3 | 3/2/3 | 2/2/3 | 1/1/1 | 0/1/0 |
| rocket | 3/3/3 | 3/3/3 | 3/3/3 | 2/2/2 | 2/2/2 |
| handshake | 3/3/3 | 3/3/3 | 3/2/3 | 2/2/2 | 2/1/2 |
| storefront | 3/2/3 | 3/3/3 | 3/3/3 | 2/2/2 | 2/2/2 |
| cold-call | 3/3/3 | 3/2/3 | 2/2/2 | 2/2/2 | 2/2/2 |
| supply-chain | 3/3/3 | 3/3/3 | 2/2/3 | 2/2/2 | 1/2/2 |
| island | 3/3/3 | 3/2/3 | 3/2/3 | 2/1/2 | 1/1/1 |
| dna | 3/3/3 | 3/3/3 | 1/2/1 | 1/2/1 | 3/2/3 |
| solar-system | 3/3/3 | 3/2/3 | 3/3/3 | 2/2/2 | 2/2/2 |
| cat | 3/3/3 | 3/2/2 | 3/3/3 | 1/1/1 | 0/1/0 |

</details>

Drawn: 99% of all drawings in this round.
