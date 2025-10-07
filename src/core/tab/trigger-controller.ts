import * as vscode from 'vscode';

import { ConfigManager } from '../../utils/config';
import { Logger } from '../../utils/logger';
import { TabStateMachine } from './state-machine';
import { SuggestionStore } from './suggestion-store';
import { FilesyncCoordinator } from './filesync-coordinator';
import { TabDebouncer } from './debouncer';
import { RequestBuilder } from './request-builder';
import { StreamManager } from './stream-manager';
import type { RequestContext, SuggestionRecord, TriggerSource } from './types';

export class TriggerController {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly debouncer: TabDebouncer,
    private readonly filesyncCoordinator: FilesyncCoordinator,
    private readonly requestBuilder: RequestBuilder,
    private readonly streamManager: StreamManager,
    private readonly suggestionStore: SuggestionStore,
    private readonly stateMachine: TabStateMachine
  ) {}

  async requestInlineCompletion(context: RequestContext): Promise<vscode.InlineCompletionItem | undefined> {
    const { document, position, token } = context;

    if (token.isCancellationRequested) {
      return undefined;
    }

    if (!this.isFeatureAllowed()) {
      return undefined;
    }

    if (!this.isEditorAllowed(document, position)) {
      return undefined;
    }

    const documentUri = document.uri.toString();

    if (this.suggestionStore.consumeSelfChangeSuppression(documentUri)) {
      this.logger.debug('🚫 Suppressing trigger due to recent self-applied suggestion');
      return undefined;
    }

    this.stateMachine.transition(documentUri, 'Debouncing');
    const ticket = this.debouncer.runRequest();
    this.streamManager.cancelRequests(ticket.requestIdsToCancel);

    if (await this.debouncer.shouldDebounce(ticket.generationUUID)) {
      this.debouncer.finishRequest(ticket.generationUUID);
      this.stateMachine.transition(documentUri, 'Idle');
      return undefined;
    }

    try {
      this.stateMachine.transition(documentUri, 'Computing', ticket.generationUUID);
      const preparedFile = await this.filesyncCoordinator.prepareFile(document);
      if (token.isCancellationRequested) {
        this.stateMachine.transition(documentUri, 'Rejected', ticket.generationUUID);
        this.stateMachine.transition(documentUri, 'Idle');
        return undefined;
      }
      const builtRequest = this.requestBuilder.build(document, position, preparedFile, context.source);

      const suggestion = await this.streamManager.executeStream(
        builtRequest,
        ticket,
        document,
        position,
        token
      );

      if (!suggestion) {
        this.stateMachine.transition(documentUri, 'Rejected', ticket.generationUUID);
        this.stateMachine.transition(documentUri, 'Idle');
        return undefined;
      }

      const inlineItem = new vscode.InlineCompletionItem(suggestion.text, suggestion.range);
      const record: SuggestionRecord = {
        ...suggestion,
        source: context.source,
        createdAt: Date.now()
      };

      this.suggestionStore.set(documentUri, record);
      this.stateMachine.transition(documentUri, 'ShowingSuggestion', suggestion.requestId);
      return inlineItem;
    } finally {
      this.debouncer.finishRequest(ticket.generationUUID);
    }
  }

  private isFeatureAllowed(): boolean {
    const config = ConfigManager.getConfig();
    if (!config.enabled) {
      return false;
    }
    if (config.snoozeUntil && config.snoozeUntil > Date.now()) {
      return false;
    }
    return true;
  }

  private isEditorAllowed(document: vscode.TextDocument, position: vscode.Position): boolean {
    if (document.isClosed) {
      return false;
    }

    if (document.uri.scheme !== 'file') {
      return false;
    }

    const fileName = document.fileName.toLowerCase();
    if (fileName.includes('.env')) {
      return false;
    }

    if (document.languageId === 'plaintext') {
      return false;
    }

    if (document.lineCount > 20000) {
      return false;
    }

    // 粗略的注释触发策略：如果当前行是纯注释且为空，允许；否则遵循配置
    const lineText = document.lineAt(position.line).text.trim();
    if (lineText.startsWith('//') || lineText.startsWith('#')) {
      return lineText.length === 2; // 仅允许空注释行
    }

    return true;
  }

  mapInlineContextToSource(context: vscode.InlineCompletionContext): TriggerSource {
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
      return 'ManualTrigger';
    }
    if (context.selectedCompletionInfo) {
      return 'LspSuggestions';
    }
    return 'Typing';
  }
}
