import * as vscode from 'vscode';
import type { CompletionRequest, FileInfo } from '../../types';

export type TriggerSource =
  | 'Typing'
  | 'LineChange'
  | 'LinterErrors'
  | 'LspSuggestions'
  | 'ManualTrigger'
  | 'CursorPrediction'
  | 'ParameterHints'
  | 'EditorChange';

export interface TriggerTicket {
  generationUUID: string;
  startTime: number;
  abortController: AbortController;
  requestIdsToCancel: string[];
}

export interface RequestContext {
  document: vscode.TextDocument;
  position: vscode.Position;
  source: TriggerSource;
  token: vscode.CancellationToken;
  manual?: boolean;
}

export interface PreparedFileContext {
  fileInfo: FileInfo;
  relyOnFilesync: boolean;
  workspaceId: string;
  lineEnding: string;
}

export interface BuiltRequest {
  request: CompletionRequest;
  relyOnFilesync: boolean;
  workspaceId: string;
}

export interface StreamSuggestion {
  requestId: string;
  text: string;
  range: vscode.Range;
  bindingId?: string;
  modelInfoReceived: boolean;
  modelIdentifier?: string;
  cursorPosition?: { line: number; column: number };
}

export interface SuggestionRecord extends StreamSuggestion {
  createdAt: number;
  source: TriggerSource;
}

export type StatePhase =
  | 'Idle'
  | 'Debouncing'
  | 'Computing'
  | 'ShowingSuggestion'
  | 'Accepted'
  | 'Rejected';

export interface StateSnapshot {
  documentUri: string;
  phase: StatePhase;
  requestId?: string;
  lastTransitionAt: number;
}
