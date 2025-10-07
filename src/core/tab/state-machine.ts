import type { StatePhase, StateSnapshot } from './types';

export class TabStateMachine {
  private readonly states = new Map<string, StateSnapshot>();

  transition(documentUri: string, phase: StatePhase, requestId?: string): void {
    this.states.set(documentUri, {
      documentUri,
      phase,
      requestId,
      lastTransitionAt: Date.now()
    });
  }

  getState(documentUri: string): StateSnapshot | undefined {
    return this.states.get(documentUri);
  }

  clear(documentUri: string): void {
    this.states.delete(documentUri);
  }
}
