// test.js - 极简测试
(async () => {
    console.log("脚本运行成功！");
    await $notification.post("测试", "来自 Loon", "如果你看到这条消息，说明脚本正常工作。");
})();