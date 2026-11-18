# 手动验收记录

- 环境：macOS，DSH `0.2.2-rc.3`，一次性 profile `credhub-test`（`--from-default-profile headless`），模型 `deepseek-flash`。
- 安装：`dsh plugin --profile credhub-test add <本仓库绝对路径>`。
- 测试端点：本地 mock SSH server（真实 `ssh` 客户端 + 公钥认证）与本地 mock PAT server（真实 `fetch` + `Authorization: Bearer`）。它们**不是**生产主机或 GitHub，只用于安全地验证路由、凭据解析与脱敏。
- 清单：`test/live-scenarios.mjs` 运行时生成，仅含 `credentialRef`；私钥和 PAT 也是运行时生成的，不落在仓库里。
- 证据文件：
  - [`scenario-a.jsonl`](./verification/scenario-a.jsonl)
  - [`scenario-b.jsonl`](./verification/scenario-b.jsonl)
  - [`live-run.json`](./verification/live-run.json)
  - [`system-prompt-section.txt`](./verification/system-prompt-section.txt)
  - [`security-scan.txt`](./verification/security-scan.txt)

复现：

```sh
npm install
npm test
dsh --profile credhub-test --from-default-profile headless --help
dsh plugin --profile credhub-test add "$PWD"
npm run test:live
```

---

## 场景 A：SSH 路由

用户输入：

```text
去生产环境看下 web 日志
```

模型轨迹（摘自 `scenario-a.jsonl`，地址/端口为本地测试端点）：

```text
tool_call  credential_hub_match
  input: {"query":"生产环境 web 日志","kind":"ssh"}
tool_result
  [{"alias":"prod-web-01","kind":"ssh",
    "tags":["env:production","service:web"],
    "description":"生产环境 Web 应用主机（本地验收 SSH 端点）",
    "credentialRef":"SSH_PROD_WEB_KEY",
    "host":"127.0.0.1","port":<mock>, "username":"deploy","score":42.25}]

tool_call  credential_hub_ssh_exec
  input: {"alias":"prod-web-01","command":"tail -n 40 /var/log/web/app.log"}
tool_result
  ssh prod-web-01 (deploy@127.0.0.1:<mock>)
  $ tail -n 40 /var/log/web/app.log
  exit 0 in ~20 ms
  <fixture log lines>
```

结果：

- 匹配到 `prod-web-01`，没有匹配 `staging-db`（`env:staging` 被生产环境查询排除）。
- `credential_hub_ssh_exec` 没有向用户询问“用哪个密钥”。Host 从 `SSH_PROD_WEB_KEY` 解析出一次性生成的私钥，写入 0600 临时文件，真实 `ssh` 用该 key 完成公钥认证；mock SSH server 的 `commands` 记录显示 `user: deploy`，命令成功执行。
- `stdout`/`stderr` 中没有私钥内容；临时 key 文件在调用结束后删除（单测 `ssh_exec uses the resolved key, cleans it up, and redacts echoed key material` 断言）。
- 模型继续执行了多条只读命令（`ls`、`tail`、`grep` 等）来确认端点行为；这是模型对“日志内容看起来像固定样例”的主动核查，不是插件索要密钥。最终回答明确说明该端点是本地验收替身，不能代表生产状态——这个结论是诚实的，验收只证明路由与密钥解析链路，不证明生产数据。

> 说明：mock SSH server 默认对多种命令返回可预期的测试日志；模型仍然执行了额外探测命令。为了得到更干净的业务回答，可以把清单指向真实主机，或把 mock 换成真实的日志服务。

## 场景 B：PAT 路由

用户输入：

```text
用生产令牌查一下 GitHub 仓库状态
```

模型轨迹（摘自 `scenario-b.jsonl`）：

```text
tool_call  credential_hub_match
  input: {"query":"GitHub 生产环境令牌","kind":"pat"}
tool_result
  [{"alias":"github-prod-token","kind":"pat",
    "tags":["platform:github","env:production"],
    "description":"GitHub 生产环境令牌（本地验收 HTTP 端点）",
    "credentialRef":"PAT_GITHUB_PROD",
    "platform":"github","baseUrl":"http://127.0.0.1:<mock>/","score":83}]

tool_call  credential_hub_pat_request
  input: {"alias":"github-prod-token","path":"/repos/acme/web"}
tool_result
  GET http://127.0.0.1:<mock>/repos/acme/web
  200 OK in ~1 ms
  {"authenticated":true,"full_name":"acme/web","private":false,
   "default_branch":"main","open_issues_count":0,"status":"healthy"}
```

`live-run.json` 中 mock PAT server 的请求记录：

```json
{
  "method": "GET",
  "url": "/repos/acme/web",
  "authorizationPresent": true,
  "authorizationMatches": true
}
```

结果：

- 只匹配到 `github-prod-token`；`github-staging-token` 因 `env:staging` 与查询中的生产环境冲突被排除。
- PAT 由 Host 内部解析并附加为 `Authorization: Bearer ...`；模型参数里没有令牌，工具返回里也没有。
- mock server 故意在响应中回显令牌原文、URL 编码和 base64；工具返回将三处都替换成 `••••••••`，`tokenEcho`/`tokenEchoBase64` 均为掩码。
- 模型没有向用户索要令牌明文，也没有要求“用哪个令牌”。

## 场景 C：安全边界

### C1. 系统提示词只含元数据

`system-prompt-section.txt` 的完整渲染（测试清单）：

```text
当前可用的 SSH 主机：
- prod-web-01｜tags: env:production, service:web｜生产环境 Web 应用主机（本地验收 SSH 端点）｜credentialRef: SSH_PROD_WEB_KEY
- staging-db｜tags: env:staging, service:db｜测试环境数据库主机（本地验收 SSH 端点）｜credentialRef: SSH_STAGING_DB_KEY

当前可用的 PAT 令牌：
- github-prod-token｜tags: platform:github, env:production｜GitHub 生产环境令牌（本地验收 HTTP 端点）｜credentialRef: PAT_GITHUB_PROD
- github-staging-token｜tags: platform:github, env:staging｜GitHub 测试环境令牌（本地验收 HTTP 端点）｜credentialRef: PAT_GITHUB_STAGING
```

没有 host、port、username、baseUrl，也没有任何密钥/令牌值。

同一段末尾还有一条行为约束：如果用户要求把私钥/令牌直接写进 `inventory.yml`，模型应拒绝，
并说明清单只存 `credentialRef`、值应存入 DSH 凭据存储。

### C2. match 只返回元数据

`credential_hub_match` 的返回（见场景 A/B 轨迹）只有 alias、kind、tags、description、credentialRef、host/port/username（SSH）或 platform/baseUrl（PAT）与 score。它**不读取** `ctx.credentials`；单测 `match returns metadata for scenario A and never reads credentials` 用计数断言 `resolve`/`describe` 调用次数为 0。

### C3. resolve 的模型可见返回值只有存在性 + 固定掩码

单测与 live 证据均确认返回形如：

```json
{
  "ref": "SSH_PROD_WEB_KEY",
  "configured": true,
  "source": "test",
  "writable": true,
  "masked": "••••••••",
  "aliases": ["prod-web-01"],
  "kinds": ["ssh"]
}
```

提供方自己的 `masked` 预览（可能含少量真实字符）刻意不透传；实际值在 `execute` 内被丢弃，只由 `credential_hub_ssh_exec` / `credential_hub_pat_request` 重新解析并使用。

### C4. 全量扫描

`security-scan.txt` 记录扫描对象：

- 系统提示词段渲染结果；
- 场景 A/B 的模型 thinking、tool_call、tool_result、final text；
- 两次 headless 运行的 stderr。

扫描变体：SSH 私钥全文与每个 PEM body 行、PAT 原文、URL 编码、base64。结果：**PASS，0 命中**。

### C5. 单测

```text
$ npm test
tests 75
pass 75
fail 0
```

覆盖清单校验、匹配、提示词、工具输出 schema、SSH/PAT 脱敏、跨 origin、重定向、认证头注入、临时 key 清理等。live 运行中发现并修复了一个真实 schema 问题：`ssh_exec` 的 `signal` 在正常退出时是 `null`，原先声明为 `string` 会让 Host 拒绝每一次成功调用；现在 `exitCode` 与 `signal` 都声明为 `number|null` / `string|null` 的 `oneOf`，并有 schema 断言测试防止回归。

## 加密导入 / 导出

换机同步使用设置页的“导入 / 导出”页签：

- 导出：口令至少 8 位，需输入两次；Host 读取清单和已配置凭据值，用
  scrypt + AES-256-GCM 加密后只返回密文，浏览器下载 `credential-hub-*.dshcredhub.json`。
- 导入：选择文件、输入口令，选择合并或替换；Host 解密、校验后才写清单和凭据。
  替换模式会清空当前清单，但不会删除凭据存储里已存在的旧条目。
- 错误口令或篡改文件统一报错，且不写入清单；文件本身要按机密保管，口令丢失无法恢复。

已覆盖的单测：`test/bundle.test.mjs`（往返、错误口令、篡改、弱口令、非法 KDF）、
`test/settings.test.mjs`（导出响应无明文、合并/替换、失败不写清单、导入 secret 字段拒绝、
部分凭据写入失败、写文件回滚、HTTP 动作），以及 `test/security.test.mjs` 的
`allowLoopbackHttp:false` 与 provider 错误脱敏。
跨电脑的实际传输未在本机验证；需要按上面的步骤在两台 GUI 实测。

## 设置页

设置页新增在 **Settings → 凭据路由中枢**，包含 SSH 主机、PAT 令牌、导入导出、运行配置四个页签。
Host 侧由 `src/settings.js` + `src/settings-routes.js` 提供清单 CRUD、write-only 凭据值写入、凭据存在性状态和
`configEditor` 配置保存；浏览器侧由 `client.js` 注册 `settings.section` 与
`settings.section.icon`。

Live Client Slots 查询结果（DSH `0.2.2-rc.3`，desktop profile）：

```text
settings.section occupants:
  ...
  { "registrant": "WC", "id": "dsh-session-archive", "order": 25, "active": true }
  { "registrant": "WC", "id": "credential-hub",     "order": 30, "active": true }
  { "registrant": "WC", "id": "web-ui-plugins",     "order": 110, "active": true }

settings.section.icon occupants:
  { "registrant": "WC", "id": "credential-hub", "active": true }
```

这说明菜单项与图标已注册并激活。**渲染后的视觉验收没有完成**：本次没有使用浏览器
自动化，GUI URL `http://127.0.0.1:62232` 需要会话鉴权；详见
[`ui-verification.md`](./ui-verification.md)。请在 GUI 刷新后打开
Settings → 凭据路由中枢，按该文档的检查项做一次浅色/深色人工确认。

## 未覆盖 / 需要真实环境验证

- 真实生产 SSH 主机的日志内容、真实 GitHub API 的响应字段；
- 带口令的私钥、SSH 密码认证（当前明确不支持，见 README 已知限制）；
- Windows 上的 OpenSSH 路径与 `known_hosts` 行为（代码使用 `sshBinary` 配置，未在 Windows 实测）；
- 大规模清单下的匹配性能（当前为线性扫描，清单通常很小）。
