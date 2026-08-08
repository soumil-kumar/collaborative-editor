/**
 * Operational Transform Engine
 *
 * Two operation types:
 *   { type: 'insert', position: number, text: string }
 *   { type: 'delete', position: number, length: number }
 *
 * The server is the single source of truth. Every op from a client includes
 * a baseVersion — the document version the client was looking at when they
 * made the edit. The server transforms the op against all ops that have
 * been applied since that version, then applies it.
 */

/**
 * Transform opA assuming opB has already been applied.
 * Returns a new op equivalent to opA but valid against the post-opB document.
 */
function transformOp(opA, opB) {
  if (opA.type === 'insert' && opB.type === 'insert') {
    // Both inserts: if opB was at or before opA's position, shift opA right
    if (opB.position <= opA.position) {
      return { ...opA, position: opA.position + opB.text.length };
    }
    return opA;
  }

  if (opA.type === 'insert' && opB.type === 'delete') {
    // opB deleted text before opA: shift opA left
    if (opB.position + opB.length <= opA.position) {
      return { ...opA, position: opA.position - opB.length };
    }
    // opB deleted text that overlaps or is after opA: no shift needed
    if (opB.position >= opA.position) {
      return opA;
    }
    // opB deleted text that straddles opA's position: move to deletion start
    return { ...opA, position: opB.position };
  }

  if (opA.type === 'delete' && opB.type === 'insert') {
    // opB inserted before opA: shift opA right
    if (opB.position <= opA.position) {
      return { ...opA, position: opA.position + opB.text.length };
    }
    // opB inserted inside opA's deletion range: extend opA's length
    if (opB.position < opA.position + opA.length) {
      return { ...opA, length: opA.length + opB.text.length };
    }
    return opA;
  }

  if (opA.type === 'delete' && opB.type === 'delete') {
    // opB entirely before opA
    if (opB.position + opB.length <= opA.position) {
      return { ...opA, position: opA.position - opB.length };
    }
    // opB entirely after opA
    if (opB.position >= opA.position + opA.length) {
      return opA;
    }
    // Overlapping deletes — shrink opA to remove the overlap
    const overlapStart = Math.max(opA.position, opB.position);
    const overlapEnd = Math.min(opA.position + opA.length, opB.position + opB.length);
    const overlap = overlapEnd - overlapStart;
    const newPos = opB.position < opA.position ? opB.position : opA.position;
    return { ...opA, position: newPos, length: opA.length - overlap };
  }

  return opA; // Unknown op type — pass through unchanged
}

/**
 * Apply an op to a document string. Returns the new string.
 */
function applyOp(doc, op) {
  if (op.type === 'insert') {
    return doc.slice(0, op.position) + op.text + doc.slice(op.position);
  }
  if (op.type === 'delete') {
    const safeLen = Math.min(op.length, doc.length - op.position);
    return doc.slice(0, op.position) + doc.slice(op.position + safeLen);
  }
  return doc;
}

/**
 * DocumentState — holds the canonical server-side document.
 * One instance per room.
 */
class DocumentState {
  constructor(initialContent = '') {
    this.content = initialContent;
    this.version = 0;
    // History stores all applied ops so we can transform late-arriving ops
    this.history = []; // Array of { op, version }
  }

  /**
   * Receive an op from a client at baseVersion.
   * Transforms against all ops since baseVersion, applies it, increments version.
   * Returns the transformed op (to broadcast to other clients).
   */
  applyClientOp(op, baseVersion) {
    // Transform op against all ops that happened after baseVersion
    let transformed = op;
    for (let i = baseVersion; i < this.history.length; i++) {
      transformed = transformOp(transformed, this.history[i].op);
    }

    // Skip no-op deletes (length 0 after transformation)
    if (transformed.type === 'delete' && transformed.length <= 0) {
      return null;
    }

    this.content = applyOp(this.content, transformed);
    this.version++;
    this.history.push({ op: transformed, version: this.version });

    // Trim history to prevent unbounded growth (keep last 1000 ops)
    if (this.history.length > 1000) {
      this.history = this.history.slice(this.history.length - 500);
    }

    return transformed;
  }

  getSnapshot() {
    return { content: this.content, version: this.version };
  }
}

module.exports = { DocumentState, transformOp, applyOp };
