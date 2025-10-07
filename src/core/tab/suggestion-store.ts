import * as vscode from 'vscode';

import { Logger } from '../../utils/logger';
import type { SuggestionRecord } from './types';

interface SelfChangeState {
  pending: boolean;
  lastRequestId?: string;
}

export class SuggestionStore {
  private readonly logger = Logger.getInstance();
  private readonly suggestions = new Map<string, SuggestionRecord>();
  private readonly selfChangeSuppression = new Map<string, SelfChangeState>();
  private readonly changeSubscription: vscode.Disposable;

  constructor() {
    this.changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      const docUri = event.document.uri.toString();
      const record = this.suggestions.get(docUri);
      if (!record) {
        return;
      }

      const insertedText = event.contentChanges.map(change => change.text).join('');
      if (insertedText && insertedText === record.text) {
        this.logger.debug(`📝 Detected acceptance for request ${record.requestId}`);
        this.selfChangeSuppression.set(docUri, { pending: true, lastRequestId: record.requestId });
        this.clear(docUri);
      }
    });
  }

  set(documentUri: string, suggestion: SuggestionRecord): void {
    this.suggestions.set(documentUri, suggestion);
  }

  get(documentUri: string): SuggestionRecord | undefined {
    return this.suggestions.get(documentUri);
  }

  clear(documentUri: string): void {
    this.suggestions.delete(documentUri);
  }

  consumeSelfChangeSuppression(documentUri: string): boolean {
    const state = this.selfChangeSuppression.get(documentUri);
    if (!state?.pending) {
      return false;
    }
    this.selfChangeSuppression.set(documentUri, { pending: false, lastRequestId: state.lastRequestId });
    return true;
  }

  cancelSelfChangeSuppression(documentUri: string): void {
    this.selfChangeSuppression.delete(documentUri);
  }

  dispose(): void {
    this.changeSubscription.dispose();
    this.suggestions.clear();
    this.selfChangeSuppression.clear();
  }
}
