import * as vscode from 'vscode';
import { setTimeout as sleep } from 'timers/promises';

import type { FileInfo } from '../../types';
import { Logger } from '../../utils/logger';
import { WorkspaceManager } from '../../utils/workspace-manager';
import { FileManager } from '../file-manager';
import type { PreparedFileContext } from './types';

interface FileReliabilityState {
  successStreak: number;
  lastModelVersion: number;
}

export class FilesyncCoordinator {
  private readonly logger = Logger.getInstance();
  private readonly reliability = new Map<string, FileReliabilityState>();
  private successiveSyncsRequiredForReliance = 5;
  private enableDebounceSkipping = false;

  constructor(private readonly fileManager: FileManager) {}

  updateConfig(options: {
    successiveSyncsRequiredForReliance?: number;
    enableFilesyncDebounceSkipping?: boolean;
  }): void {
    if (typeof options.successiveSyncsRequiredForReliance === 'number') {
      this.successiveSyncsRequiredForReliance = Math.max(1, options.successiveSyncsRequiredForReliance);
    }
    if (typeof options.enableFilesyncDebounceSkipping === 'boolean') {
      this.enableDebounceSkipping = options.enableFilesyncDebounceSkipping;
    }
  }

  private getWorkspaceId(document: vscode.TextDocument): string {
    const workspaceManager = WorkspaceManager.getInstance();
    if (document.uri.scheme === 'file') {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (folder) {
        return WorkspaceManager.getInstance().getWorkspaceId();
      }
    }
    return workspaceManager.getWorkspaceId();
  }

  private updateReliabilityState(filePath: string, info: FileInfo): void {
    const state = this.reliability.get(filePath) ?? { successStreak: 0, lastModelVersion: 0 };
    const currentVersion = info.modelVersion ?? 0;

    if (currentVersion === 0) {
      state.successStreak = 0;
    } else if (currentVersion > state.lastModelVersion) {
      state.successStreak = Math.min(state.successStreak + 1, this.successiveSyncsRequiredForReliance);
    }

    state.lastModelVersion = currentVersion;
    this.reliability.set(filePath, state);
  }

  private isReliable(filePath: string): boolean {
    const state = this.reliability.get(filePath);
    return (state?.successStreak ?? 0) >= this.successiveSyncsRequiredForReliance;
  }

  async prepareFile(document: vscode.TextDocument): Promise<PreparedFileContext> {
    const workspaceId = this.getWorkspaceId(document);
    const fileInfo = await this.fileManager.getCurrentFileInfo(document);
    const filePath = fileInfo.path;

    this.updateReliabilityState(filePath, fileInfo);
    const reliable = this.isReliable(filePath);

    if (!reliable) {
      await this.fileManager.forceSyncDocument(document);
      const refreshedInfo = this.fileManager.getSyncedFileInfo(filePath);
      if (refreshedInfo) {
        this.updateReliabilityState(filePath, refreshedInfo);
      }
    } else if (this.enableDebounceSkipping) {
      await this.waitForRecentUpdates(filePath, fileInfo.modelVersion ?? 0);
    }

    const relyOnFilesync = this.isReliable(filePath);

    return {
      fileInfo: relyOnFilesync ? { ...fileInfo, content: fileInfo.content } : fileInfo,
      relyOnFilesync,
      workspaceId,
      lineEnding: document.eol === vscode.EndOfLine.LF ? '\n' : '\r\n'
    };
  }

  private async waitForRecentUpdates(filePath: string, expectedVersion: number): Promise<void> {
    if (!expectedVersion) {
      return;
    }

    for (let i = 0; i < 8; i++) {
      const cached = this.fileManager.getSyncedFileInfo(filePath);
      if ((cached?.modelVersion ?? 0) >= expectedVersion) {
        return;
      }
      await sleep(4);
    }
    this.logger.debug(`⌛ Filesync wait timeout for ${filePath} at version ${expectedVersion}`);
  }
}
