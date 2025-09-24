function openManagerPage() {
  // 檢查是否已經有管理頁面打開了
  const managerUrl = chrome.runtime.getURL("manager.html");
  chrome.tabs.query({ url: managerUrl }, (tabs) => {
    if (tabs.length > 0) {
      // 如果已開啟，則切換到該分頁並使其成為焦點
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      // 否則，建立新分頁
      chrome.tabs.create({ url: managerUrl });
    }
  });
}

// 監聽快捷鍵命令
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-manager") openManagerPage();
});

// 監聽來自 popup 的訊息
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "openManager") openManagerPage();
});