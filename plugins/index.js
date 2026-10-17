// 由 tools/build-plugins.ps1 自动生成，请勿手工修改。
window.ND_PLUGIN_INDEX = [
    {
        "id":  "ai-analysis",
        "name":  "AI 分析",
        "version":  "0.1.0",
        "apiVersion":  1,
        "entry":  "ai-analysis/index.js",
        "enabled":  true,
        "priority":  50,
        "description":  "通过 OpenAI 兼容接口手动生成章节/卷/全书摘要，抽取人物、事件与伏笔，结果按书保存在本地插件存储。"
    },
    {
        "id":  "clean-annotations",
        "name":  "去除更新标注",
        "version":  "0.1.0",
        "apiVersion":  1,
        "entry":  "clean-annotations/index.js",
        "enabled":  false,
        "priority":  100,
        "description":  "去掉标题末尾的（为…加更）、（庆祝…加更）、（N月月票…）等括号标注，并提供 cleanTitle 变量。默认停用，不改变原有导出结果。"
    }
];
