# dsh-plugin-files-download（中文）

给 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的**文件树每一行加一个下载按钮**。点一下，文件就以原文件名保存到本地；字节由宿主流式发送，不进页面内存、没有大小上限。

```
文件  /home/me/project
├─ src/                        ← 目录行：没有按钮
├─ README.md                ↓  ← 文件行：常驻下载按钮
└─ package.json             ↓
```

## 它做了什么

| 半 | 文件 | 职责 |
|---|---|---|
| 宿主 | `lib/index.js` | 在 Connection 的鉴权围栏内注册 `GET\|HEAD /api/workspace-file.download?sessionId=…&path=…`。按 Remote 查找同样的方式解析会话工作区根，先 `stat` 拒绝不存在/目录/符号链接，再按 1 MiB 窗口经 `ctx.workspaceFiles` 流式输出，带 `content-disposition: attachment` 和原文件名。 |
| 浏览器 | `lib/client.js` | 往文件树的 `sidebar.right.files.row.actions` seat 注册一个 cell。cell 就是指向该路由的 `<a download>`，进度、取消、保存名都由浏览器下载管理器负责。 |

不重写文件树：seat 由 `@deepseek-ai/dsh-client-ui-sidebar-files` 声明，本包只负责填充。

## 前置要求

所挂载的 `@deepseek-ai/dsh-client-ui-sidebar-files` 客户端 bundle **必须声明** `sidebar.right.files.row.actions` seat。早于该 seat 的官方版 DSH 没有它，此时本插件的注册会在浏览器端加载报告里**明确报错**，不会半渲染。补法见[「需要先有这个 seat」](#需要先有这个-seat)。

- Node：>= 22（宿主半用了 `AbortSignal.any` 与 WHATWG `ReadableStream`）
- 浏览器：现代浏览器即可（下载是一次普通导航，不依赖任何客户端专有 API）

## 安装

包里是**预构建好的 JavaScript，安装不需要构建步骤**。

```sh
# 直接从 GitHub 装（pnpm 原样转发 git 规格）
dsh plugin --profile web add github:Yingblock/dsh-plugin-files-download

# 或从本地目录/压缩包装
dsh plugin --profile web add /path/to/dsh-plugin-files-download
```

也可以手动在 profile 的 `cordis.patch.yml` 里加一行：

```yaml
- insert:
    - id: files-download
      name: dsh-plugin-files-download
```

**装完必须重启 `dsh web`**：客户端的 boot graph 只在启动时组装，开着的页面不会自己换。

重启后**浏览器要硬刷新**（`Ctrl+Shift+R`）。只有在跑 `pnpm run dev:web` 时，bundle 的 HMR 才会自动生效。

### 卸载

```sh
dsh plugin --profile web remove dsh-plugin-files-download
```

## 使用

1. 打开右侧栏的 **文件** 标签。
2. 每个**文件行**右侧常驻一个 `↓` 控件（不需要悬停）；目录行没有。
3. 点它，浏览器按原文件名保存。

控件是对宿主路由的一次真实导航，不是页面内 fetch，所以几百 MB 的文件也是直写磁盘。

## 需要先有这个 seat

`sidebar.right.files.row.actions` 这个 seat 必须加在**文件树自己的包**里，因为行归它渲染。共 4 个文件，位于 `packages/client/ui-sidebar-files`：

| 文件 | 改动 |
|---|---|
| `src/client/slot-contract.ts`（新增） | 声明 seat：`kind: 'single'`、`scope: 'session'`，owner props 为 `{ path, name }` |
| `src/client/index.ts` | 文件树 body 注册时声明子 seat：`children: { 'sidebar.right.files.row.actions': { kind: 'single', scope: 'session' } }` |
| `src/client/FilesBody.tsx` | 文件行里渲染该 seat：`renderSlot('sidebar.right.files.row.actions', { path, name })` |
| `src/client/FilesBody.module.css` | 行改 `display:flex`；操作容器 `flex: 0 0 auto` |

然后只重建这一个包：

```sh
tsc -b packages/client/ui-sidebar-files
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar-files run bundle
```

再重启 `dsh web` 并硬刷新浏览器。

> **为什么必须是 `single` 而不是 `keyed`？**
> keyed seat 是按**注册 key** 分发的（`entriesOfSlot(key).find(e => e.options.key === entryKey)`），而它的键域是编译期固定的。文件行是运行期动态集合、插件无法预先枚举，用常量 key 注册就永远匹配不上树按行分发的 key —— cell 留在账本里但永远不渲染。正确形状是**一个 `single` seat 每行渲染一次**，把该行身份放在 owner props 里传下去。

## 自查

宿主侧（不带 cookie 就能看出路由在鉴权之后）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3080/api/workspace-file.download?sessionId=x&path=y'
# 401（未鉴权）
```

带 cookie 时的状态码：

| 情况 | 响应 |
|---|---|
| 正常 | `200`，流式字节，`content-disposition: attachment` |
| 缺 `sessionId`/`path` | `400 missing sessionId or path query parameter` |
| 会话不存在 | `404 session not found` |
| 文件不存在 | `404` |
| 不是普通文件 | `422` |

浏览器控制台：

```js
JSON.stringify(globalThis.__DSH_FILES_DOWNLOAD__)
// {"apply":true,"registered":true,"renders":9,"version":"single-seat"}
// renders 应等于当前渲染的文件行数
```

`globalThis.__DSH_FILES_DOWNLOAD__` 是只读诊断对象，不产生 UI、无渲染开销。

## 已知边界

- **只支持文件**，不做目录打包下载。
- **会话作用域**：路由按活动会话 header 解析工作区根，冷会话回退到持久化的 header-only stat。GUI 当前会话总是活动的，正常使用无感。
- **读权限等同 `ctx.fs`**：内置预览能读的文件就能下载，包括工作区之外的路径。
- **保存名取文件自身 basename**：平台非法名或重名由浏览器处理，本包不改写。
- **按钮常驻可见**（设计如此）。想改回悬停显示：在文件树样式里给 `.actions` 加 `opacity: 0`，并补 `.item:hover .actions` 规则。

## 许可

MIT，见 [LICENSE](LICENSE)。
