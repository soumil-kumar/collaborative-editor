export function transformOp(opA, opB) {
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
    if (opB.position >= opA.position) return opA;
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
    if (opB.position >= opA.position + opA.length) return opA;
    const overlapStart = Math.max(opA.position, opB.position);
    const overlapEnd = Math.min(opA.position + opA.length, opB.position + opB.length);
    const overlap = overlapEnd - overlapStart;
    const newPos = opB.position < opA.position ? opB.position : opA.position;
    return { ...opA, position: newPos, length: opA.length - overlap };
  }
  return opA;
}

const SYNCHRONIZED = 'synchronized';
const AWAITING_ACK = 'awaiting_ack';
const AWAITING_ACK_WITH_BUFFER = 'awaiting_ack_with_buffer';

export class OTClient {
  constructor(onSend) {
    this.state = SYNCHRONIZED;
    this.pendingOp = null;
    this.buffer = [];
    this.onSend = onSend;
  }

  localOp(op, serverVersion) {
    if (this.state === SYNCHRONIZED) {
      this.pendingOp = op;
      this.state = AWAITING_ACK;
      this.onSend(op, serverVersion);
    } else {
      this.buffer.push(op);
      this.state = AWAITING_ACK_WITH_BUFFER;
    }
  }

  serverAck(newVersion) {
    if (this.buffer.length > 0) {
      const nextOp = this.buffer.shift();
      this.pendingOp = nextOp;
      this.state = this.buffer.length > 0 ? AWAITING_ACK_WITH_BUFFER : AWAITING_ACK;
      this.onSend(nextOp, newVersion);
    } else {
      this.pendingOp = null;
      this.state = SYNCHRONIZED;
    }
  }

  remoteOp(serverOp) {
    if (this.state === SYNCHRONIZED) {
      return serverOp;
    }

    let transformed = serverOp;

    if (this.pendingOp) {
      const nextPending = transformOp(this.pendingOp, transformed);
      transformed = transformOp(transformed, this.pendingOp);
      this.pendingOp = nextPending;
    }

    if (this.buffer.length > 0) {
      const nextBuffer = [];
      for (const bufferedOp of this.buffer) {
        const nextBuffered = transformOp(bufferedOp, transformed);
        transformed = transformOp(transformed, bufferedOp);
        nextBuffer.push(nextBuffered);
      }
      this.buffer = nextBuffer;
    }

    return transformed;
  }
}
