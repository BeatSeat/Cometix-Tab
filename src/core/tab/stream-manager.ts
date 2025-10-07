import * as vscode from 'vscode';

import { StreamCppResponse } from '../../generated/cpp_pb';
import { CursorApiClient } from '../api-client';
import { Logger } from '../../utils/logger';
import type { BuiltRequest, StreamSuggestion, TriggerTicket } from './types';

export class StreamManager {
  private readonly logger = Logger.getInstance();
  private readonly inFlight = new Map<string, AbortController>();
  private concurrencyCap = 6;

  constructor(private readonly apiClient: CursorApiClient) {}

  setConcurrencyCap(cap: number): void {
    this.concurrencyCap = Math.max(1, cap);
  }

  cancelRequests(requestIds: string[]): void {
    for (const requestId of requestIds) {
      const controller = this.inFlight.get(requestId);
      if (controller) {
        this.logger.debug(`🛑 Canceling in-flight request ${requestId}`);
        controller.abort();
        this.inFlight.delete(requestId);
      }
    }
  }

  async executeStream(
    built: BuiltRequest,
    ticket: TriggerTicket,
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<StreamSuggestion | undefined> {
    if (this.inFlight.size >= this.concurrencyCap) {
      this.logger.warn('⚠️ Concurrency cap reached, dropping request');
      return undefined;
    }

    this.inFlight.set(ticket.generationUUID, ticket.abortController);

    try {
      const stream = await this.apiClient.requestCompletion(built.request, ticket.abortController.signal);
      if (!stream) {
        this.logger.warn('⚠️ API client returned null stream');
        return undefined;
      }

      let text = '';
      let bindingId: string | undefined;
      let modelInfoReceived = false;
      let modelIdentifier: string | undefined;
      let cursorPosition: { line: number; column: number } | undefined;
      let range: vscode.Range | undefined;

      for await (const message of stream) {
        if (token.isCancellationRequested) {
          this.logger.debug(`🛑 Cancellation requested for ${ticket.generationUUID}`);
          ticket.abortController.abort();
          return undefined;
        }

        if (message instanceof StreamCppResponse) {
          if (message.modelInfo && !modelInfoReceived) {
            modelInfoReceived = true;
            modelIdentifier = message.modelInfo.isFusedCursorPredictionModel ? 'fused-cursor-prediction' : 'standard';
            this.logger.debug(`ℹ️ Model info received: ${modelIdentifier}`);
          }

          if (!modelInfoReceived) {
            continue;
          }

          if (message.text) {
            text += message.text;
          }

          if (message.bindingId) {
            bindingId = message.bindingId;
          }

          if (message.cursorPredictionTarget) {
            const line = message.cursorPredictionTarget.lineNumberOneIndexed
              ? message.cursorPredictionTarget.lineNumberOneIndexed - 1
              : position.line;
            cursorPosition = {
              line,
              column: position.character
            };
          }

          if (message.rangeToReplace) {
            range = this.convertRange(message.rangeToReplace, document);
          }

          if (message.doneStream) {
            break;
          }
        } else if (message && typeof message === 'object') {
          if (message.type === 'text' && typeof message.text === 'string') {
            text += message.text;
          }
          if (message.type === 'model_info') {
            modelInfoReceived = true;
          }
          if (message.type === 'done_stream') {
            break;
          }
        }
      }

      if (!text) {
        this.logger.debug('📭 No text generated for stream');
        return undefined;
      }

      const finalRange = range ?? new vscode.Range(position, position);

      return {
        requestId: ticket.generationUUID,
        text,
        range: finalRange,
        bindingId,
        modelInfoReceived,
        modelIdentifier,
        cursorPosition
      };
    } finally {
      this.inFlight.delete(ticket.generationUUID);
    }
  }

  private convertRange(lineRange: StreamCppResponse['rangeToReplace'], document: vscode.TextDocument): vscode.Range {
    if (!lineRange) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const startLine = Math.max(0, lineRange.startLineNumber ?? 0);
    const endLine = Math.max(startLine, lineRange.endLineNumberInclusive ?? startLine);

    const start = new vscode.Position(startLine, 0);
    const endLineText = document.lineAt(Math.min(endLine, document.lineCount - 1));
    const end = new vscode.Position(endLine, endLineText.text.length);
    return new vscode.Range(start, end);
  }
}
