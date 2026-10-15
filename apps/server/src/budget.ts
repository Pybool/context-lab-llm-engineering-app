export type BudgetDecision = Readonly<{
  allowed: boolean;
  reason: 'WITHIN_BUDGET' | 'CONTEXT_LIMIT_EXCEEDED';
  inputTokens: number;
  overheadTokens: number;
  reservedOutputTokens: number;
  projectedTotal: number;
  remainingTokens: number;
  contextLimit: number;
}>;

function assertCount(label: string, value: number, positive = false) {
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'non-negative'} safe integer`);
  }
}

export function evaluateBudget(args: {
  inputTokens: number;
  overheadTokens: number;
  reservedOutputTokens: number;
  contextLimit: number;
}): BudgetDecision {
  assertCount('inputTokens', args.inputTokens);
  assertCount('overheadTokens', args.overheadTokens);
  assertCount('reservedOutputTokens', args.reservedOutputTokens, true);
  assertCount('contextLimit', args.contextLimit, true);
  const projectedTotal = args.inputTokens + args.overheadTokens + args.reservedOutputTokens;
  if (!Number.isSafeInteger(projectedTotal)) throw new Error('Projected token count overflow');
  const remainingTokens = args.contextLimit - projectedTotal;
  const allowed = remainingTokens >= 0;
  return Object.freeze({
    ...args,
    projectedTotal,
    remainingTokens,
    allowed,
    reason: allowed ? 'WITHIN_BUDGET' : 'CONTEXT_LIMIT_EXCEEDED',
  });
}
