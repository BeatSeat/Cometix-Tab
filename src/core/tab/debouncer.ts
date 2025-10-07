import { randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';

import { Logger } from '../../utils/logger';
import type { TriggerTicket } from './types';

interface RequestRecord {
  generationUUID: string;
  startedAt: number;
  abortController: AbortController;
}

export class TabDebouncer {
  private readonly logger = Logger.getInstance();
  private clientDebounceDuration = 25;
  private globalDebounceDuration = 60;
  private readonly pruneWindow = 1000;

  private readonly activeRequests = new Map<string, RequestRecord>();
  private latestRequestStart = 0;
  private lastAllowedRequest = 0;

  runRequest(): TriggerTicket {
    const generationUUID = randomUUID();
    const startTime = Date.now();
    const abortController = new AbortController();

    this.activeRequests.set(generationUUID, { generationUUID, startedAt: startTime, abortController });
    this.latestRequestStart = Math.max(this.latestRequestStart, startTime);

    const requestIdsToCancel = Array.from(this.activeRequests.values())
      .filter(record => record.generationUUID !== generationUUID && startTime - record.startedAt <= this.pruneWindow)
      .map(record => record.generationUUID);

    return {
      generationUUID,
      startTime,
      abortController,
      requestIdsToCancel
    };
  }

  async shouldDebounce(generationUUID: string): Promise<boolean> {
    const record = this.activeRequests.get(generationUUID);
    if (!record) {
      return true;
    }

    const startTime = record.startedAt;
    let slept = false;

    const sinceLastAllowed = startTime - this.lastAllowedRequest;
    if (sinceLastAllowed < this.clientDebounceDuration) {
      const waitFor = this.clientDebounceDuration - sinceLastAllowed;
      this.logger.debug(`⏳ Client debounce wait ${waitFor}ms for request ${generationUUID}`);
      await sleep(waitFor);
      slept = true;
    }

    const globalSince = startTime - this.latestRequestStart;
    if (globalSince < this.globalDebounceDuration) {
      const waitFor = this.globalDebounceDuration - globalSince;
      this.logger.debug(`⏳ Global debounce wait ${waitFor}ms for request ${generationUUID}`);
      await sleep(waitFor);
      slept = true;
    }

    if (slept) {
      // 如果在等待期间出现了更新的请求，则取消当前请求
      if (this.latestRequestStart > startTime) {
        this.logger.debug(`🚫 Request ${generationUUID} debounced due to newer request`);
        return true;
      }
    }

    this.lastAllowedRequest = Date.now();
    return false;
  }

  cancelRequest(generationUUID: string): void {
    const record = this.activeRequests.get(generationUUID);
    if (!record) {
      return;
    }

    record.abortController.abort();
    this.activeRequests.delete(generationUUID);
  }

  finishRequest(generationUUID: string): void {
    this.activeRequests.delete(generationUUID);
    this.pruneOldRequests();
  }

  pruneOldRequests(): void {
    const now = Date.now();
    for (const [id, record] of this.activeRequests) {
      if (now - record.startedAt > this.pruneWindow) {
        this.activeRequests.delete(id);
      }
    }
  }

  setDebouncingDurations(options: { clientDebounceDuration?: number; globalDebounceDuration?: number }): void {
    if (typeof options.clientDebounceDuration === 'number') {
      this.clientDebounceDuration = Math.max(0, options.clientDebounceDuration);
    }
    if (typeof options.globalDebounceDuration === 'number') {
      this.globalDebounceDuration = Math.max(0, options.globalDebounceDuration);
    }
  }

  getAbortController(requestId: string): AbortController | undefined {
    return this.activeRequests.get(requestId)?.abortController;
  }
}
