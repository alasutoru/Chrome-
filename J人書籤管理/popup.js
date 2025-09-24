document.addEventListener('DOMContentLoaded', async () => {
  const searchBox = document.getElementById('search-box');
  const tagsContainer = document.getElementById('tags-container');
  const bookmarksDiv = document.getElementById('bookmarks');
  const openManagerBtn = document.getElementById('open-manager-btn');

  let allBookmarks = [];

  // 1. 獲取所有書籤和元數據
  // This function now also needs to get the global tag configuration
  async function loadData() {
    const bookmarkTree = await chrome.bookmarks.getTree();
    const allMetadata = await chrome.storage.sync.get(null);
    
    const bookmarks = [];
    const uniqueTags = new Set();

    // 遞迴函數來扁平化書籤樹
    function flattenBookmarks(nodes) {
      for (const node of nodes) {
        if (node.url) { // 這是書籤
          const metadata = allMetadata[node.id] || {};
          const bookmarkData = {
            id: node.id,
            title: node.title,
            url: node.url,
            tags: metadata.tags || [],
            notes: metadata.notes || ''
          };
          bookmarks.push(bookmarkData);
          (metadata.tags || []).forEach(tag => uniqueTags.add(tag));
        }
        if (node.children) { // 這是資料夾
          flattenBookmarks(node.children);
        }
      }
    }

    flattenBookmarks(bookmarkTree);
    allBookmarks = bookmarks;
    // Get global tag colors
    const tagConfigResult = await chrome.storage.sync.get('_globalTagsConfig');
    const globalTags = tagConfigResult._globalTagsConfig || [];

    renderTags(globalTags);
  }

  // 2. 渲染標籤雲
  function renderTags(globalTags) {
    tagsContainer.innerHTML = '';
    globalTags.sort((a, b) => a.name.localeCompare(b.name)).forEach(tagConfig => {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag';
      tagEl.textContent = tagConfig.name;
      tagEl.style.backgroundColor = `${tagConfig.color}20`; // Lighter background
      tagEl.style.color = tagConfig.color;
      tagEl.addEventListener('click', () => {
        searchBox.value = ''; // 清空搜尋框
        filterBookmarksByTag(tagConfig.name);
      });
      tagsContainer.appendChild(tagEl);
    });
  }

  // 3. 渲染書籤列表
  function renderBookmarks(bookmarksToRender) {
    bookmarksDiv.innerHTML = '';
    bookmarksToRender.forEach(bookmark => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      const link = document.createElement('a');
      link.href = bookmark.url;
      link.textContent = bookmark.title;
      link.title = `${bookmark.title}\n${bookmark.url}`; // 滑鼠懸停時顯示完整標題和URL
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: bookmark.url });
        window.close(); // 點擊後關閉彈出視窗
      });
      item.appendChild(link);
      bookmarksDiv.appendChild(item);
    });
  }

  // 4. 根據標籤篩選書籤
  function filterBookmarksByTag(tag) {
    const filtered = allBookmarks.filter(bm => bm.tags.includes(tag));
    renderBookmarks(filtered);
  }

  // 5. 根據搜尋文字篩選書籤
  function filterBookmarksBySearch(query) {
    if (!query) {
      bookmarksDiv.innerHTML = ''; // 如果搜尋框為空，則清空結果
      return;
    }
    const lowerCaseQuery = query.toLowerCase();
    const filtered = allBookmarks.filter(bm => 
      bm.title.toLowerCase().includes(lowerCaseQuery) ||
      bm.url.toLowerCase().includes(lowerCaseQuery)
    );
    renderBookmarks(filtered);
  }

  // 6. 綁定事件監聽器
  searchBox.addEventListener('input', (e) => {
    filterBookmarksBySearch(e.target.value);
  });

  openManagerBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "openManager" });
    window.close();
  });

  // 讓搜尋框自動獲得焦點
  searchBox.focus();

  // 應用儲存的主題設定
  async function applySavedTheme() {
    const { theme } = await chrome.storage.local.get('theme');
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
    }
  }

  // 程式入口
  try {
    await applySavedTheme();
    await loadData();
  } catch (e) {
    console.error("Error loading bookmark data:", e);
    bookmarksDiv.textContent = "讀取書籤時發生錯誤。";
  }
});
