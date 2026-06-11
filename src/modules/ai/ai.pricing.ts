export type AiBillingType = 'token' | 'image' | 'audio' | 'tool';

export type AiPricingRecord = {
  modelId: string;
  provider?: string;
  billingType: string;
  inputUsdMicrosPerMillion: number;
  outputUsdMicrosPerMillion: number;
  imageUsdMicrosEach: number;
  searchUsdMicrosPerThousand: number;
  enabled?: boolean;
};

export type AiUsageBreakdown = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  imageCount: number;
  searchGroundingCount: number;
};

export type AiUsageEstimate = AiUsageBreakdown & {
  credits: bigint;
  pricingSnapshot: Record<string, unknown>;
};

export const CREDIT_USD_MICROS = 1;
const TOKEN_DENOMINATOR = 1_000_000;
const TOOL_DENOMINATOR = 1_000;

export const DEFAULT_AI_MODEL_PRICING: AiPricingRecord[] = [
  {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash',
    billingType: 'token',
    inputUsdMicrosPerMillion: 1_500_000,
    outputUsdMicrosPerMillion: 9_000_000,
    imageUsdMicrosEach: 0,
    searchUsdMicrosPerThousand: 14_000_000,
    enabled: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    billingType: 'token',
    inputUsdMicrosPerMillion: 300_000,
    outputUsdMicrosPerMillion: 2_500_000,
    imageUsdMicrosEach: 0,
    searchUsdMicrosPerThousand: 35_000_000,
    enabled: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash-preview-tts',
    billingType: 'audio',
    inputUsdMicrosPerMillion: 500_000,
    outputUsdMicrosPerMillion: 10_000_000,
    imageUsdMicrosEach: 0,
    searchUsdMicrosPerThousand: 0,
    enabled: true,
  },
  {
    provider: 'gemini',
    modelId: 'imagen-4.0-generate-001',
    billingType: 'image',
    inputUsdMicrosPerMillion: 0,
    outputUsdMicrosPerMillion: 0,
    imageUsdMicrosEach: 40_000,
    searchUsdMicrosPerThousand: 0,
    enabled: true,
  },
];

const nonNegativeInt = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  numerator <= 0n ? 0n : (numerator + denominator - 1n) / denominator;

const finiteNonNegativeInt = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const componentCredits = (units: number, microsRate: number, denominator: number): bigint =>
  ceilDiv(BigInt(finiteNonNegativeInt(units)) * BigInt(finiteNonNegativeInt(microsRate)), BigInt(denominator));

export const pricingSnapshot = (pricing: AiPricingRecord): Record<string, unknown> => ({
  provider: pricing.provider ?? 'gemini',
  modelId: pricing.modelId,
  billingType: pricing.billingType,
  creditUsdMicros: CREDIT_USD_MICROS,
  inputUsdMicrosPerMillion: pricing.inputUsdMicrosPerMillion,
  outputUsdMicrosPerMillion: pricing.outputUsdMicrosPerMillion,
  imageUsdMicrosEach: pricing.imageUsdMicrosEach,
  searchUsdMicrosPerThousand: pricing.searchUsdMicrosPerThousand,
});

export const calculateAiCredits = (
  pricing: AiPricingRecord,
  usage: AiUsageBreakdown,
): AiUsageEstimate => {
  const outputBillableTokens = usage.outputTokens + usage.thinkingTokens;
  const credits =
    componentCredits(usage.inputTokens, pricing.inputUsdMicrosPerMillion, TOKEN_DENOMINATOR) +
    componentCredits(outputBillableTokens, pricing.outputUsdMicrosPerMillion, TOKEN_DENOMINATOR) +
    BigInt(finiteNonNegativeInt(usage.imageCount)) * BigInt(finiteNonNegativeInt(pricing.imageUsdMicrosEach)) +
    componentCredits(usage.searchGroundingCount, pricing.searchUsdMicrosPerThousand, TOOL_DENOMINATOR);

  return {
    ...usage,
    credits,
    pricingSnapshot: pricingSnapshot(pricing),
  };
};

export const billableSearchGroundingCount = (enabled: boolean): number =>
  enabled ? 1 : 0;

export const extractGeminiUsageBreakdown = (
  response: Record<string, unknown>,
  extras: Pick<AiUsageBreakdown, 'imageCount' | 'searchGroundingCount'> = {
    imageCount: 0,
    searchGroundingCount: 0,
  },
): AiUsageBreakdown => {
  const usage = (response.usageMetadata ?? response.usage_metadata) as Record<string, unknown> | undefined;
  const inputTokens = nonNegativeInt(usage?.promptTokenCount ?? usage?.prompt_token_count);
  const thinkingTokens = nonNegativeInt(usage?.thoughtsTokenCount ?? usage?.thoughts_token_count);
  const explicitOutputTokens = nonNegativeInt(usage?.candidatesTokenCount ?? usage?.candidates_token_count);
  const totalTokens = nonNegativeInt(usage?.totalTokenCount ?? usage?.total_token_count);
  const outputTokens =
    explicitOutputTokens ||
    (totalTokens > inputTokens + thinkingTokens ? totalTokens - inputTokens - thinkingTokens : 0);

  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens: Math.max(totalTokens, inputTokens + outputTokens + thinkingTokens),
    imageCount: extras.imageCount,
    searchGroundingCount: extras.searchGroundingCount,
  };
};

export const requestedImageCount = (data: Record<string, unknown>): number => {
  const parameters = (data.parameters ?? {}) as Record<string, unknown>;
  return (
    nonNegativeInt(parameters.sampleCount) ||
    nonNegativeInt(parameters.numberOfImages) ||
    nonNegativeInt(parameters.n) ||
    nonNegativeInt(data.sampleCount) ||
    nonNegativeInt(data.numberOfImages) ||
    1
  );
};

export const responseImageCount = (response: Record<string, unknown>): number => {
  const predictions = response.predictions;
  if (Array.isArray(predictions)) return predictions.length;
  const generatedImages = response.generatedImages ?? response.generated_images;
  if (Array.isArray(generatedImages)) return generatedImages.length;
  const images = response.images;
  if (Array.isArray(images)) return images.length;
  return 0;
};

export const responseSearchGroundingCount = (response: Record<string, unknown>): number => {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  let webSearchQueries = 0;
  let hasGrounding = false;
  for (const candidate of candidates) {
    const grounding = (candidate as Record<string, unknown>)?.groundingMetadata as Record<string, unknown> | undefined;
    const queries = grounding?.webSearchQueries ?? grounding?.web_search_queries;
    if (Array.isArray(queries)) webSearchQueries += queries.length;
    const chunks = grounding?.groundingChunks ?? grounding?.grounding_chunks;
    if (Array.isArray(chunks) && chunks.length > 0) hasGrounding = true;
    const supports = grounding?.groundingSupports ?? grounding?.grounding_supports;
    if (Array.isArray(supports) && supports.length > 0) hasGrounding = true;
  }
  return webSearchQueries || (hasGrounding ? 1 : 0);
};
