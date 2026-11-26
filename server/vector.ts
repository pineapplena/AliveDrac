export function vectorToBuffer(vector: Float32Array | number[]): Buffer {
  const values = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  const buffer = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index++) {
    buffer.writeFloatLE(values[index], index * 4);
  }
  return buffer;
}

export function bufferToVector(input: Uint8Array): Float32Array {
  const buffer = Buffer.from(input);
  const length = Math.floor(buffer.length / 4);
  const vector = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    vector[index] = buffer.readFloatLE(index * 4);
  }
  return vector;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
