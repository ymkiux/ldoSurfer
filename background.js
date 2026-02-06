const DAILY_AUTO_KEY = 'linuxDoDailyAuto';
const DEFAULT_DAILY_AUTO = {
  enabled: true,
  target: 50,
  time: '09:00',
  endTime: '19:00',
  date: '',
  count: 0,
  running: false
};
const DAILY_ALARM_NAME = 'linux-do-daily-auto';

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

async function runDailyAuto() {
  const config = await loadDailyAuto();
  if (!config.enabled) return;

  const today = getTodayString();
  config.date = today;
  config.count = 0;
  config.running = true;
  await saveDailyAuto(config);

  const baseUrl = await getBaseUrl();
  chrome.tabs.create({ url: `${baseUrl}/latest` }, async (tab) => {
    if (!tab?.id) return;
    await waitForTabComplete(tab.id);
    sendStartDailyMessage(tab.id, {
      action: 'startDaily',
      target: config.target,
      date: config.date
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await loadDailyAuto();
  await saveDailyAuto(config);
  scheduleDailyAlarm(config);
});

chrome.runtime.onStartup.addListener(async () => {
  const config = await loadDailyAuto();
  await saveDailyAuto(config);
  scheduleDailyAlarm(config);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DAILY_ALARM_NAME) return;
  runDailyAuto();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes[DAILY_AUTO_KEY]) return;
  scheduleDailyAlarm(changes[DAILY_AUTO_KEY].newValue);
});
