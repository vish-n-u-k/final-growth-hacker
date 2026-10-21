// Anthropic list prices, USD per million tokens. Cache writes cost 1.25x input, cache reads 0.1x.
// Update when a new model is used; unknown models fall back to Sonnet prices so costs aren't hidden.
const RATES: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku-4|haiku-5/, input: 1, output: 5 },
  { match: /haiku/, input: 0.8, output: 4 },
  { match: /opus-4-[5-9]|opus-[5-9]/, input: 5, output: 25 },
  { match: /opus/, input: 15, output: 75 },
  { match: /sonnet/, input: 3, output: 15 },
]

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export function anthropicCostUsd(model: string, u: TokenUsage): number {
  const rate = RATES.find(r => r.match.test(model)) ?? RATES[RATES.length - 1]
  const perTok = (n: number | null | undefined, price: number) => ((n ?? 0) / 1_000_000) * price
  return perTok(u.input_tokens, rate.input)
    + perTok(u.cache_creation_input_tokens, rate.input * 1.25)
    + perTok(u.cache_read_input_tokens, rate.input * 0.1)
    + perTok(u.output_tokens, rate.output)
}
