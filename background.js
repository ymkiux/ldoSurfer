const DAILY_AUTO_KEY = 'linuxDoDailyAuto';
const DAILY_PENDING_KEY = 'linuxDoDailyAutoPending';
const SITE_ACTIVITY_KEY = 'linuxDoSiteActivity';
const DEFAULT_DAILY_AUTO = {
  enabled: true,
  target: 50,
  time: '09:00',
  endTime: '19:00',
  date: '',
  count: 0,
  running: false,
  requireHidden: true
};
const DAILY_ALARM_NAME = 'linux-do-daily-auto';
const DAILY_PENDING_ALARM_NAME = 'linux-do-daily-auto-pending';
const INVITES_URL_REGEX = /^https:\/\/connect\.linux\.do\/dash\/invites(?:[/?#].*)?$/;
const CONNECT_URL_REGEX = /^https:\/\/connect\.(linux\.do|idcflare\.com)(\/|$)/;
const CONNECT_DEFAULT_BASE = 'https://connect.linux.do';
const SITE_URL_REGEX = /^https:\/\/(linux\.do|idcflare\.com)(\/|$)/;
const SITE_BACKGROUND_WAIT_MS = 10 * 60 * 1000;
const SITE_ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

function safeStorageGet(keys) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve({});
      return;
    }
    try {
      chrome.storage.local.get(keys, (result) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Background] storage.get failed', lastError.message);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    } catch (error) {
      console.warn('[Background] storage.get threw', error);
      resolve({});
    }
  });
}

function safeStorageSet(payload) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set(payload, () => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Background] storage.set failed', lastError.message);
        }
        resolve();
      });
    } catch (error) {
      console.warn('[Background] storage.set threw', error);
      resolve();
    }
  });
}

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDailyTime(time) {
  if (!time || typeof time !== 'string') return { hour: 9, minute: 0, valid: false };
  const parts = time.split(':');
  if (parts.length !== 2) return { hour: 9, minute: 0, valid: false };
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: 9, minute: 0, valid: false };
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 9, minute: 0, valid: false };
  return { hour, minute, valid: true };
}

function formatDailyTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeDailyTime(time) {
  const parsed = parseDailyTime(time);
  return formatDailyTime(parsed.hour, parsed.minute);
}

function defaultDailyEndTime(startTime) {
  const parsed = parseDailyTime(startTime);
  const totalMinutes = parsed.hour * 60 + parsed.minute + 600;
  const normalizedMinutes = totalMinutes % (24 * 60);
  return formatDailyTime(Math.floor(normalizedMinutes / 60), normalizedMinutes % 60);
}

function getNextRunTime(time) {
  const now = new Date();
  const next = new Date(now);
  const { hour, minute } = parseDailyTime(time);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function normalizeDailyAuto(raw) {
  const today = getTodayString();
  const config = { ...DEFAULT_DAILY_AUTO, ...(raw || {}) };
  config.time = normalizeDailyTime(config.time);
  config.endTime = defaultDailyEndTime(config.time);
  config.requireHidden = config.requireHidden === true;
  if (config.date !== today) {
    config.date = today;
    config.count = 0;
    config.running = false;
  }
  if (!config.target || config.target < 1) {
    config.target = DEFAULT_DAILY_AUTO.target;
  }
  return config;
}

function loadDailyAuto() {
  return safeStorageGet([DAILY_AUTO_KEY]).then((result) => {
    return normalizeDailyAuto(result[DAILY_AUTO_KEY]);
  });
}

function saveDailyAuto(config) {
  return safeStorageSet({ [DAILY_AUTO_KEY]: config });
}

function normalizeSiteActivity(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const rawTabs = base.tabs && typeof base.tabs === 'object' ? base.tabs : {};
  const tabs = {};
  Object.keys(rawTabs).forEach((tabId) => {
    const entry = rawTabs[tabId];
    if (!entry || typeof entry !== 'object') return;
    tabs[tabId] = {
      visible: entry.visible === true,
      lastVisibleAt: Number.isFinite(entry.lastVisibleAt) ? entry.lastVisibleAt : 0,
      lastHiddenAt: Number.isFinite(entry.lastHiddenAt) ? entry.lastHiddenAt : 0,
      lastActivityAt: Number.isFinite(entry.lastActivityAt) ? entry.lastActivityAt : 0,
      lastSeenAt: Number.isFinite(entry.lastSeenAt) ? entry.lastSeenAt : 0
    };
  });
  return { tabs };
}

function loadSiteActivity() {
  return safeStorageGet([SITE_ACTIVITY_KEY]).then((result) => {
    return normalizeSiteActivity(result[SITE_ACTIVITY_KEY]);
  });
}

function saveSiteActivity(activity) {
  return safeStorageSet({ [SITE_ACTIVITY_KEY]: activity });
}

function pruneSiteActivity(activity, now) {
  const tabs = activity.tabs || {};
  Object.keys(tabs).forEach((tabId) => {
    const entry = tabs[tabId];
    const lastSeenAt = Number.isFinite(entry?.lastSeenAt) ? entry.lastSeenAt : 0;
    if (!lastSeenAt || now - lastSeenAt > SITE_ACTIVITY_TTL_MS) {
      delete tabs[tabId];
    }
  });
}

function updateTabEntry(activity, tabId, patch) {
  const tabs = activity.tabs || (activity.tabs = {});
  const key = String(tabId);
  const now = Number.isFinite(patch?.at) ? patch.at : Date.now();
  const entry = tabs[key] || {
    visible: false,
    lastVisibleAt: 0,
    lastHiddenAt: 0,
    lastActivityAt: 0,
    lastSeenAt: 0
  };
  if (typeof patch?.visible === 'boolean') {
    entry.visible = patch.visible;
    if (patch.visible) {
      entry.lastVisibleAt = now;
    } else {
      entry.lastHiddenAt = now;
    }
  }
  if (Number.isFinite(patch?.activityAt)) {
    entry.lastActivityAt = patch.activityAt;
  }
  entry.lastSeenAt = now;
  tabs[key] = entry;
}

async function recordTabVisibility(tabId, visible, at) {
  const now = Number.isFinite(at) ? at : Date.now();
  const activity = await loadSiteActivity();
  pruneSiteActivity(activity, now);
  updateTabEntry(activity, tabId, { visible, at: now, activityAt: visible ? now : undefined });
  await saveSiteActivity(activity);
}

async function recordTabActivity(tabId, at) {
  const now = Number.isFinite(at) ? at : Date.now();
  const activity = await loadSiteActivity();
  pruneSiteActivity(activity, now);
  updateTabEntry(activity, tabId, { activityAt: now, at: now });
  await saveSiteActivity(activity);
}

function getSiteBackgroundInfo(activity, now) {
  const entries = Object.values(activity.tabs || {});
  let anyVisible = false;
  let lastVisibleAt = 0;
  let lastActivityAt = 0;
  let lastSeenAt = 0;
  entries.forEach((entry) => {
    if (entry.visible) anyVisible = true;
    if (entry.lastVisibleAt > lastVisibleAt) lastVisibleAt = entry.lastVisibleAt;
    if (entry.lastActivityAt > lastActivityAt) lastActivityAt = entry.lastActivityAt;
    if (entry.lastSeenAt > lastSeenAt) lastSeenAt = entry.lastSeenAt;
  });
  if (anyVisible) {
    return { ready: false, readyAt: now + SITE_BACKGROUND_WAIT_MS, reason: 'visible' };
  }
  if (!entries.length) {
    return { ready: false, readyAt: now + SITE_BACKGROUND_WAIT_MS, reason: 'noData' };
  }
  const lastInteractiveAt = Math.max(lastVisibleAt, lastActivityAt, lastSeenAt);
  if (!lastInteractiveAt) {
    return { ready: false, readyAt: now + SITE_BACKGROUND_WAIT_MS, reason: 'noData' };
  }
  const readyAt = lastInteractiveAt + SITE_BACKGROUND_WAIT_MS;
  return { ready: now >= readyAt, readyAt, reason: now >= readyAt ? 'ready' : 'recentActivity' };
}

function normalizeDailyPending(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    pending: base.pending === true,
    requestedAt: Number.isFinite(base.requestedAt) ? base.requestedAt : 0
  };
}

function loadDailyPending() {
  return safeStorageGet([DAILY_PENDING_KEY]).then((result) => {
    return normalizeDailyPending(result[DAILY_PENDING_KEY]);
  });
}

function saveDailyPending(pending) {
  return safeStorageSet({ [DAILY_PENDING_KEY]: pending });
}

function clearDailyPending() {
  if (chrome?.alarms?.clear) {
    chrome.alarms.clear(DAILY_PENDING_ALARM_NAME);
  }
  return saveDailyPending({ pending: false, requestedAt: 0 });
}

function schedulePendingAlarm(whenMs) {
  if (!chrome?.alarms?.create) return;
  if (!Number.isFinite(whenMs)) return;
  const now = Date.now();
  const when = Math.max(whenMs, now + 1000);
  chrome.alarms.create(DAILY_PENDING_ALARM_NAME, { when });
}

function runSafeTask(task, label) {
  Promise.resolve()
    .then(() => task())
    .catch((error) => {
      console.warn(`[Background] ${label} failed`, error);
    });
}

function getBaseUrl() {
  return safeStorageGet(['useIdcflareSite']).then((result) => {
    const useIdcflare = result.useIdcflareSite || false;
    return useIdcflare ? 'https://idcflare.com' : 'https://linux.do';
  });
}

function scheduleDailyAlarm(config) {
  const time = config?.time || DEFAULT_DAILY_AUTO.time;
  chrome.alarms.create(DAILY_ALARM_NAME, {
    when: getNextRunTime(time),
    periodInMinutes: 24 * 60
  });
}

function sendStartDailyMessage(tabId, payload, retries = 10) {
  try {
    chrome.tabs.sendMessage(tabId, payload, () => {
      if (chrome.runtime.lastError) {
        if (retries > 0) {
          setTimeout(() => sendStartDailyMessage(tabId, payload, retries - 1), 1000);
        } else {
          console.warn('[Background] sendMessage failed', chrome.runtime.lastError.message);
        }
        return;
      }
    });
  } catch (error) {
    if (retries > 0) {
      setTimeout(() => sendStartDailyMessage(tabId, payload, retries - 1), 1000);
    } else {
      console.warn('[Background] sendMessage threw', error);
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function isAllowedInvitesUrl(url) {
  return typeof url === 'string' && INVITES_URL_REGEX.test(url);
}

function isAllowedConnectUrl(url) {
  return typeof url === 'string' && CONNECT_URL_REGEX.test(url);
}

function isTargetSiteUrl(url) {
  return typeof url === 'string' && SITE_URL_REGEX.test(url);
}

function safeTabsQuery(queryInfo) {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.query) {
      resolve([]);
      return;
    }
    try {
      chrome.tabs.query(queryInfo, (tabs) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Background] tabs.query failed', lastError.message);
          resolve([]);
          return;
        }
        resolve(tabs || []);
      });
    } catch (error) {
      console.warn('[Background] tabs.query threw', error);
      resolve([]);
    }
  });
}

function safeTabsCreate(createProperties) {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.create) {
      resolve(null);
      return;
    }
    try {
      chrome.tabs.create(createProperties, (tab) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Background] tabs.create failed', lastError.message);
          resolve(null);
          return;
        }
        resolve(tab || null);
      });
    } catch (error) {
      console.warn('[Background] tabs.create threw', error);
      resolve(null);
    }
  });
}

function safeTabsRemove(tabId) {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.remove || !Number.isFinite(tabId)) {
      resolve(false);
      return;
    }
    try {
      chrome.tabs.remove(tabId, () => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Background] tabs.remove failed', lastError.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (error) {
      console.warn('[Background] tabs.remove threw', error);
      resolve(false);
    }
  });
}

function safeTabsSendMessage(tabId, message) {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.sendMessage || !Number.isFinite(tabId)) {
      resolve({ ok: false, error: 'tabs.sendMessage unavailable' });
      return;
    }
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          resolve({ ok: false, error: lastError.message });
          return;
        }
        resolve({ ok: true, response });
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message || 'Unknown error' });
    }
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeConnectBaseUrl(input) {
  if (typeof input === 'string') {
    if (/connect\.idcflare\.com/.test(input)) return 'https://connect.idcflare.com';
    if (/connect\.linux\.do/.test(input)) return 'https://connect.linux.do';
  }
  return CONNECT_DEFAULT_BASE;
}

function buildConnectHomeUrl(baseUrl) {
  const clean = String(baseUrl || '').replace(/\/+$/, '');
  return `${clean}/`;
}

function buildConnectUrlPattern(baseUrl) {
  const clean = String(baseUrl || '').replace(/\/+$/, '');
  return `${clean}/*`;
}

async function findConnectHomeTab(baseUrl) {
  const tabs = await safeTabsQuery({ url: buildConnectUrlPattern(baseUrl) });
  return tabs.find((tab) => isAllowedConnectUrl(tab?.url || tab?.pendingUrl)) || null;
}

async function createConnectHomeTab(baseUrl) {
  return safeTabsCreate({ url: buildConnectHomeUrl(baseUrl), active: false });
}

async function requestConnectSummaryFromTab(tab) {
  const tabId = tab?.id;
  if (!Number.isFinite(tabId)) {
    return { ok: false, error: 'Invalid connect tab' };
  }
  if (tab.status !== 'complete') {
    await Promise.race([waitForTabComplete(tabId), delay(8000)]);
  }
  const message = { source: 'background', type: 'getConnectSummary' };
  const tries = [1, 2];
  let lastError = '';
  for (const tryNo of tries) {
    const result = await safeTabsSendMessage(tabId, message);
    if (result.ok && result.response?.ok) {
      return { ok: true, data: result.response.data };
    }
    if (result.ok && result.response && result.response.ok === false) {
      lastError = result.response.error || 'Connect summary failed';
    } else {
      lastError = result.error || 'Connect summary failed';
    }
    if (/Receiving end does not exist|message port closed/i.test(lastError) && tryNo < tries.length) {
      await delay(300);
      continue;
    }
    break;
  }
  return { ok: false, error: lastError || 'Connect summary failed' };
}

async function fetchConnectSummaryByBackground(connectBaseUrl) {
  const baseUrl = normalizeConnectBaseUrl(connectBaseUrl);
  let lastError = '';
  const existingTab = await findConnectHomeTab(baseUrl);
  if (existingTab) {
    const result = await requestConnectSummaryFromTab(existingTab);
    if (result.ok) return result.data;
    lastError = result.error || lastError;
  }

  const createdTab = await createConnectHomeTab(baseUrl);
  const createdTabId = createdTab?.id;
  try {
    if (!Number.isFinite(createdTabId)) {
      throw new Error(lastError || 'Unable to open connect tab');
    }
    const result = await requestConnectSummaryFromTab(createdTab);
    if (result.ok) return result.data;
    throw new Error(result.error || lastError || 'Connect summary failed');
  } finally {
    if (Number.isFinite(createdTabId)) {
      await safeTabsRemove(createdTabId);
    }
  }
}

async function fetchInvitesHtmlByBackground(url) {
  if (!isAllowedInvitesUrl(url)) {
    throw new Error('Invalid invites url');
  }

  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchConnectHtmlByBackground(url) {
  if (!isAllowedConnectUrl(url)) {
    throw new Error('Invalid connect url');
  }

  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function runDailyAuto() {
  const config = await loadDailyAuto();
  if (!config.enabled) {
    await clearDailyPending();
    return;
  }
  if (config.running) {
    await clearDailyPending();
    return;
  }
  const now = Date.now();
  const today = getTodayString();
  config.date = today;
  config.count = 0;
  config.time = normalizeDailyTime(config.time);
  config.endTime = defaultDailyEndTime(config.time);
  config.requireHidden = config.requireHidden === true;

  if (config.requireHidden) {
    const pending = await loadDailyPending();
    const activity = await loadSiteActivity();
    pruneSiteActivity(activity, now);
    const backgroundInfo = getSiteBackgroundInfo(activity, now);
    let ready = backgroundInfo.ready;
    let readyAt = backgroundInfo.readyAt;
    if (!ready && backgroundInfo.reason === 'noData' && pending.pending && pending.requestedAt) {
      const noDataReadyAt = pending.requestedAt + SITE_BACKGROUND_WAIT_MS;
      if (now >= noDataReadyAt) {
        ready = true;
      } else {
        readyAt = noDataReadyAt;
      }
    }
    if (!ready) {
      if (!pending.pending || !pending.requestedAt) {
        await saveDailyPending({ pending: true, requestedAt: now });
      }
      if (Number.isFinite(readyAt)) {
        schedulePendingAlarm(readyAt);
      }
      return;
    }
  }

  await clearDailyPending();
  config.running = true;
  await saveDailyAuto(config);

  const baseUrl = await getBaseUrl();
  chrome.tabs.create({ url: `${baseUrl}/latest`, active: config.requireHidden !== true }, (tab) => {
    runSafeTask(async () => {
      if (!tab?.id) return;
      await waitForTabComplete(tab.id);
      sendStartDailyMessage(tab.id, {
        action: 'startDaily',
        target: config.target,
        date: config.date,
        skipIdleWait: config.requireHidden === true
      });
    }, 'tabs.create callback');
  });
}

async function runPendingDailyAuto() {
  const pending = await loadDailyPending();
  if (!pending.pending) return;
  await runDailyAuto();
}

async function handleContentMessage(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) return;
  const tabUrl = sender?.tab?.url;
  if (!isTargetSiteUrl(tabUrl)) return;
  if (message.type === 'siteVisibility') {
    await recordTabVisibility(tabId, message.visible === true, Number(message.at));
    await runPendingDailyAuto();
    return;
  }
  if (message.type === 'siteActivity') {
    await recordTabActivity(tabId, Number(message.at));
  }
}

async function removeTabActivity(tabId) {
  const activity = await loadSiteActivity();
  const key = String(tabId);
  if (activity.tabs && activity.tabs[key]) {
    delete activity.tabs[key];
    await saveSiteActivity(activity);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  runSafeTask(async () => {
    const config = await loadDailyAuto();
    await saveDailyAuto(config);
    scheduleDailyAlarm(config);
  }, 'onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  runSafeTask(async () => {
    const config = await loadDailyAuto();
    await saveDailyAuto(config);
    scheduleDailyAlarm(config);
  }, 'onStartup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DAILY_ALARM_NAME) return;
  runSafeTask(() => runDailyAuto(), 'onAlarm');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DAILY_PENDING_ALARM_NAME) return;
  runSafeTask(() => runPendingDailyAuto(), 'onPendingAlarm');
});

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    runSafeTask(() => removeTabActivity(tabId), 'tabs.onRemoved');
  });
}

if (chrome?.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo?.url) return;
    if (isTargetSiteUrl(changeInfo.url)) return;
    runSafeTask(() => removeTabActivity(tabId), 'tabs.onUpdated');
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === 'content') {
    runSafeTask(() => handleContentMessage(message, sender), 'contentMessage');
    return false;
  }
  if (!message || message.source !== 'popup') {
    return false;
  }

  if (message.type === 'fetchInvitesHtml') {
    fetchInvitesHtmlByBackground(message.url)
      .then((html) => {
        sendResponse({ ok: true, html });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || 'Unknown error' });
      });
    return true;
  }

  if (message.type === 'getConnectSummary') {
    fetchConnectSummaryByBackground(message.connectBaseUrl)
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || 'Unknown error' });
      });
    return true;
  }

  if (message.type === 'fetchConnectHtml') {
    fetchConnectHtmlByBackground(message.url)
      .then((html) => {
        sendResponse({ ok: true, html });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || 'Unknown error' });
      });
    return true;
  }

  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  runSafeTask(() => {
    if (area !== 'local') return;
    if (!changes[DAILY_AUTO_KEY]) return;
    scheduleDailyAlarm(changes[DAILY_AUTO_KEY].newValue);
  }, 'storage.onChanged');
});






