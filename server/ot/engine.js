// Transforms opA against an already applied opB
function transformOp(opA, opB) {
  if (opA.type === 'insert' && opB.type === 'insert') {
    if (opB.position <= opA.position) {
      return { ...opA, position: opA.position + opB.text.length };
    }
    return opA;
  }

  if (opA.type === 'insert' && opB.type === 'delete') {
    if (opB.position + opB.length <= opA.position) {
      return { ...opA, position: opA.position - opB.length };
    }
    if (opB.position >= opA.position) {
      return opA;
    }
    return { ...opA, position: opB.position };
  }

  if (opA.type === 'delete' && opB.type === 'insert') {
    if (opB.position <= opA.position) {
      return { ...opA, position: opA.position + opB.text.length };
    }
    if (opB.position < opA.position + opA.length) {
      return { ...opA, length: opA.length + opB.text.length };
    }
    return opA;
  }

  if (opA.type === 'delete' && opB.type === 'delete') {
    if (opB.position + opB.length <= opA.position) {
      return { ...opA, position: opA.position - opB.length };
    }
    if (opB.position >= opA.position + opA.length) {
      return opA;
    }
    // Handle overlapping deletion ranges
    const overlapStart = Math.max(opA.position, opB.position);
    const overlapEnd = Math.min(opA.position + opA.length, opB.position + opB.length);
    const overlap = overlapEnd - overlapStart;
    const newPos = opB.position < opA.position ? opB.position : opA.position;
    return { ...opA, position: newPos, length: opA.length - overlap };
  }

  return opA;
}

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

// Single source of truth per collaborative room
class DocumentState {
  constructor(initialContent = '') {
    this.content = initialContent;
    this.version = 0;
    this.history = [];
  }

  applyClientOp(op, baseVersion) {
    let transformed = op;
    // Catch up op against any newer concurrent ops committed since baseVersion
    for (let i = baseVersion; i < this.history.length; i++) {
      transformed = transformOp(transformed, this.history[i].op);
    }

    if (transformed.type === 'delete' && transformed.length <= 0) {
      return null;
    }

    this.content = applyOp(this.content, transformed);
    this.version++;
    this.history.push({ op: transformed, version: this.version });

    // Keep history bounded
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
