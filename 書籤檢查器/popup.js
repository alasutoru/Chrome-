document.addEventListener('DOMContentLoaded', function() {
  const checkButton = document.getElementById('checkButton');
  const resultsDiv = document.getElementById('results');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const deleteAllButton = document.getElementById('deleteAllButton');
  const resultsList = document.getElementById('results-list');
  const autoCheck = document.getElementById('autoCheck');
  const folderSelector = document.getElementById('folderSelector');
  const viewWhitelistButton = document.getElementById('viewWhitelistButton');
  let bookmarksFound = 0;
  let deadLinks = [];
  const ALARM_NAME = 'monthly-bookmark-check';

  // Popup 打開時，讀取設定並更新 checkbox
  // 同時檢查是否有待驗證的書籤
  chrome.storage.local.get(['autoCheckEnabled', 'pendingVerification'], (data) => {
    autoCheck.checked = !!data.autoCheckEnabled;

    if (data.pendingVerification) {
      // 如果有待驗證的書籤，直接顯示確認畫面
      showVerificationView(data.pendingVerification);
    } else {
      // 否則，填充資料夾下拉選單
      populateFolderSelector();
    }
  });

  // 監聽 checkbox 變化
  autoCheck.addEventListener('change', (event) => {
    const isEnabled = event.target.checked;
    // 將設定儲存起來
    chrome.storage.local.set({
      autoCheckEnabled: isEnabled
    });
    // 發送訊息給 background script 來更新鬧鐘狀態
    chrome.runtime.sendMessage({ action: 'updateAlarm', isEnabled: isEnabled });
  });

  viewWhitelistButton.addEventListener('click', showWhitelistView);

  checkButton.addEventListener('click', async function() {
    checkButton.disabled = true; // 禁用按鈕避免重複點擊
    deleteAllButton.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    progressBar.value = 0;
    progressLabel.textContent = '';
    resultsList.innerHTML = '<p>正在初始化...</p>';
    bookmarksFound = 0;
    deadLinks = [];

    const selectedFolderId = folderSelector.value;
    let nodesToScan;

    if (selectedFolderId === 'all') {
      nodesToScan = await chrome.bookmarks.getTree();
    } else {
      nodesToScan = await chrome.bookmarks.getSubTree(selectedFolderId);
    }

    const bookmarks = [];
    collectBookmarks(nodesToScan, bookmarks);
    progressBar.max = bookmarks.length;
    bookmarksFound = bookmarks.length;
    checkBookmarks(bookmarks);
  });

  // 使用事件委派統一處理列表中的所有點擊事件
  resultsList.addEventListener('click', function(event) {
    const deleteButton = event.target.closest('.delete-btn');
    const whitelistButton = event.target.closest('.whitelist-btn');
    const confirmValidButton = event.target.closest('.confirm-valid-btn');
    const confirmInvalidButton = event.target.closest('.confirm-invalid-btn');

    // 處理刪除按鈕點擊
    if (deleteButton) {
      const bookmarkId = deleteButton.dataset.id;
      removeBookmark(bookmarkId);
    } else if (whitelistButton) {
      // 1. 點擊 "手動檢查連結"
      event.preventDefault(); // 阻止連結立即跳轉
      const bookmarkId = whitelistButton.dataset.id;
      const url = whitelistButton.dataset.url;
      const title = whitelistButton.dataset.title;

      // 將待驗證的書籤資訊存入 storage
      chrome.storage.local.set({ pendingVerification: { id: bookmarkId, url: url, title: title } }, () => {
        // 在新分頁中打開連結供用戶檢查，然後關閉 popup
        chrome.tabs.create({ url: url }, () => window.close());
      });
    } else if (confirmValidButton) {
      // 2a. 確認連結有效 -> 加入白名單
      const url = confirmValidButton.dataset.url;
      const bookmarkId = confirmValidButton.dataset.id;
      chrome.storage.local.get({ whitelist: {} }, function(data) {
        const whitelist = data.whitelist;
        const expirationTime = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 天後過期
        whitelist[url] = expirationTime;
        chrome.storage.local.set({ whitelist: whitelist }, function() {
          console.log(`已將 ${url} 加入白名單，有效期 30 天。`);
          // 從 deadLinks 列表中移除，並更新所有狀態
          chrome.storage.local.get({ deadLinks: [] }, (data) => {
            const updatedDeadLinks = data.deadLinks.filter(link => link.id !== bookmarkId);
            // 在重載前，先根據更新後的列表更新圖示數字
            chrome.action.setBadgeText({ text: updatedDeadLinks.length > 0 ? String(updatedDeadLinks.length) : '' });
            chrome.storage.local.set({ deadLinks: updatedDeadLinks }, () => {
              chrome.storage.local.remove('pendingVerification', () => location.reload()); // 重新載入以更新視圖
            });
          });
        });
      });
    } else if (confirmInvalidButton) {
      // 2b. 確認連結失效 -> 刪除書籤
      const bookmarkId = confirmInvalidButton.dataset.id;
      removeBookmark(bookmarkId);
    }
  });

  deleteAllButton.addEventListener('click', async function() {
    if (deadLinks.length === 0) return;

    const confirmed = confirm(`確定要刪除這 ${deadLinks.length} 個失效書籤嗎？此操作無法復原。`);
    if (!confirmed) {
      return;
    }

    deleteAllButton.disabled = true;
    deleteAllButton.textContent = '正在刪除...';

    // 建立一個刪除 promises 陣列
    const deletionPromises = deadLinks.map(bookmark => chrome.bookmarks.remove(bookmark.id));

    try {
      await Promise.all(deletionPromises);
      // 清空存儲中的列表
      await chrome.storage.local.remove('deadLinks');
      resultsList.innerHTML = `<p>成功刪除 ${deadLinks.length} 個書籤。</p>`;
      deadLinks = [];
      chrome.action.setBadgeText({ text: '' }); // 清除圖示數字
      deleteAllButton.classList.add('hidden');
      updateSummary();
    } catch (error) {
      resultsList.innerHTML = `<p>刪除時發生錯誤，請重試。</p>`;
      console.error("刪除書籤時出錯:", error);
    }
  });

  /**
   * 刪除書籤並更新 UI
   * @param {string} bookmarkId 
   */
  function removeBookmark(bookmarkId) {
    chrome.bookmarks.remove(bookmarkId, function() {
      // 檢查是否是從確認介面刪除的
      chrome.storage.local.get('pendingVerification', ({ pendingVerification }) => {
        if (pendingVerification && pendingVerification.id === bookmarkId) {
          // 如果是，清除待驗證狀態並重新載入
          chrome.storage.local.remove(['pendingVerification', 'deadLinks'], () => {
            location.reload();
          });
        } else {
          // 否則，只是從列表中移除
          const itemToRemove = document.getElementById(`bookmark-${bookmarkId}`);
          if (itemToRemove) {
            itemToRemove.remove();
          }
          // 從存儲和當前陣列中都移除
          deadLinks = deadLinks.filter(bookmark => bookmark.id !== bookmarkId);
          chrome.storage.local.set({ deadLinks: deadLinks });
          updateSummary();
          chrome.action.setBadgeText({ text: deadLinks.length > 0 ? String(deadLinks.length) : '' });
          if (deadLinks.length === 0) deleteAllButton.classList.add('hidden');
        }
      });
    });
  }

  /**
   * 顯示待驗證書籤的確認畫面
   * @param {object} bookmark - 待驗證的書籤物件 {id, url, title}
   */
  function showVerificationView(bookmark) {
    // 隱藏主介面元素
    checkButton.classList.add('hidden');
    progressContainer.classList.add('hidden');
    deleteAllButton.classList.add('hidden');
    document.querySelector('.folder-selector-container').classList.add('hidden');
    document.querySelector('.settings-container').classList.add('hidden');

    const safeTitle = bookmark.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    resultsList.innerHTML = `
      <p>您正在檢查以下書籤：</p>
      <p><strong>${safeTitle}</strong></p>
      <p>連結是否有效？</p>
      <button class="confirm-btn confirm-valid-btn" data-id="${bookmark.id}" data-url="${bookmark.url}" title="有效，加入白名單">✅ 是，連結有效</button>
      <button class="confirm-btn confirm-invalid-btn" data-id="${bookmark.id}" title="失效，立即刪除">🗑️ 否，連結失效</button>
    `;
  }

  /**
   * 填充資料夾選擇下拉選單
   */
  async function populateFolderSelector() {
    folderSelector.innerHTML = '<option value="all">所有書籤</option>';
    const bookmarkTree = await chrome.bookmarks.getTree();

    function addFoldersToSelector(nodes, level) {
      for (const node of nodes) {
        // 判斷是否為資料夾的正確方式是檢查它有沒有 url 屬性
        if (!node.url) {
          const option = document.createElement('option');
          option.value = node.id;
          // 使用全形空格進行縮排，效果比半形好
          option.textContent = '　'.repeat(level) + (node.title || '未命名資料夾');
          folderSelector.appendChild(option);
          // 遞迴處理子資料夾
          if (node.children) {
            addFoldersToSelector(node.children, level + 1);
          }
        }
      }
    }

    // 從根節點的子節點開始（通常是 "書籤列", "其他書籤", "行動裝置書籤"）
    if (bookmarkTree[0] && bookmarkTree[0].children) {
      addFoldersToSelector(bookmarkTree[0].children, 0);
    }
  }
  /**
   * 顯示白名單列表的視圖
   */
  async function showWhitelistView() {
    progressContainer.classList.add('hidden');
    deleteAllButton.classList.add('hidden');
    resultsList.innerHTML = '<p>正在讀取白名單...</p>';

    const data = await chrome.storage.local.get({ whitelist: {} });
    const now = Date.now();
    const whitelist = data.whitelist;

    let html = '<h2>白名單中的網站</h2>';
    const activeEntries = Object.entries(whitelist).filter(([, expiry]) => expiry > now);

    if (activeEntries.length > 0) {
      html += '<ul>';
      activeEntries.forEach(([url, expiry]) => {
        const safeUrl = url.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const expiryDate = new Date(expiry).toLocaleDateString();
        html += `<li id="whitelist-${btoa(url)}">
                   <a class="bookmark-link" href="${url}" target="_blank" title="${safeUrl}">${safeUrl}</a>
                   <span class="controls">
                     <span class="expiry-date">重新檢查日: ${expiryDate}</span>
                     <button class="delete-whitelist-btn" data-url="${url}" title="從白名單中移除">❌</button>
                   </span>
                 </li>`;
      });
      html += '</ul>';
    } else {
      html += '<p>目前沒有網站被加入白名單。</p>';
    }
    resultsList.innerHTML = html;

    // 為白名單的刪除按鈕添加事件監聽
    document.querySelectorAll('.delete-whitelist-btn').forEach(button => {
      button.addEventListener('click', handleRemoveFromWhitelist);
    });
  }

  /**
   * 處理從白名單中移除的事件
   * @param {MouseEvent} event 
   */
  function handleRemoveFromWhitelist(event) {
    const urlToRemove = event.target.dataset.url;
    chrome.storage.local.get({ whitelist: {} }, function(data) {
      const whitelist = data.whitelist;
      delete whitelist[urlToRemove];
      chrome.storage.local.set({ whitelist: whitelist }, function() {
        console.log(`已從白名單中移除 ${urlToRemove}`);
        const itemToRemove = document.getElementById(`whitelist-${btoa(urlToRemove)}`);
        if (itemToRemove) itemToRemove.remove();
      });
    });
  }

  /**
   * 遞迴收集所有書籤
   * @param {chrome.bookmarks.BookmarkTreeNode[]} bookmarkNodes 
   * @param {chrome.bookmarks.BookmarkTreeNode[]} bookmarksArray 
   */
  function collectBookmarks(bookmarkNodes, bookmarksArray) {
    for (const node of bookmarkNodes) {
      // 如果有 url 且是 http/https 協議，表示這是一個書籤
      // 避免檢查 chrome://, file:// 等內部連結
      if (node.url && (node.url.startsWith('http:') || node.url.startsWith('https:'))) {
        bookmarksArray.push(node);
      }
      // 如果有子節點，就遞迴下去
      if (node.children) {
        collectBookmarks(node.children, bookmarksArray);
      }
    }
  }

  /**
   * 檢查所有書籤的有效性
   * @param {chrome.bookmarks.BookmarkTreeNode[]} bookmarks 
   */
  async function checkBookmarks(bookmarks) {
    let checkedCount = 0;
    const totalBookmarks = bookmarks.length;

    // 1. 從存儲中獲取白名單
    const data = await chrome.storage.local.get({ whitelist: {} });
    const now = Date.now();
    // 過濾掉過期的白名單項目
    const activeWhitelist = Object.entries(data.whitelist)
      .filter(([url, expiry]) => expiry > now)
      .reduce((acc, [url, expiry]) => ({ ...acc, [url]: expiry }), {});
    
    // 更新存儲，移除過期項目 (可選，保持存儲乾淨)
    await chrome.storage.local.set({ whitelist: activeWhitelist });

    for (const bookmark of bookmarks) {
      // 2. 如果書籤在有效的白名單中，則跳過檢查
      if (activeWhitelist[bookmark.url]) {
        checkedCount++;
        progressBar.value = checkedCount;
        continue;
      }

      try {
        // 直接使用 fetch 進行快速檢查
        // 我們不關心成功的 response，只捕捉錯誤
        await fetch(bookmark.url, { method: 'HEAD', mode: 'no-cors' });
      } catch (error) {
        console.log(`失效連結可能: ${bookmark.title} (${bookmark.url})`, error);
        deadLinks.push(bookmark);
      }
      checkedCount++;
      progressBar.value = checkedCount;
      progressLabel.textContent = `正在檢查... (${checkedCount} / ${totalBookmarks})`;
    }

    displayResults();
  }

  function updateSummary() {
    const summaryEl = document.getElementById('summary');
    if (!summaryEl) return;

    if (bookmarksFound === -1) { // 從存儲加載的結果
      summaryEl.innerHTML = `發現 ${deadLinks.length} 個上次未處理的失效連結：`;
    } else { // 正常掃描的結果
      summaryEl.innerHTML = `檢查完成！共掃描 ${bookmarksFound} 個書籤。<br>發現 ${deadLinks.length} 個疑似失效的連結：`;
    }
  }

  function displayResults() {
    progressContainer.classList.add('hidden'); // 隱藏進度條
    // 隱藏初始介面元素
    document.querySelector('.folder-selector-container').classList.add('hidden');
    document.querySelector('.settings-container').classList.add('hidden');
    checkButton.textContent = '重新掃描'; // 更新按鈕文字

    let html = `<p id="summary">檢查完成！共掃描 ${bookmarksFound} 個書籤。<br>`;
    if (deadLinks.length > 0) {
      deleteAllButton.classList.remove('hidden');
      // 在圖示上顯示失效連結的數量
      chrome.action.setBadgeText({ text: String(deadLinks.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#d9534f' });
      // 將結果存入 storage
      chrome.storage.local.set({ deadLinks: deadLinks });

      html = `<p id="summary">發現 ${deadLinks.length} 個疑似失效的連結：</p><ul>`;
      deadLinks.forEach(bookmark => {
        // 對 title 和 url 進行 HTML 編碼，避免 XSS 風險
        const safeTitle = bookmark.title.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const safeUrl = bookmark.url.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        // 為 li 元素加上 id，方便刪除後從 DOM 移除
        // 為刪除按鈕加上 data-id 屬性來儲存書籤 id
        html += `<li id="bookmark-${bookmark.id}">
                   <a class="bookmark-link" href="${bookmark.url}" target="_blank" title="${safeUrl}">${safeTitle}</a>
                   <span class="controls">
                     <a href="${bookmark.url}" target="_blank" class="whitelist-btn" data-id="${bookmark.id}" data-url="${bookmark.url}" data-title="${safeTitle}" title="手動檢查並加入白名單">
                       <span class="whitelist-text">手動檢查連結</span>🔗
                     </a>
                     <button class="delete-btn" data-id="${bookmark.id}" title="刪除此書籤">❌</button></span>
                 </li>`;
      });
      html += '</ul>';
    } else {
      html += '所有書籤看起來都正常！</p>';
      // 沒有失效連結，清除圖示數字和存儲
      chrome.action.setBadgeText({ text: '' });
      chrome.storage.local.remove('deadLinks');
      deleteAllButton.classList.add('hidden');
    }
    resultsList.innerHTML = html;
    updateSummary(); // 更新摘要文字

    checkButton.disabled = false;
    deleteAllButton.disabled = false;
    deleteAllButton.textContent = '全部刪除失效連結';
  }
});