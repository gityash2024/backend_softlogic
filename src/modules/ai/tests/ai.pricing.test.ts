import {
  DEFAULT_AI_MODEL_PRICING,
  billableSearchGroundingCount,
  calculateAiCredits,
  extractGeminiUsageBreakdown,
  responseImageCount,
  responseSearchGroundingCount,
} from '../ai.pricing';

const pricing = DEFAULT_AI_MODEL_PRICING.find((row) => row.modelId === 'gemini-3.5-flash')!;

describe('AI cost-aware pricing', () => {
  it('charges input and output at separate model rates', () => {
    const result = calculateAiCredits(pricing, {
      inputTokens: 10_000,
      outputTokens: 5_000,
      thinkingTokens: 0,
      totalTokens: 15_000,
      imageCount: 0,
      searchGroundingCount: 0,
    });

    expect(result.credits).toBe(60_000n);
  });

  it('charges thinking tokens as output-priced tokens', () => {
    const result = calculateAiCredits(pricing, {
      inputTokens: 1_000,
      outputTokens: 1_000,
      thinkingTokens: 500,
      totalTokens: 2_500,
      imageCount: 0,
      searchGroundingCount: 0,
    });

    expect(result.credits).toBe(15_000n);
  });

  it('charges Imagen output per generated image', () => {
    const imagen = DEFAULT_AI_MODEL_PRICING.find((row) => row.modelId === 'imagen-4.0-generate-001')!;
    const result = calculateAiCredits(imagen, {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      imageCount: 2,
      searchGroundingCount: 0,
    });

    expect(result.credits).toBe(80_000n);
  });

  it('charges Google Search grounding per configured thousand prompts or queries', () => {
    const result = calculateAiCredits(pricing, {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      imageCount: 0,
      searchGroundingCount: 1,
    });

    expect(result.credits).toBe(14_000n);
  });

  it('extracts Gemini usage metadata into auditable token buckets', () => {
    const usage = extractGeminiUsageBreakdown({
      usageMetadata: {
        promptTokenCount: 800,
        candidatesTokenCount: 1200,
        thoughtsTokenCount: 300,
        totalTokenCount: 2300,
      },
    });

    expect(usage).toMatchObject({
      inputTokens: 800,
      outputTokens: 1200,
      thinkingTokens: 300,
      totalTokens: 2300,
    });
  });

  it('counts image and search grounding metadata for extra charges', () => {
    expect(responseImageCount({ predictions: [{}, {}, {}] })).toBe(3);
    expect(
      responseSearchGroundingCount({
        candidates: [
          { groundingMetadata: { webSearchQueries: ['q1', 'q2'] } },
        ],
      }),
    ).toBe(2);
  });

  it('bills grounded Gemini requests as one grounded prompt even when multiple queries are returned', () => {
    const returnedQueries = responseSearchGroundingCount({
      candidates: [
        { groundingMetadata: { webSearchQueries: ['q1', 'q2', 'q3', 'q4'] } },
      ],
    });

    expect(returnedQueries).toBe(4);
    expect(billableSearchGroundingCount(true)).toBe(1);
    expect(billableSearchGroundingCount(false)).toBe(0);
  });
});
