import * as vscode from 'vscode';

import type { CompletionRequest, FileInfo } from '../../types';
import { ConfigManager } from '../../utils/config';
import { Logger } from '../../utils/logger';
import type { BuiltRequest, PreparedFileContext } from './types';

export class RequestBuilder {
  private readonly logger = Logger.getInstance();

  build(
    document: vscode.TextDocument,
    position: vscode.Position,
    prepared: PreparedFileContext,
    source: string
  ): BuiltRequest {
    const config = ConfigManager.getConfig();
    const currentFile: FileInfo = {
      path: prepared.fileInfo.path,
      content: prepared.relyOnFilesync ? '' : prepared.fileInfo.content,
      sha256: prepared.fileInfo.sha256,
      modelVersion: prepared.fileInfo.modelVersion
    };

    const request: CompletionRequest = {
      currentFile,
      cursorPosition: { line: position.line, column: position.character },
      context: this.extractContext(document, position),
      modelName: config.model ?? 'auto',
      debugOutput: config.logLevel === 'debug'
    };

    this.logger.debug(
      `📦 Built completion request for ${currentFile.path} (relyOnFilesync=${prepared.relyOnFilesync}) from ${source}`
    );

    return {
      request,
      relyOnFilesync: prepared.relyOnFilesync,
      workspaceId: prepared.workspaceId
    };
  }

  private extractContext(document: vscode.TextDocument, position: vscode.Position): string {
    const beforeStartLine = Math.max(0, position.line - 20);
    const beforeRange = new vscode.Range(beforeStartLine, 0, position.line, position.character);
    const afterEndLine = Math.min(document.lineCount - 1, position.line + 20);
    const lastLine = document.lineAt(afterEndLine);
    const afterRange = new vscode.Range(position.line, position.character, afterEndLine, lastLine.text.length);

    const beforeText = document.getText(beforeRange);
    const afterText = document.getText(afterRange);

    return `${beforeText}|CURSOR|${afterText}`;
  }
}
