document.addEventListener('DOMContentLoaded', async () => {
  const addForm = document.getElementById('add-bookmark-form');
  const bookmarkListDiv = document.getElementById('bookmark-list');
    const newGlobalTagInput = document.getElementById('new-global-tag');
    const addGlobalTagBtn = document.getElementById('add-global-tag-btn');
    const globalTagsListDiv = document.getElementById('global-tags-list');
    const bookmarkParentFolderSelect = document.getElementById('bookmark-parent-folder');
    const newGlobalTagColorInput = document.getElementById('new-global-tag-color');

    // 檢查 themeToggle 是否存在
  const themeToggle = document.getElementById('theme-toggle');
  const exportBookmarksButton = document.getElementById('export-bookmarks-button');
  const importBookmarksButton = document.getElementById('import-bookmarks-button');
  const importBookmarksInput = document.getElementById('import-bookmarks-input');


  let allBookmarks = [];
    // Data structure: [{ name: 'work', color: '#ff0000' }, ...]
  let globalTags = [];

    // --- 主題切換邏輯 ---
  async function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggle.checked = true;
        } else {
            document.body.classList.remove('dark-mode');
            themeToggle.checked = false;
        }
    }

  async function saveThemePreference(theme) {
        await chrome.storage.local.set({ theme: theme });
    }

  themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        applyTheme(newTheme);
      saveThemePreference(newTheme);
    });



    // --- 新增書籤邏輯 ---
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const url = document.getElementById('bookmark-url').value;
        const parentId = bookmarkParentFolderSelect.value; // 獲取選擇的資料夾 ID
        if (!url) { alert('請輸入書籤網址！'); return; }

        const title = document.getElementById('bookmark-title').value || url; // 如果標題為空，則使用URL
        const tags = document.getElementById('bookmark-tags').value;
        const notes = document.getElementById('bookmark-notes').value;

        // 1. 建立書籤
        chrome.bookmarks.create({
            title: title,
            url: url,
            parentId: parentId // 指定父資料夾
        }, (newBookmark) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                alert('新增書籤失敗: ' + chrome.runtime.lastError.message);
                return;
            }

            // 2. 如果有標籤或備註，則儲存它們
            if (tags || notes) {
                const metadata = {
                    tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), // 分割並清理標籤
                    notes: notes
                };
                // 使用書籤ID作為key來儲存元數據
                chrome.storage.sync.set({ [newBookmark.id]: metadata }, async () => { // Make this callback async
                    alert('書籤已成功新增！');
                    addForm.reset(); // 清空表單
                    // Add new tags to global list
                    let newTagsAdded = false;
                    for (const tagName of metadata.tags) {
                        if (!globalTags.some(t => t.name === tagName)) {
                            globalTags.push({ name: tagName, color: '#cccccc' }); // Add with default color
                            newTagsAdded = true;
                        }
                    }
                    await saveGlobalUniqueTags();
                    loadAndRenderBookmarks(); // 重新載入列表
                });
            } else {
                alert('書籤已成功新增！');
                addForm.reset(); // 清空表單
                loadAndRenderBookmarks(); // 重新載入列表
            }
        });
    });
    

    // --- 載入並渲染所有書籤 ---
  async function loadAndRenderBookmarks() {
        const bookmarkTree = await chrome.bookmarks.getTree();
        const allMetadata = await chrome.storage.sync.get(null);
        
        const bookmarks = [];
        function flattenBookmarks(nodes) {
            for (const node of nodes) {
                if (node.url) {
                    const metadata = allMetadata[node.id] || {};
                    bookmarks.push({
                        id: node.id,
                        title: node.title,
                        url: node.url,
                        tags: metadata.tags || [],
                        notes: metadata.notes || ''
                    });
                }
                if (node.children) flattenBookmarks(node.children);
            }
        }
        flattenBookmarks(bookmarkTree);

        bookmarkListDiv.innerHTML = ''; // 清空現有列表
        allBookmarks = bookmarks; // Update the global bookmarks array
        bookmarks.forEach(bookmark => {
            const itemEl = createBookmarkItemElement(bookmark);
            bookmarkListDiv.appendChild(itemEl);
        });
        renderGlobalTags(); // Also re-render global tags in case new ones were added
    }


    // --- 載入並渲染書籤資料夾 ---
  async function loadAndRenderFolders() {
        const bookmarkTree = await chrome.bookmarks.getTree();
        bookmarkParentFolderSelect.innerHTML = '<option value="1">根目錄</option>'; // 預設根目錄


        function traverseFolders(nodes, indent = 0) {
            for (const node of nodes) {
                if (!node.url) { // 這是資料夾
                    const option = document.createElement('option');
                    option.value = node.id;
                    option.textContent = '─'.repeat(indent * 2) + (indent > 0 ? ' ' : '') + node.title;
                    bookmarkParentFolderSelect.appendChild(option);
                    if (node.children) {
                        traverseFolders(node.children, indent + 1);
                    }
                }
            }
        }

        // 從書籤樹的第二層開始遍歷，因為第一層通常是根目錄和書籤列
        traverseFolders(bookmarkTree[0].children);
    }


    // --- 建立單個書籤的 DOM 元素 ---
  function createBookmarkItemElement(bookmark) {
        const itemEl = document.createElement('div');
        itemEl.className = 'bookmark-item';
        itemEl.dataset.id = bookmark.id;

        // 顯示模式的內容
        const displayView = `
            <a href="${bookmark.url}" target="_blank" class="title">${bookmark.title}</a>
            <div class="url">${bookmark.url}</div>
            <div class="tags">${
                bookmark.tags.map(tagName => {
                    const tagConfig = globalTags.find(t => t.name === tagName) || { color: '#cccccc' };
                    return `<span style="background-color: ${tagConfig.color}1A; color: ${tagConfig.color}; border: 1px solid ${tagConfig.color}4D;">${tagName}</span>`;
                }).join('')
            }</div>
            ${bookmark.notes ? `<div class="notes">${bookmark.notes}</div>` : ''}
            <div class="actions">
                <button class="edit-btn">編輯</button>
                <button class="delete-btn">刪除</button>
            </div>
        `;
        itemEl.innerHTML = displayView;

        // --- 綁定事件 ---
        const editBtn = itemEl.querySelector('.edit-btn');
        const deleteBtn = itemEl.querySelector('.delete-btn');

        itemEl.setAttribute('draggable', true);
        itemEl.addEventListener('dragstart', dragStart);
        itemEl.addEventListener('drop', drop);


        editBtn.addEventListener('click', () => toggleEditView(itemEl, bookmark));
        deleteBtn.addEventListener('click', async () => {
            if (confirm(`確定要刪除書籤 "${bookmark.title}" 嗎？`)) {
                await chrome.bookmarks.remove(bookmark.id);
                await chrome.storage.sync.remove(bookmark.id);
                itemEl.remove(); // 從畫面上移除
            }
        });

        return itemEl;
    }

    function dragStart(event) {
      event.dataTransfer.setData('text/plain', event.target.dataset.id);
      event.target.classList.add('dragging');
    }

    function allowDrop(event) {
        event.preventDefault();
    }

    async function drop(event) {
      event.preventDefault();
      const fromBookmarkId = event.dataTransfer.getData('text/plain');
      const fromElement = document.querySelector(`.bookmark-item[data-id="${fromBookmarkId}"]`);
      if (fromElement) {
        fromElement.classList.remove('dragging');
      }

      // Ensure the drop target is a bookmark item
      const toElement = event.target.closest('.bookmark-item');
      if (!toElement) return;
      const toBookmarkId = toElement.dataset.id;

      if (fromBookmarkId === toBookmarkId) return;

      // Find the index of the target bookmark
      const toBookmarkIndex = allBookmarks.findIndex(bm => bm.id === toBookmarkId);

      if (toBookmarkIndex === -1) return;

      // Update bookmark index using Chrome Bookmarks API
      await chrome.bookmarks.move(fromBookmarkId, { index: toBookmarkIndex });

      // Reload and render to reflect the new order
      await loadAndRenderBookmarks();
    }

    // --- 切換到編輯模式 ---
    async function toggleEditView(itemEl, bookmark) { // Make this async
        // Ensure globalUniqueTags is loaded
        await loadGlobalUniqueTags();

        let tagCheckboxesHtml = '';
        globalTags.sort((a, b) => a.name.localeCompare(b.name)).forEach(tagConfig => {
            const isChecked = bookmark.tags.includes(tagConfig.name) ? 'checked' : '';
            tagCheckboxesHtml += `
                <label>
                    <input type="checkbox" value="${tagConfig.name}" ${isChecked}>
                    <span style="background-color: ${tagConfig.color}1A; color: ${tagConfig.color}; border: 1px solid ${tagConfig.color}4D; padding: 2px 6px; border-radius: 10px;">
                        ${tagConfig.name}
                    </span>
                </label>
            `;
        });

        // 編輯模式的內容
        const editView = `
            <input type="text" class="edit-title" value="${bookmark.title}">
            <div class="tag-checkboxes">
                ${tagCheckboxesHtml}
            </div>
            <textarea class="edit-notes" rows="3">${bookmark.notes}</textarea>
            <div class="actions">
                <button class="save-btn">儲存</button>
                <button class="cancel-btn">取消</button>
            </div>
        `;
        itemEl.innerHTML = editView;

        const saveBtn = itemEl.querySelector('.save-btn');
        const cancelBtn = itemEl.querySelector('.cancel-btn');

        saveBtn.addEventListener('click', async () => {
            const newTitle = itemEl.querySelector('.edit-title').value;
            const newNotes = itemEl.querySelector('.edit-notes').value;
            const checkedTags = Array.from(itemEl.querySelectorAll('.tag-checkboxes input[type="checkbox"]:checked'))
                .map(checkbox => checkbox.value);

            // 更新 Chrome 書籤
            await chrome.bookmarks.update(bookmark.id, { title: newTitle });

            // Use checkedTags instead of newTags for metadata
            const updatedMetadata = {
                tags: checkedTags,
                notes: newNotes
            };
            await chrome.storage.sync.set({ [bookmark.id]: updatedMetadata });

            // Ensure any newly selected tags are added to the global list
            let newTagsAdded = false;
            for (const tagName of checkedTags) {
                if (!globalTags.some(t => t.name === tagName)) {
                    globalTags.push({ name: tagName, color: '#cccccc' });
                }
            }
            await saveGlobalUniqueTags();

            // 重新渲染整個列表以顯示更新
            loadAndRenderBookmarks();
        });

        cancelBtn.addEventListener('click', () => {
            // 取消編輯，重新渲染整個列表
            loadAndRenderBookmarks();
        });
    }

    // --- 全域標籤管理邏輯 ---
    async function loadGlobalUniqueTags() {
    const result = await chrome.storage.sync.get('_globalTagsConfig');
        globalTags = result._globalTagsConfig || [];
    }

    async function saveGlobalUniqueTags() {
        await chrome.storage.sync.set({ _globalTagsConfig: globalTags });
    }

    async function addGlobalTag(name, color) {
        const trimmedName = name.trim();
        if (trimmedName && !globalTags.some(t => t.name === trimmedName)) {
            globalTags.push({ name: trimmedName, color: color });
            await saveGlobalUniqueTags();
            renderGlobalTags(); // Re-render the global tag list
        }
    }

    async function removeGlobalTag(tagToRemove) {
        globalTags = globalTags.filter(t => t.name !== tagToRemove);
        await saveGlobalUniqueTags();
        renderGlobalTags(); // Re-render the global tag list
    }

    function renderGlobalTags() {
        globalTagsListDiv.innerHTML = '';
        globalTags.sort((a, b) => a.name.localeCompare(b.name)).forEach(tagConfig => {
            const tagItem = document.createElement('div');
            tagItem.className = 'global-tag-item';
            // Use a colored border to indicate the tag's color
            tagItem.style.borderLeft = `5px solid ${tagConfig.color}`;
            tagItem.style.backgroundColor = `${tagConfig.color}1A`;

            tagItem.innerHTML = `
                <span style="color: ${tagConfig.color};">${tagConfig.name}</span>
                <button class="remove-tag-btn" data-tag="${tagConfig.name}" style="color: ${tagConfig.color};">
                    &times;
                </button>
            `;
            globalTagsListDiv.appendChild(tagItem);
        });

        // Add event listeners for remove buttons
        globalTagsListDiv.querySelectorAll('.remove-tag-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const tagToRemove = e.target.dataset.tag;
                if (confirm(`確定要刪除標籤 "${tagToRemove}" 嗎？這不會影響書籤，但該標籤將不再顯示在編輯選項中。`)) {
                    await removeGlobalTag(tagToRemove);
                    // Note: Removing a global tag here does NOT remove it from existing bookmarks.
                    // It only removes it from the list of available tags for new bookmarks or editing.
                }
            });
        });
    }

    addGlobalTagBtn.addEventListener('click', async () => {
        const tagName = newGlobalTagInput.value;
        const tagColor = newGlobalTagColorInput.value;
        if (tagName) {
            await addGlobalTag(tagName, tagColor);
            newGlobalTagInput.value = '';
        }
    });

    // --- 匯入/匯出邏輯 ---
    async function exportData() {
        // Flatten bookmarks with their metadata
        const bookmarkTree = await chrome.bookmarks.getTree();
        const allMetadata = await chrome.storage.sync.get(null);
        const bookmarksToExport = [];

        function flattenForExport(nodes) {
            for (const node of nodes) {
                if (node.url) {
                    const metadata = allMetadata[node.id] || {};
                    bookmarksToExport.push({
                        title: node.title,
                        url: node.url,
                        tags: (metadata.tags || []).join(';'), // Use semicolon to separate tags within a cell
                        notes: metadata.notes || ''
                    });
                }
                if (node.children) {
                    flattenForExport(node.children);
                }
            }
        }
        flattenForExport(bookmarkTree);

        // Convert to CSV
        const header = ['title', 'url', 'tags', 'notes'];
        const csvRows = [header.join(',')];

        for (const bookmark of bookmarksToExport) {
            const values = header.map(fieldName => {
                const value = bookmark[fieldName] || '';
                // Escape commas and quotes
                const escaped = ('' + value).replace(/"/g, '""');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        }

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });

        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.href = URL.createObjectURL(blob);
        downloadAnchorNode.setAttribute("download", `bookmarks_backup_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    async function importData(file) {
        if (!confirm('警告：從 CSV 匯入將會新增書籤，但不會刪除現有書籤。這可能會造成重複。確定要繼續嗎？')) {
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const csv = e.target.result;
                const rows = csv.split('\n').map(row => row.trim()).filter(Boolean);
                const header = rows.shift().split(',').map(h => h.replace(/"/g, ''));

                const titleIndex = header.indexOf('title');
                const urlIndex = header.indexOf('url');
                const tagsIndex = header.indexOf('tags');
                const notesIndex = header.indexOf('notes');

                if (titleIndex === -1 || urlIndex === -1) {
                    alert('無效的 CSV 檔案格式。必須包含 "title" 和 "url" 欄位。');
                    return;
                }

                for (const row of rows) {
                    // A simple CSV parser, might not handle all edge cases
                    const values = row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g).map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
                    const title = values[titleIndex];
                    const url = values[urlIndex];
                    const tags = tagsIndex > -1 ? values[tagsIndex].split(';').map(t => t.trim()).filter(Boolean) : [];
                    const notes = notesIndex > -1 ? values[notesIndex] : '';

                    if (url) {
                        const newBookmark = await chrome.bookmarks.create({ parentId: '1', title: title || url, url: url });
                        const metadata = { tags, notes };
                        await chrome.storage.sync.set({ [newBookmark.id]: metadata });

                        // Add new tags to global list
                        tags.forEach(tagName => {
                            if (!globalTags.some(t => t.name === tagName)) {
                                globalTags.push({ name: tagName, color: '#cccccc' });
                            }
                        });
                    }
                }
                await saveGlobalUniqueTags();

                alert('書籤匯入成功！');
                window.location.reload(); // Reload the page to see changes

            } catch (error) {
                alert('匯入失敗: ' + error.message);
                console.error(error);
            }
        };
        reader.readAsText(file);
    }

    exportBookmarksButton.addEventListener('click', exportData);
    importBookmarksButton.addEventListener('click', () => importBookmarksInput.click());
    importBookmarksInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importData(e.target.files[0]);
        }
    });

    // Add dragover listener to the list container
    bookmarkListDiv.addEventListener('dragover', allowDrop);

    // --- 程式入口 ---
  // 載入主題設定
    const themeResult = await chrome.storage.local.get('theme');
    applyTheme(themeResult.theme || 'light'); // Default to light mode

  await loadGlobalUniqueTags(); // Load global tags first
    await loadAndRenderFolders(); // Load and render folders
    loadAndRenderBookmarks(); // This will also call renderGlobalTags
});