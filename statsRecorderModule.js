/**
 * 统计记录模块 - 内容脚本版本
 * 供 content.js 直接使用
 */

// ============== statsStorage.js ==============
class StatsStorage {
  static STORAGE_KEY = 'linuxDoStats';
  static DATA_VERSION = 1;
  static RETENTION_DAYS = 30;

  static async get() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve(this._createEmpty());
        return;
      }
      try {
        chrome.storage.local.get(this.STORAGE_KEY, (result) => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            resolve(this._createEmpty());
            return;
          }
          const data = result[this.STORAGE_KEY] || this._createEmpty();
          resolve(data);
        });
      } catch (error) {
        resolve(this._createEmpty());
      }
    });
  }

  static async set(data) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set({ [this.STORAGE_KEY]: data }, () => {
          resolve();
        });
      } catch (error) {
        resolve();
      }
    });
  }

  static _createEmpty() {
    return {
      version: this.DATA_VERSION,
      days: {},
      lastPruneAt: Date.now()
    };
  }

  static async record(event) {
    const data = await this.get();
    const now = new Date();
    const dateKey = this._getDateKey(now);
    const hourKey = now.getHours().toString();

    if (!data.days[dateKey]) {
      data.days[dateKey] = {
        totals: { posts: 0, durationMs: 0, errors: 0 },
        hours: {},
        updatedAt: now.getTime()
      };
    }

    const day = data.days[dateKey];

    if (!day.hours[hourKey]) {
      day.hours[hourKey] = { posts: 0, durationMs: 0, errors: 0 };
    }

    day.hours[hourKey].posts += event.posts;
    day.hours[hourKey].durationMs += event.durationMs;
    if (event.hasError) {
      day.hours[hourKey].errors += 1;
    }

    day.totals.posts += event.posts;
    day.totals.durationMs += event.durationMs;
    if (event.hasError) {
      day.totals.errors += 1;
    }

    day.updatedAt = now.getTime();

    const shouldPrune = !data.lastPruneAt || (now.getTime() - data.lastPruneAt > 86400000);
    if (shouldPrune) {
      this._pruneOldDays(data);
      data.lastPruneAt = now.getTime();
    }

    await this.set(data);
  }

  static _pruneOldDays(data) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);
    const cutoffKey = this._getDateKey(cutoffDate);

    for (const dateKey in data.days) {
      if (dateKey < cutoffKey) {
        delete data.days[dateKey];
      }
    }
  }

  static _getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// ============== statsRecorder.js ==============
class StatsRecorder {
  static async record(options = {}) {
    const { posts = 1, durationMs = 0, hasError = false } = options;
    await StatsStorage.record({ posts, durationMs, hasError });
  }

  static async recordPost(durationMs = 0) {
    await this.record({ posts: 1, durationMs, hasError: false });
  }

  static async recordError() {
    await this.record({ posts: 0, durationMs: 0, hasError: true });
  }
}

window.StatsRecorder = StatsRecorder;
