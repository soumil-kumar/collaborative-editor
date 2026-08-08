/**
 * Client-side Operational Transform
 *
 * Implements the standard 3-state OT client model:
 *
 *   Synchronized ──(local edit)──> AwaitingAck
 *   AwaitingAck ──(local edit)──> AwaitingAckWithBuffer
 *   AwaitingAck ──(server ack)──> Synchronized
 *   AwaitingAckWithBuffer ──(server ack)──> AwaitingAck (re-sends buffer)
 *
 * This ensures that local edits are sent to the server in order,
 * and that incoming server ops are correctly transformed against
 * any unacknowledged local ops before being applied to the editor.
 */

/**
 * Transform opA assuming opB has already been applied.
 * Mirror of the server-side transformOp.
 */
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

// Client OT state machine states
const SYNCHRONIZED = 'synchronized';
const AWAITING_ACK = 'awaiting_ack';
const AWAITING_ACK_WITH_BUFFER = 'awaiting_ack_with_buffer';

export class OTClient {
  constructor(onSend) {
    this.state = SYNCHRONIZED;
    this.pendingOp = null;   // Op sent, awaiting ack
    this.bufferOp = null;    // Op queued while awaiting ack
    this.onSend = onSend;    // Callback to send op to server
  }

  /**
   * Called when the user makes a local edit.
   * Sends op immediately if synchronized, or buffers it.
   * Returns the op as-is (already applied locally by Monaco).
   */
  localOp(op, serverVersion) {
    if (this.state === SYNCHRONIZED) {
      this.pendingOp = op;
      this.state = AWAITING_ACK;
      this.onSend(op, serverVersion);
    } else if (this.state === AWAITING_ACK) {
      this.bufferOp = op;
      this.state = AWAITING_ACK_WITH_BUFFER;
    } else {
      // Compose buffer op with new op (simplification: just overwrite for now)
      this.bufferOp = op;
    }
  }

  /**
   * Called when server acks our pending op with the new version.
   */
  serverAck(newVersion) {
    if (this.state === AWAITING_ACK) {
      this.pendingOp = null;
      this.state = SYNCHRONIZED;
    } else if (this.state === AWAITING_ACK_WITH_BUFFER) {
      this.onSend(this.bufferOp, newVersion);
      this.pendingOp = this.bufferOp;
      this.bufferOp = null;
      this.state = AWAITING_ACK;
    }
  }

  /**
   * Called when a remote op arrives from the server.
   * Transforms it against any unacknowledged local ops before applying.
   * Returns the transformed op to apply to the local editor.
   */
  remoteOp(serverOp) {
    if (this.state === SYNCHRONIZED) {
      return serverOp;
    }
    if (this.state === AWAITING_ACK) {
      const transformed = transformOp(serverOp, this.pendingOp);
      this.pendingOp = transformOp(this.pendingOp, serverOp);
      return transformed;
    }
    if (this.state === AWAITING_ACK_WITH_BUFFER) {
      let op = serverOp;
      op = transformOp(op, this.pendingOp);
      op = transformOp(op, this.bufferOp);
      this.pendingOp = transformOp(this.pendingOp, serverOp);
      this.bufferOp = transformOp(this.bufferOp, transformOp(serverOp, this.pendingOp));
      return op;
    }
    return serverOp;
  }
}
