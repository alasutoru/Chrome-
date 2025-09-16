chrome.action.onClicked.addListener(() => {
  chrome.browsingData.remove(
    {
      "since": 0 // Clear data from all time
    },
    {
      "appcache": true,
      "cache": true,
      "cacheStorage": true,
      "cookies": true,
      "downloads": true,
      "fileSystems": true,
      "formData": true,
      "history": true,
      "indexedDB": true,
      "localStorage": true,
      "passwords": true,
      "serviceWorkers": true,
      "webSQL": true
    },
    () => {
      console.log("瀏覽資料已清除！");
      // Optionally, you can send a message to the user or update the badge text
      // chrome.action.setBadgeText({ text: "OK" });
      // setTimeout(() => { chrome.action.setBadgeText({ text: "" }); }, 1000);
    }
  );
});