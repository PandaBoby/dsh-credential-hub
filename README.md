# dsh-credential-hub

> **English summary:** A DSH plugin that routes SSH hosts and PAT tokens by tag, keeps
> credential values out of prompts and tool results, supports write-only values in Settings,
> and can sync machines with an AES-256-GCM encrypted import/export bundle. The setup and
> security details below are in Chinese.
>
> Status: 0.2.0, tested with DSH 0.2.2-rc.3. Repository:
> <https://github.com/PandaBoby/dsh-credential-hub>.

DSH 的**凭据路由中枢**：维护一份 SSH 主机清单和一份 PAT 令牌清单，每条记录带 `alias`、`tags`、`description` 和 `credentialRef`。模型在对话里说“去生产环境看下 web 日志”或“用生产令牌查一下 GitHub 仓库状态”时，按标签匹配到记录，再由 Host 侧的 SSH / HTTP 工具通过 `ctx.credentials` 解析私钥或令牌并直接使用。

提示词里只有元数据，工具结果里永远没有明文值。

- 无构建步骤：`index.js` + `src/*` 是 Host 插件，`client.js` 是设置页。
- 设置页：**Settings → 凭据路由中枢**，管理 SSH/PAT 记录与运行配置，并可直接写入 write-only 的凭据值；高级用户仍可直接编辑 YAML。
- 无模型调用做匹配：匹配是本地、确定性的标签/描述模糊匹配。
- 无 SSH 密码/口令处理：私钥写入 0600 临时文件后交给系统 `ssh`，结束即删除。

## 要求

- DSH >= 0.2.2-rc.1（在 0.2.2-rc.3 实测）。
- 一个挂载了凭据服务（例如 `@deepseek-ai/dsh-credentials-local`）的 profile。
- Node.js >= 20；使用 DSH 自带运行时即可。
- SSH 功能需要系统 `ssh` 客户端（OpenSSH）。

## 快速开始

### 1. 安装插件

桌面端：**设置 → 插件 → 添加插件 → 安装本地插件目录**，选择本目录。

命令行（自定义 profile）：

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-credential-hub
```

安装后 bundle 会插入一行 `credential-hub`，默认配置见 [`cordis.patch.yml`](./cordis.patch.yml)。

插件 `inject` 了 `tools`、`credentials`、`systemPrompt`。如果 profile 没有挂载凭据服务
（例如 shipped `headless` 模板默认禁用 `@deepseek-ai/dsh-credentials-local`），插件会停在
`pending (waiting for service: credentials)`，而不是假装清单可用。桌面 profile 默认已有凭据服务。

### 2. 写入清单

桌面端打开 **Settings → 凭据路由中枢**，在“SSH 主机”或“PAT 令牌”页签点“新增记录”。
也可以直接编辑 YAML（默认路径）：

```text
$DSH_HOME/credential-hub/inventory.yml
# 通常是 ~/.dsh/credential-hub/inventory.yml
```

文件不存在时插件会创建一个 0600 的空清单（目录 0700）。示例见
[`examples/inventory.example.yml`](./examples/inventory.example.yml)。

```yaml
version: 1

ssh:
  - alias: prod-web-01
    tags: ["env:production", "service:web"]
    description: 生产环境 Web 应用主机
    host: 10.0.0.10
    port: 22
    username: deploy
    credentialRef: SSH_PROD_WEB_KEY

pat:
  - alias: github-prod-token
    tags: ["platform:github", "env:production"]
    description: GitHub 生产环境令牌
    platform: github
    baseUrl: https://api.github.com
    authScheme: bearer
    credentialRef: PAT_GITHUB_PROD
```

可选配置字段：

| 记录 | 字段 | 说明 |
|---|---|---|
| 通用 | `alias` | 全局唯一（ssh + pat 合计），`[A-Za-z0-9][A-Za-z0-9._-]{0,63}` |
| 通用 | `tags` | 字符串数组，最多 32 个；推荐 `env:*`、`service:*`、`platform:*` |
| 通用 | `description` | 人类可读描述，≤500 字符 |
| 通用 | `credentialRef` | DSH 凭据引用；**只写引用名，不写值** |
| SSH | `host` / `username` | 必填；`port` 可选，默认 22 |
| PAT | `platform` | 可选，如 `github`、`gitlab` |
| PAT | `baseUrl` | 可选但强烈推荐；PAT 只发往这个 origin |
| PAT | `authScheme` | `bearer`（默认）、`token`、`basic`、`header` |
| PAT | `headerName` | `header` 模式必填；`bearer`/`token`/`basic` 默认 `Authorization` |
| PAT | `username` | `basic` 模式必填（Basic 的冒号左侧） |

### 3. 存真实值，清单只留引用

真实私钥/令牌放在 DSH 凭据存储里（与 `DEEPSEEK_API_KEY` 同一个 seam）：

- 在 **Settings → 凭据路由中枢** 新增/编辑记录时，直接在“凭据值”字段粘贴私钥或 PAT 并保存；该字段是 write-only，值只写入 DSH 凭据存储，不写进清单，也不会回显；或
- 打开 **Settings → 账户（Account）** 的凭据/API Key 区域，新增 `SSH_PROD_WEB_KEY`、`PAT_GITHUB_PROD` 等条目；如果当前版本没有对应入口，用下面的 `ctx.credentials.set` 或启动环境变量；或
- 在受信任的 Host 插件里调用：

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'

await ctx.credentials.set(credentialRef('SSH_PROD_WEB_KEY'), await readFile('id_ed25519', 'utf8'))
await ctx.credentials.set(credentialRef('PAT_GITHUB_PROD'), 'github_pat_...')
```

- 测试或 CI 可用启动环境变量作为后备：`SSH_PROD_WEB_KEY=... PAT_GITHUB_PROD=... dsh ...`。
  存储值优先于环境值；轮换存储值下一次操作立即生效。

**不需要把密钥写进清单。** 清单校验会拒绝 `privateKey`、`token`、`password`、`secret`、`passphrase` 等字段，并提示改用 `credentialRef`；如果用户要求“把密钥直接写进清单方便一点”，请拒绝并解释下面的安全模型。

## 兼容性：两个命名约束

DSH 当前版本有两处容易踩坑的命名约束：

1. **`credentialRef` 是 POSIX 标识符，不是路径。** `@deepseek-ai/dsh-credentials` 的语法是
   `^[A-Za-z_][A-Za-z0-9_]*$`。因此 `ssh/prod-web-key`、`pat/github-prod` 会被
   `ctx.credentials.resolve()` 拒绝；请使用 `SSH_PROD_WEB_KEY`、`PAT_GITHUB_PROD`。
   带斜杠的 `<scope>/<id>` 是 **credentialKey/record** 的语法，不是本插件使用的 ref。
2. **提示词变量名必须是 `[a-z][a-z0-9_]*`。** 写成 `sshInventorySummary` /
   `patInventorySummary` 会因大写字母被 `ctx.systemPrompt.variable()` 拒绝；插件注册的是
   `ssh_inventory_summary` / `pat_inventory_summary`，提示词段使用这两个占位符。

提示词段 order 取 **3200**：当前第一方工具指导段落在 1000–3100（tool bash → MCP servers），
200 会把凭据概览放在工具说明**之前**。3200 落在工具指导之后、`TOOLS_SDK`（5000）之前，
符合“先工具说明、再凭据概览”的意图。

## 设置页面

设置窗口左侧会出现 **凭据路由中枢**（order 30，位于“会话归档”之后、“插件”之前），
使用插件自己的盾+钥匙图标。页面有四个页签：

| 页签 | 能做什么 |
|---|---|
| SSH 主机 | 新增/编辑/删除主机记录：alias、tags、description、host/port/username、credentialRef，以及 write-only 凭据值 |
| PAT 令牌 | 新增/编辑/删除令牌记录：alias、tags、description、platform/baseUrl、高级请求头格式、credentialRef，以及 write-only 凭据值 |
| 导入 / 导出 | 导出 AES-256-GCM 加密包（清单 + 已配置凭据值），或解密导入并合并/替换 |
| 运行配置 | 修改提示词概览开关、概览上限、SSH/HTTP 超时、loopback HTTP、PAT 跨 origin、重定向、host key 校验 |

交互细节：

- 记录列表支持搜索（alias/标签/描述/ref/主机/平台）和刷新；空清单/无匹配都有明确的空状态。
- 每条记录显示 `credentialRef` 的 **已配置 / 未配置 / 引用无效** 徽标与来源，不显示值；
  未配置时可在编辑器的“凭据值”字段直接写入，或去 **Settings → 账户** 填值（或 `ctx.credentials.set` / 启动环境变量）；引用无效时在行内显示原因。
- 编辑器里的“凭据值”字段是 **write-only**：`type=password`，保存时通过鉴权路由调用
  `ctx.credentials.set()`，响应只含配置状态；值不进入清单、日志或任何回包。留空表示不修改已有值。
- 删除会展开独立的确认行（确认按钮短暂防双击，可取消），不会静默删除。
- 保存普通配置字段通过 `configEditor` 写入用户 patch 层；插件行会重启以应用配置，
  页面会提示“配置已提交，插件正在重启”。
- 清单写入是串行化的原子替换（临时文件 + rename，0600）；写入后会重新校验并加载。
- 页面只调用 `/api/credential-hub/state` 与 `/api/credential-hub/action`；两者都走
  DSH Connection 的鉴权与 Host/Origin 栅栏。UI 的 `save-record` 输入会拒绝
  `privateKey`/`token`/`password` 等 secret 字段；凭据值只通过 `set-credential` 或加密 `import-bundle` 动作写入，不混入清单保存请求。

> 安装或更新 `client.js` 后刷新一次 Web 页面（或重启 DSH），让浏览器加载新的 Client 模块；
> Host 侧工具可以热重载，但浏览器模块不一定随插件行一起更新。
>
> 本次改动未做浏览器截图验收；Client 模块加载、槽位注册、Host 路由和加密逻辑由单测/检查覆盖，
> 渲染后的浅色/深色视觉仍需在 GUI 中刷新后人工确认。检查表见
> [`docs/ui-verification.md`](./docs/ui-verification.md)。

### 加密导入 / 导出

“导入 / 导出”页签用于换机同步：

- **导出**：Host 读取清单和每个引用已配置的凭据值，在 Host 内加密后只把密文返回
  浏览器下载为 `credential-hub-*.dshcredhub.json`。浏览器不会收到明文凭据。
- **导入**：浏览器把密文文件和口令发给 Host；Host 解密、校验格式和清单后才写入。
  `合并` 保留现有记录、同 alias 由导入记录覆盖；`替换` 清空当前清单后写入导入清单。
  `替换` 不会删除凭据存储里已存在、但不再被引用的旧条目。
- **口令**：至少 8 位；不保存、不回显。丢失后无法解密文件。
- **算法**：scrypt（N=32768, r=8, p=1）派生 256-bit key，AES-256-GCM 加密，
  随机 16-byte salt / 12-byte IV，AAD 绑定格式版本；口令长度足够时，错误口令与
  篡改文件统一报错，过短口令先在入口拒绝。
- **信封格式**：`format=dsh-credential-hub.encrypted`、`version=1`，`kdf` 与
  `cipher` 记录算法参数，密文放在 `payload`（base64）；导入只接受同格式版本。
  信封里没有口令或明文凭据。
- **文件本身仍是机密**：拿到文件和口令就能还原全部凭据。通过可信通道传输，导入后删除
  临时文件；不要把它放进公开仓库或聊天记录。只导入自己导出的包：导入的
  `description`/`tags` 会进入提示词，和手工编辑清单同一边界。

## 工作原理

```text
inventory.yml ──metadata──> system prompt section + credential_hub_match
      │
      └──credentialRef──> credential_hub_ssh_exec / credential_hub_pat_request
                                  │
                                  └── ctx.credentials.resolve()  (Host only)

Settings UI ──authenticated routes──> inventory CRUD / config
                                  └── ctx.credentials.set() / encrypted bundle
```

清单只存 ref；值由 DSH 凭据服务保管。SSH/PAT 工具在 Host 侧解析值后直接交给 `ssh` 或
`fetch`，模型只能看到元数据、退出状态、脱敏后的输出。设置页可以 write-only 写入值，
也可以通过 Host 侧加密包导出/导入。

## 工具

| 工具 | 作用 | 是否接触凭据值 |
|---|---|---|
| `credential_hub_match` | 按自然语言线索匹配清单，返回 `alias`、`kind`、`tags`、`description`、`credentialRef` 等元数据；零匹配返回 `[]` | **否** |
| `credential_hub_resolve` | 检查某个 ref 是否已配置、来源、是否可写、哪些 alias 使用它；返回值固定掩码 `••••••••` | 只调用 `describe`/`resolve` 做存在性检查，**丢弃值** |
| `credential_hub_ssh_exec` | 用匹配到的 SSH alias 在远端执行一条命令；Host 内部解析私钥并交给系统 `ssh` | 值只在 Host 内存/0600 临时文件中 |
| `credential_hub_pat_request` | 用匹配到的 PAT alias 发一个 HTTP 请求；Host 内部解析令牌并附加认证头 | 值只在 Host 请求头中 |

### 典型轨迹

```text
用户：去生产环境看下 web 日志
→ credential_hub_match({ query: "生产环境 web 日志", kind: "ssh" })
← [{ alias: "prod-web-01", kind: "ssh", tags: ["env:production","service:web"], ... }]
→ credential_hub_ssh_exec({ alias: "prod-web-01", command: "tail -n 20 /var/log/web/app.log" })
← ssh prod-web-01 ... exit 0 ... <日志>
```

```text
用户：用生产令牌查一下 GitHub 仓库状态
→ credential_hub_match({ query: "GitHub 生产令牌", kind: "pat" })
← [{ alias: "github-prod-token", kind: "pat", ... }]
→ credential_hub_pat_request({ alias: "github-prod-token", path: "/repos/acme/web" })
← 200 OK ... {"status":"healthy", ...}
```

### 匹配规则

- 大小写不敏感；ASCII 单词、CJK 2–4 字 n-gram、标签键值（`env:production` → `env` + `production`）都参与匹配。
- 内置中英同义词：`生产/线上/prod` → `production`，`测试/预发/stage` → `staging`，
   `服务器/主机/ssh` → `ssh`，`令牌/token/pat` → `pat`，`仓库/github` → `github` 等。
- **环境一致**：查询出现 `生产`/`测试` 等环境词时，带不同 `env:*` 标签的记录会被排除；
  没有 `env` 标签的记录视为环境未知，仍可匹配。
- **动作/平台推断 kind**：`日志/命令/服务器` 倾向 SSH，`令牌/接口/GitHub/仓库` 倾向 PAT；
  显式传 `kind` 时以参数为准。查询只含“令牌/服务器”等 kind 词时返回该 kind 的全部记录。
- 弱共享片段（如只有 `环境` 两字命中）不会把无关记录带进结果；匹配不到就返回 `[]`，
  模型可依据提示词中的清单换词重试。
- 多条匹配时全部返回，按分数降序；模型根据 `alias`/`tags`/`description` 选择。

## 系统提示词段

`ctx.systemPrompt.section({ name: 'credential-hub', order: 3200, ... })` 贡献一段概览，
并通过两个变量动态生成清单摘要：

- `ssh_inventory_summary`
- `pat_inventory_summary`

每行只包含：

```text
- prod-web-01｜tags: env:production, service:web｜生产环境 Web 应用主机｜credentialRef: SSH_PROD_WEB_KEY
```

不包含 host、port、username、baseUrl，更不包含任何值。描述里的 `{{...}}` 会被转义为
`{ {...} }`，避免被当成提示词变量导致组装失败。清单编辑出错时，提示词保留上一次
可用的元数据并附一句“最近一次修改无法解析”；工具调用会返回具体校验错误。YAML 解析错误只报
行号/列号与错误码，不回显源行，避免把误粘贴的密钥带进日志或工具结果。

## 安全模型

1. **清单只携带引用，不携带机密。** 与 `dsh-credentials` 的 doctrine 一致：`inventory.yml`
   可截图、可提交，轮换密钥不需要改清单。唯一的例外是用户主动导出的**加密包**，
   它包含加密后的凭据值，必须按机密文件保管。
2. **提示词只含元数据。** `credential_hub_match` 根本不调用 `ctx.credentials`；
   `credential_hub_resolve` 只报告存在性，返回固定掩码，提供商自己的 `masked` 预览也不透传。
3. **值只在 Host 侧按操作解析。** `credential_hub_ssh_exec` / `credential_hub_pat_request`
   在 `execute` 内调用 `ctx.credentials.resolve()`，把值直接交给系统 `ssh` 或 `fetch`；
   不经过模型可见的工具返回通道。
   设置页的“凭据值”字段同样只做 write-only 写入：浏览器 → 鉴权路由 → `ctx.credentials.set()`，
   响应、清单、日志和提示词都不包含该值。
4. **结果二次脱敏。** 远端命令可能回显密钥，上游可能回显令牌。SSH 的 stdout/stderr 与
   PAT 的响应体都会按“原始值 / URL 编码 / base64 / Basic `user:secret` / PEM 每一行”
   替换为 `••••••••` 后再返回。
5. **PAT 不跨 origin。** 默认只向记录 `baseUrl` 的 origin 发令牌；`url` 参数跨 origin 会拒绝。
   重定向默认不跟随（返回 3xx 与 `location`），避免 `Authorization` 被带到别的域。
   `baseUrl` 不得内嵌用户名/密码，也不得带 query/fragment。
6. **明文 HTTP 只允许 loopback。** `127.0.0.1` / `::1` / `localhost` 可走 HTTP 方便本地网关；
   其它地址必须 HTTPS。
7. **临时私钥 0600、结束即删。** 私钥写入 `mkdtemp` 目录下的 0600 文件，`ssh` 通过 `-i`
   读取；进程结束后 `rm -rf` 临时目录。密钥不进入 argv 或环境变量。
8. **清单 0600。** 文件存在但权限过宽时插件会收敛到 0600 并告警。注意这与
   `dsh-credentials-local` 的边界相同：agent 工具进程以同一 OS 用户运行，文件权限
   阻止的是其他 OS 用户，不是模型本身；真正的边界是“值不进入模型可见通道”。
9. **加密包的明文只在 Host 内存。** 导出时 Host 读取值并加密，浏览器只收密文；
    导入时 Host 解密、校验后写入，响应只含数量与失败 ref 名。口令和明文都不写日志、
    不回显、不写入清单；AES-GCM 认证失败不会返回部分明文。
10. **清单是受信任的本机配置。** `description`/`tags` 会进入系统提示词，`host`/`baseUrl`
   会进入匹配结果；不要把来自不可信第三方的 `inventory.yml` 直接同步进来，否则
   描述文字本身就构成提示词注入面。

### 明确拒绝的请求

如果用户要求把私钥或 PAT 直接写进 `inventory.yml`，**拒绝**，并说明：

- 清单会被同步、备份、截图或提交，一旦写入明文就绕过了 DSH 的凭据 seam；
- 轮换时需要改清单，容易留下旧副本；
- 正确的做法是通过设置页的 write-only 字段或 `ctx.credentials.set(credentialRef('...'), value)` 写入 DSH 凭据存储，清单只保留引用名。

## 配置

`cordis.patch.yml` 的 row config（也可在 profile 用户 patch 层覆盖）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `inventoryPath` | `''` | 空表示 `$DSH_CREDENTIAL_HUB_INVENTORY` 或 `$DSH_HOME/credential-hub/inventory.yml` |
| `promptSection` | `true` | 是否注入元数据概览 |
| `maxPromptEntriesPerKind` | `20` | 概览每类最多列多少条；匹配仍看全部 |
| `sshTimeoutMs` | `60000` | SSH 命令默认超时 |
| `httpTimeoutMs` | `30000` | PAT 请求默认超时 |
| `maxOutputBytes` | `65536` | stdout/stderr 每路上限 |
| `maxHttpResponseBytes` | `262144` | 响应体上限 |
| `allowLoopbackHttp` | `true` | 允许 loopback 明文 HTTP |
| `allowCrossOriginPat` | `false` | 允许 PAT 跨 origin（危险） |
| `followRedirects` | `false` | 是否自动跟随重定向（可能泄露令牌） |
| `sshBinary` | `ssh` | OpenSSH 客户端路径 |
| `sshConfigFile` | `''` | 空表示不传 `-F`；测试可指向临时文件 |
| `sshKnownHostsFile` | `''` | 空表示用户默认 `known_hosts` |
| `sshStrictHostKeyChecking` | `accept-new` | `yes` / `accept-new` / `no` |
| `sshConnectTimeoutMs` | `10000` | SSH 连接超时 |

设置页只编辑 `promptSection`、`maxPromptEntriesPerKind`、`sshTimeoutMs`、
`httpTimeoutMs`、`allowLoopbackHttp`、`allowCrossOriginPat`、`followRedirects`、
`sshStrictHostKeyChecking` 这 8 个字段；`inventoryPath`、`maxOutputBytes`、
`maxHttpResponseBytes`、`sshBinary`、`sshConfigFile`、`sshKnownHostsFile`、
`sshConnectTimeoutMs` 通过 profile patch / YAML 修改。

## 测试

```sh
npm ci
npm run check
npm test
```

`npm test` 会先跑语法门禁，再跑单测。也可以单独运行：

```sh
npm run test:unit
npm run test:security
```

加密包的专项覆盖：

- AES-256-GCM/scrypt 往返、错误口令、密文/标签篡改、弱口令、非法 KDF 参数；
- 导出响应和清单文件不含明文；导入后合并/替换结果与凭据写入正确；
- 解密/格式/清单校验失败前不写清单；导入包里夹带的 secret 字段被拒绝；
  凭据写入失败会报告失败 ref（此时清单已提交）。

覆盖：

- 清单解析/校验（含拒绝明文密钥字段、拒绝斜杠 ref、权限 0600、坏编辑保留快照）；
- 匹配（场景 A/B、环境一致、kind 推断、弱片段不误伤、零匹配空数组）；
- 提示词（order、变量名、只含元数据、坏编辑降级）；
- 工具输出 schema 校验（含 `signal: null` / `exitCode: null` 的 oneOf）；
- 安全边界（prompt、match、resolve、SSH、PAT 输出与错误中都没有密钥/令牌）；
- PAT 跨 origin、重定向、`allowLoopbackHttp` 开关、认证头注入、响应回显脱敏；
- 设置页 write-only 凭据值：`ctx.credentials.set()` 写入、响应/清单/日志不含值；
- 加密导入/导出：AES-256-GCM/scrypt、错误口令/篡改、合并/替换、响应无明文；
- 设置服务：清单 CRUD、0600 原子写入、secret 字段拒绝、凭据状态脱敏、配置编辑器；
- 设置路由：GET/POST、200/400/404/409、provider 错误脱敏、响应中无 secret；
- Client 契约：bundle id、inject、section/icon 注册、zh/en 字典 key 对齐；
- SSH 真实 `ssh` 进程 + 本地 mock SSH server 的公钥认证（可选 live）。

### Live 验收

```sh
# 一次性：创建一个一次性 profile 并安装本插件
dsh --profile credhub-test --from-default-profile headless --help
dsh plugin --profile credhub-test add "$PWD"

# 跑真实模型 + 真实 ssh 客户端 + 本地 mock SSH/HTTP 端点
npm run test:live
```

`test/live-scenarios.mjs` 只有在 `npm run test:live`（带 `--live`）时才会执行；`npm test`
不会启动真实 DSH。它会启动本地 mock SSH server 与 mock PAT server，生成一次性
私钥和 PAT，写入临时清单，然后以 `headless` 模式跑两个真实用户语句。它需要当前 DSH
能访问模型（`DEEPSEEK_API_KEY` 在凭据存储或启动环境中）；shipped `headless` 模板默认禁用
凭据服务，脚本会用 `--patch` 临时启用 `credentials-local`。它验证的是：

- 模型确实调用 `credential_hub_match` 找到 `prod-web-01` / `github-prod-token`；
- 真实 `ssh` 用 Host 解析出的私钥完成公钥认证；
- 真实 `fetch` 带上 `Authorization: Bearer ...`；
- 模型可见输出中没有私钥/PAT 片段（含 URL 编码、base64、PEM 行）。

验收记录在 [`docs/verification/`](./docs/verification/)，说明见
[`docs/manual-tests.md`](./docs/manual-tests.md)。

> mock 端点不是生产主机，也不是 GitHub。它们只验证路由、凭据解析和脱敏路径；
> 真实业务日志或仓库数据取决于你接入的真实端点。

## 故障排查

**插件停在 `pending (waiting for service: credentials)`**
：当前 profile 没挂载凭据服务。桌面 profile 通常自带；自定义/headless profile 需要
挂载 `@deepseek-ai/dsh-credentials-local` 或等价服务，然后再启用插件。

**`credentialRef` 报语法错误**
：ref 必须是 POSIX 标识符，例如 `SSH_PROD_WEB_KEY`，不能是 `ssh/prod-key` 或路径。
错误信息会尽量不回显你粘贴的值。

**SSH 认证失败**
：本插件只支持无口令私钥；`BatchMode=yes` 不会弹密码提示。检查 `sshBinary`、
`sshKnownHostsFile` 和主机指纹策略；不要把私钥粘贴到对话里，改用设置页或
`ctx.credentials.set()` 写入。

**PAT 返回 401/403**
：先确认 `baseUrl` 的 origin 正确，再检查 `authScheme`/`headerName`。GitHub PAT 通常用
Bearer；GitLab 常用 `PRIVATE-TOKEN` 自定义头；有些服务使用 Basic。不要为了排错把令牌
发到公开的请求回显服务。

**导入失败**
：错误口令和损坏文件会统一报“wrong passphrase or corrupted bundle”；只接受当前版本的
`.dshcredhub.json`。解密或校验失败不会写清单；清单写入后若凭据写入失败，会报告失败的
ref。替换模式会清空当前清单，操作前请确认，或先用合并模式并保留备份。

**设置页改了但界面没变**
：Client 模块由浏览器加载，刷新 Web 页面或重启 DSH；Host 代码变更通常需要重新加载
插件行。检查浏览器控制台是否有 `settings.section` 相关的 React 错误。

**导出没有开始下载**
：检查浏览器是否拦截下载；刷新后重试。不要把导出的密文文件或口令贴进 issue。

## 开发

```sh
npm ci
npm run check   # 逐个文件 node --check
npm test        # check + 单测/路由/安全测试
npm run test:live  # 可选：真实 DSH + 模型 + 本地 mock SSH/HTTP
```

仓库包含 `.github/workflows/ci.yml`，在 Node 20/22/24 上执行 `npm ci`、语法门禁和单测；
live 验收不会在 CI 里跑。

代码是无构建步骤的 ESM：Host 在 `index.js` + `src/`，设置页在 `client.js`。修改
Client 后需要刷新页面让浏览器重新加载模块。测试使用临时目录和假凭据；不要提交真实
`inventory.yml`、`*.dshcredhub.json`、`.env` 或 `node_modules`。

## 已知限制

- **不支持 SSH 密码认证或带口令的私钥。** `BatchMode=yes` + `IdentitiesOnly=yes`，
  需要无口令私钥；带口令的 key 会失败而不是弹提示。需要密码认证时另做 askpass 方案。
- **不做 SSH 主机指纹持久化管理。** 默认 `accept-new` 使用用户默认 `known_hosts`；
  高安全环境请设为 `yes` 并预先维护 known_hosts。
- **PAT 是通用 HTTP 客户端。** 它按记录 `baseUrl` 的 origin 发送令牌，但不理解具体 API；
  请求路径与响应体由模型决定。提示词注入仍可能诱导向同 origin 的任意路径发请求。
- **设置页写入凭据值但不读取。** “凭据值”字段是 write-only，保存后无法从本页读回；
  查看/替换仍可通过 **Settings → 账户（Account）** 的凭据区域、`ctx.credentials.set`
  或启动环境变量完成。导出只能得到加密文件，不能在本页查看明文；页面只显示 ref
  是否已配置及来源。
- **加密导出包仍含机密。** 文件是密文，但持有文件和口令即可还原所有已配置凭据；
  口令丢失无法恢复，替换导入不会清理凭据存储中的旧条目。
- **保存运行配置会重启插件行。** 普通字段不是热更新；页面会提示重启，面板可能短暂重新加载。
- **没有令牌自动轮换/刷新。** 令牌是静态 PAT；轮换在凭据存储侧完成，下一次操作自动生效。
- **Live 验收使用本地测试替身。** 真实的 SSH 主机和 GitHub 令牌需要你提供；
  mock 端点只证明链路与脱敏，不证明生产数据。
- **兼容性以 DSH 0.2.2-rc.3 实测。** 依赖 `ctx.credentials`、`ctx.systemPrompt.section/variable`、
  `defineTool` 的当前契约；升级 DSH 后请先跑 `npm test` 与 live 验收。

## 文件

```text
dsh-credential-hub/
  package.json              # bundle patch + exports + scripts
  cordis.patch.yml          # 插入 credential-hub 行与默认配置
  index.js                  # apply(): 加载清单、提示词、工具、设置路由
  client.js                 # 设置页：settings.section + icon，无构建步骤
  src/
    config.js               # 配置归一化、默认路径、loopback 判断
    inventory.js            # YAML 解析、严格校验、0600、摘要
    matching.js             # 中英标签/描述模糊匹配、kind/环境推断
    hub.js                  # 快照与 mtime 热重载
    prompt.js               # 系统提示词段与两个变量
    settings.js             # 设置页 Host 服务：清单 CRUD、状态、配置编辑、加密导入导出
    settings-routes.js      # 鉴权 /api/credential-hub/{state,action} 路由
    bundle.js               # AES-256-GCM/scrypt 加密导出包
    tools.js                # match / resolve / ssh_exec / pat_request
    ssh.js                  # 系统 OpenSSH 调用、临时私钥、输出脱敏
    pat.js                  # fetch、origin 策略、响应脱敏
    redact.js               # 原始/URL/base64/PEM 行脱敏
    refs.js                 # credentialRef 语法与错误提示
    errors.js               # 稳定错误码
  examples/inventory.example.yml
  locale/{en,zh}.json
  icon.svg
  test/                     # 单测 + 安全测试 + 加密包测试 + 本地 mock + live 验收
  docs/verification/        # 三个场景的实测轨迹与安全扫描
  docs/manual-tests.md      # 场景 A/B/C 记录
  docs/ui-verification.md   # 设置页菜单注册、路由测试与人工视觉检查项
  README.md
  CONTRIBUTING.md           # 开发、测试、PR 约定
  CODE_OF_CONDUCT.md        # 社区行为准则
  SECURITY.md               # 漏洞报告与威胁边界
  CHANGELOG.md              # 版本变更
  .editorconfig
  .gitignore
  .github/workflows/ci.yml
  package-lock.json
```

## 参与贡献

见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 和 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。安全漏洞请按 [`SECURITY.md`](./SECURITY.md)
私下报告，不要带密钥或口令开公开 issue。

## 安全报告

见 [`SECURITY.md`](./SECURITY.md)。

## 变更日志

见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 许可证（License）

MIT，见 [`LICENSE`](./LICENSE)。
