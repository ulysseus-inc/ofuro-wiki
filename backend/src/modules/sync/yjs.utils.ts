import * as Y from 'yjs';

export function mergeUpdates(updates: Uint8Array[]): Uint8Array {
  if (updates.length === 0) return Y.encodeStateAsUpdate(new Y.Doc());
  if (updates.length === 1) return updates[0];
  return Y.mergeUpdates(updates);
}

export function diffUpdate(
  fullUpdate: Uint8Array,
  stateVector: Uint8Array,
): Uint8Array {
  return Y.diffUpdate(fullUpdate, stateVector);
}

export function encodeStateVector(update: Uint8Array): Uint8Array {
  return Y.encodeStateVectorFromUpdate(update);
}

export function createDocFromUpdates(updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

export function encodeDocState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
