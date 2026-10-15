import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudget } from '../src/budget.js';

test('TOK-001 accepts request comfortably within capacity', () => {
  const d = evaluateBudget({ contextLimit: 100, inputTokens: 20, overheadTokens: 10, reservedOutputTokens: 20 });
  assert.deepEqual([d.allowed, d.projectedTotal, d.remainingTokens, d.reason], [true, 50, 50, 'WITHIN_BUDGET']);
});

test('TOK-002 accepts at exact boundary', () => {
  const d = evaluateBudget({ contextLimit: 100, inputTokens: 25, overheadTokens: 40, reservedOutputTokens: 35 });
  assert.deepEqual([d.allowed, d.projectedTotal, d.remainingTokens], [true, 100, 0]);
});

test('TOK-003 rejects one token over', () => {
  const d = evaluateBudget({ contextLimit: 100, inputTokens: 71, overheadTokens: 10, reservedOutputTokens: 20 });
  assert.deepEqual([d.allowed, d.projectedTotal, d.remainingTokens], [false, 101, -1]);
});

test('TOK-005 reserves output and flips acceptance', () => {
  const base = { contextLimit: 100, inputTokens: 60, overheadTokens: 10 };
  const accepted = evaluateBudget({ ...base, reservedOutputTokens: 20 });
  const rejected = evaluateBudget({ ...base, reservedOutputTokens: 40 });
  assert.deepEqual([accepted.allowed, accepted.projectedTotal], [true, 90]);
  assert.deepEqual([rejected.allowed, rejected.projectedTotal], [false, 110]);
});

test('invalid counts fail closed', () => {
  assert.throws(() => evaluateBudget({ contextLimit: 100, inputTokens: -1, overheadTokens: 0, reservedOutputTokens: 20 }));
  assert.throws(() => evaluateBudget({ contextLimit: 0, inputTokens: 2, overheadTokens: 0, reservedOutputTokens: 20 }));
});
