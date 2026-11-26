import test from 'node:test';
import assert from 'node:assert/strict';
import { bufferToVector, cosineSimilarity, vectorToBuffer } from '../server/vector.js';

test('vectors survive a binary round trip', () => {
  const input = new Float32Array([0.12, -0.5, 1, 0, 0.333]);
  const output = bufferToVector(vectorToBuffer(input));
  assert.equal(output.length, input.length);
  for (let index = 0; index < input.length; index++) {
    assert.ok(Math.abs(output[index] - input[index]) < 1e-6);
  }
});

test('cosine similarity ranks related vectors higher', () => {
  const query = new Float32Array([1, 0, 0]);
  const related = new Float32Array([0.9, 0.1, 0]);
  const unrelated = new Float32Array([0, 1, 0]);
  assert.ok(cosineSimilarity(query, related) > cosineSimilarity(query, unrelated));
  assert.equal(cosineSimilarity(query, new Float32Array([0, 0, 0])), 0);
});
