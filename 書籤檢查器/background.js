// background.js

const ALARM_NAME = 'monthly-bookmark-check';
// 用來儲存正在進行的檢查請求
/**
 * 遞迴收集所有書籤
 */
function collectBookmarks(bookmarkNodes, bookmarksArray) {
  for (const node of bookmarkNodes) {
    if (node.url && (node.url.startsWith('http:') || node.url.startsWith('https:'))) {
      bookmarksArray.push(node);
    }
    if (node.children) {
      collectBookmarks(node.children, bookmarksArray);
    }
  }
}

/**
 * 執行書籤檢查的核心邏輯
 */
async function runBookmarkCheck() {
  console.log('開始執行背景書籤檢查...');
  const bookmarkTreeNodes = await chrome.bookmarks.getTree();
  const bookmarks = [];
  collectBookmarks(bookmarkTreeNodes, bookmarks);

  // 獲取並過濾白名單
  const data = await chrome.storage.local.get({ whitelist: {} });
  const now = Date.now();
  const activeWhitelist = Object.entries(data.whitelist)
    .filter(([url, expiry]) => expiry > now)
    .reduce((acc, [url, expiry]) => ({ ...acc, [url]: expiry }), {});

  let deadLinks = [];
  for (const bookmark of bookmarks) {
    // 如果書籤在有效的白名單中，則跳過檢查
    if (activeWhitelist[bookmark.url]) {
      continue;
    }

    try {
      // 使用快速的 HEAD 請求進行檢查
      await fetch(bookmark.url, { method: 'HEAD', mode: 'no-cors' });
    } catch (error) {
      // 發生網路錯誤，很有可能是失效連結
      console.log(`失效連結可能: ${bookmark.title} (${bookmark.url})`);
      deadLinks.push(bookmark);
    }
  }

  console.log(`背景檢查完成，發現 ${deadLinks.length} 個失效連結。`);

  if (deadLinks.length > 0) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '書籤檢查器發現失效連結',
      message: `發現 ${deadLinks.length} 個疑似失效的書籤，請點擊開啟擴充元件進行處理。`,
      priority: 2
    });
    // 也可以在圖示上顯示一個小紅點
    chrome.action.setBadgeText({ text: String(deadLinks.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#d9534f' });
  }
}

// 合併監聽來自 popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateAlarm') {
    if (request.isEnabled) {
      // 建立一個週期性鬧鐘，大約每 30 天觸發一次
      // 為了方便測試，可以將 periodInMinutes 設為 1
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: 1, // 1 分鐘後第一次觸發
        periodInMinutes: 30 * 24 * 60
      });
      console.log('Background: 已設定每月自動檢查鬧鐘。');
    } else {
      chrome.alarms.clear(ALARM_NAME);
      console.log('Background: 已取消自動檢查鬧鐘。');
    }
  }
});

// 監聽鬧鐘事件
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    runBookmarkCheck();
  }
});

// 監聽擴充元件安裝或更新事件，檢查是否需要設定鬧鐘
// 這裡我們只做日誌記錄或未來的初始化，鬧鐘的建立由 popup 的用戶操作觸發
chrome.runtime.onInstalled.addListener(() => {
  // 檢查鬧鐘狀態，確保在瀏覽器重啟後，如果設定為啟用，鬧鐘仍然存在。
  // 這是更穩健的做法，但目前的邏輯已將控制權交給用戶互動，所以此處可先簡化。
  console.log('書籤檢查器已安裝或更新。');
});

// 點擊通知時，打開 popup
chrome.notifications.onClicked.addListener(() => {
  // chrome.action.setBadgeText({ text: '' }); // 移除這行，避免在處理前就清除數字
  chrome.action.openPopup();
});

// 當擴充元件圖示被點擊時，清除小紅點
chrome.action.onClicked.addListener(() => {
  // 這個監聽器主要確保使用者直接點擊圖示時也能清除 badge
  // chrome.action.setBadgeText({ text: '' }); // 移除這行，將數字的控制權交給 popup
});