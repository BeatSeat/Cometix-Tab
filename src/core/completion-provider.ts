import * as vscode from 'vscode';

import { Logger } from '../utils/logger';
import type { TriggerController } from './tab/trigger-controller';
import type { TriggerSource } from './tab/types';

export class CursorCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly triggerController: TriggerController) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    try {
      const source = this.getTriggerSource(context);
      const item = await this.triggerController.requestInlineCompletion({
        document,
        position,
        token,
        source
      });

      if (!item) {
        return undefined;
      }

      return [item];
    } catch (error) {
      this.logger.error('❌ Failed to provide inline completion', error as Error);
      return undefined;
    }
  }

  dispose(): void {
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private getTriggerSource(context: vscode.InlineCompletionContext): TriggerSource {
    return this.triggerController.mapInlineContextToSource(context);
  }
}
