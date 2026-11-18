# 设置页验收记录

- 目标：在 **Settings** 中添加「凭据路由中枢」菜单、SSH/PAT 清单编辑和运行配置表单。
- 环境：DSH `0.2.2-rc.3`，desktop profile，插件以本地 link 安装。
- 代码位置：[client.js](../client.js)、[src/settings.js](../src/settings.js)、[src/settings-routes.js](../src/settings-routes.js)。
- 参考槽位：`settings.section`（nav 页）与 `settings.section.icon`（同 id 的图标）。

## 已完成的验证

### 1. 菜单与图标已注册并激活

通过 live Client Slots 查询（机器可读摘要见 [`verification/ui-slots.json`](./verification/ui-slots.json)）：

```text
settings.section occupants:
  { id: "account",            order: -10, active: true }
  { id: "general",            order:   0, active: true }
  { id: "models",             order:  10, active: true }
  { id: "agent-presets",      order:  20, active: true }
  { id: "dsh-session-archive", order: 25, active: true }
  { id: "credential-hub",     order:  30, active: true }
  { id: "web-ui-plugins",     order: 110, active: true }

settings.section.icon occupants:
  { id: "credential-hub", active: true }
```

菜单标题来自 `client.js` 的 `sectionTitle` 字典（中文「凭据路由中枢」，英文「Credential hub」），
图标是插件自己的盾+钥匙 SVG，不是默认字形。

### 2. 浏览器模块契约测试

`test/client.test.mjs` 在 VM 沙箱中执行 `client.js`，验证：

- bundle id 为 `dsh-credential-hub`；
- `inject` 为 `['slots','locale']`；
- 注册且仅注册一个 `settings.section`（id `credential-hub`、order 30、locale `credential-hub`）；
- 注册匹配 id 的 `settings.section.icon`；
- zh/en 字典 key 完全对齐，供切换语言时使用。

### 3. Host 路由与服务测试

`test/settings.test.mjs` 覆盖：

- `state()` 只返回 alias/tags/description/连接元数据/credentialRef 和
  `{configured, source, writable}`，不返回 provider 的 `masked` 预览或任何值；
- `saveRecord()` 新增/改名/跨 kind 删除、0600 原子写入、拒绝 `privateKey` 等 secret 字段；
- `setCredential()` 通过 `ctx.credentials.set()` 写入值，响应/清单/日志都不含该值；
- 设置页“凭据值”字段为 `type=password` 的 write-only 输入，保存后不回显；
- 加密导出包只返回密文；导入在 Host 解密、校验后先写清单再写凭据，凭据失败会报告 ref；
- 错误口令、密文/标签篡改、弱口令、非法 KDF 参数均被拒绝；
- 导入包里夹带的 `privateKey` 等 secret 字段在写清单前被拒绝；
- `deleteRecord()` 两次确认所依赖的 404 语义；
- `saveConfig()` 只接受白名单字段，通过 `configEditor` 写入用户 patch 层，缺失编辑器时明确报错；
- GET `/api/credential-hub/state` 与 POST `/api/credential-hub/action` 的 200/400/404/409 分支；
- 响应 JSON 中不含 SSH 私钥或 PAT；provider 错误被替换为通用消息；
- `allowLoopbackHttp:false` 会拒绝 loopback HTTP；写清单后加载失败的测试确认不留下新文件。

`npm test`：**75 pass / 0 fail**（原始输出见 [`verification/unit-tests.txt`](./verification/unit-tests.txt)）。

### 4. 设置页交互（代码级）

- 四个页签：SSH 主机 / PAT 令牌 / 导入导出 / 运行配置；记录页签带计数。
- 搜索、刷新、空状态、无匹配、加载中、错误重试。
- 记录卡显示 ref 的“已配置 / 未配置 / 引用无效”和来源；不显示明文。
- 删除展开独立确认行；确认按钮 350ms 防双击，可取消；错误在行内显示。
- 保存配置后提示插件重启；清单路径/权限不再占用页面空间。
- 表单有 label/for 关联、`aria-label`、焦点环、`role=alert`/`role=status`；
  配置复选框有可见的启用/停用文字。
- 响应式：<720px 时表单从双列变单列，记录卡顶部换行。
- 颜色只使用 `--dsw-alias-*` token；没有导入任何 Harness Client 包。
- 页面仅调用两个 Host 路由，路由由 DSH Connection 的鉴权/Origin 栅栏保护；凭据值走 `set-credential` write-only 分支，加密包走 `export-bundle`/`import-bundle`，浏览器只接触密文或统计结果。
- 导入/导出面板有口令确认、合并/替换、替换二次确认、文件大小限制和就地错误/结果状态。

## UI/UX 评审与修复

已按 DSH 要求让一个 UI/UX 评审子代理独立审阅 `client.js`、`src/settings.js`、
`src/settings-routes.js` 与 README，并按发现修复：

| 级别 | 发现 | 处理 |
|---|---|---|
| High | `credentialRef` 校验错误会回显用户误粘贴的值 | 错误只给语法提示，不再 `JSON.stringify(value)`；`resolve` 官方 brand 错误也被替换；客户端先用正则拦截；新增 secret-shaped ref 单测 |
| High | 同一删除按钮点两次会直接删除，双击可绕过确认 | 改为卡片内独立确认行：第一次点击打开确认，确认按钮 350ms 内禁用，另有取消；删除错误显示在行内 |
| High | 从长列表底部编辑时表单在视口外、保存后焦点丢失 | 打开表单后 `scrollIntoView` + 自动聚焦 alias；保存/取消/删除后焦点回到“新增记录” |
| High | 提示“Settings → Credentials”，但现场设置导航没有该入口 | 全部改为 **Settings → 账户（Account）** 或 `ctx.credentials.set` / 启动环境变量 |
| Medium | 读取失败时仍显示“还没有记录”/配置页无限“正在读取” | 增加明确的失败态与重试，不再把失败当空清单 |
| Medium | 记录保存/删除会覆盖未保存的配置草稿 | 用 `configDirtyRef` 保护草稿；记录操作不再回写 configDraft |
| Medium | 配置保存固定 1.8s 后只刷新一次 | 改为最多 8 次退避轮询，重启期间保存按钮保持禁用 |
| Medium | 无效 ref 原因只在 badge `title`，未配置提示对无效 ref 是错误指引 | 行内显示错误；凭据值字段只在编辑器中，不在卡片上堆指引 |
| Medium | 删除失败错误出现在页面顶部，重试不会重试删除 | 删除错误放入确认行，使用行内重试语义 |
| Medium | tab 使用不完整的 `role=tablist/tab` | 改为普通按钮组 + `aria-pressed`（ARIA 的可接受简化），避免不完整 tab 语义 |
| Medium | 客户端只校验 3 个字段，端口 `abc` 会静默变成 22 | 补 host/username、headerName/basic username、端口整数校验；端口改 `type=number` |
| Medium | 只读/保存中的 input 看起来仍可编辑 | 为 input/select/textarea/checkbox 加 disabled 样式 |
| Medium | 浅色主题下 card/input 与底色几乎同色 | 边框改用 `--dsw-alias-border-l2`，卡片/输入/按钮边界更清晰 |
| Medium | Host 返回中文只读原因、英文界面混合中文 | Host 改返回 `configReadOnlyCode`，Client 本地化；description placeholder 移入字典 |
| Low | 无匹配标题/正文重复、tags/count 未用 | 空状态只保留标题/按钮，使用 `tagsLabel` 与 `count` |
| Low | 配置只读说明用错误红色 | 改用中性 `.credhub-info`；无改动提示也用中性样式 |
| Low | host key `no` 无风险提示 | 选择 `no` 时显示 MITM 警告 |
| Low | slot 注册无 try/catch | 两个 slot 注册都捕获并返回 no-op disposer |

仍未处理（低优先级，已记录）：

- 客户端没有渲染级测试（只做模块/注册/字典契约测试和 Host 单测）；UI 状态与焦点流程靠代码审查，视觉未验证。
- 服务端字段错误仍是英文并可能带 `ssh[0]` 下标；客户端已做主要必填校验，但没有逐字段本地化映射。
- 表单提示已精简为必要的凭据值 hint；其余字段依赖 label/placeholder。

## 未完成的验证

本次验收未使用浏览器自动化，也没有另起浏览器或复用鉴权 token：

- `http://127.0.0.1:62232` 是带会话鉴权的 GUI，直接请求返回 401；
- 没有用 mock 页面替代真实截图。

因此以下项目**没有**视觉确认，需要在 GUI 里人工检查：

1. 刷新页面后 Settings 左侧出现「凭据路由中枢」及自定义图标；
2. 切换浅色/深色主题，确认文字、边框、状态徽标、按钮对比度；
3. 打开四个页签，新增一条 SSH 与一条 PAT（使用测试 ref 和测试凭据值），确认保存后列表刷新、徽标变“已配置”、密码框被清空；
4. 编辑一条记录改 alias，确认旧 alias 消失；删除需要二次确认；
5. 刷新页面后确认凭据值输入框始终为空、不回显已保存的值；再到 Settings → 账户（Account）或 `ctx.credentials.set` 替换一次，回来确认“已配置”及来源变化；
6. 运行配置中切换一个字段并保存，确认重启提示、面板重新加载后值仍保留；
7. 切换到“导入 / 导出”，输入两次口令（≥8 位）导出，确认浏览器下载加密文件；
8. 在另一台机器导入同一文件，分别试合并/替换，确认记录和徽标；错误口令应报错且不清空清单；
9. 窄窗口（约 600px）确认双列表单变单列、无横向溢出；
10. 浏览器控制台无 `slot entry crashed in 'settings.section'` 或其他 React 错误。

如果上述任一项失败，请把控制台错误和截图贴回，我会按实际 DOM/React 报错修复。
