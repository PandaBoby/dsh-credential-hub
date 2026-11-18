<div align="center">

<h1>dsh-credential-hub</h1>

<p><strong>DSH 的凭据路由中枢：按标签匹配 SSH 主机与 PAT，凭据值不进入提示词、工具参数或工具结果。</strong></p>

<p><a href="README.md">简体中文</a> · <a href="README.en.md">English</a></p>

<p>
  <a href="https://github.com/PandaBoby/dsh-credential-hub/actions/workflows/ci.yml"><img src="https://github.com/PandaBoby/dsh-credential-hub/actions/workflows/ci.yml/badge.svg?branch=main&amp;style=flat-square" alt="CI status" /></a>
  <a href="https://github.com/PandaBoby/dsh-credential-hub/releases"><img src="https://img.shields.io/github/v/release/PandaBoby/dsh-credential-hub?style=flat-square&amp;label=release" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&amp;logo=node.js&amp;logoColor=white" alt="Node" /></a>
</p>

</div>

---

`dsh-credential-hub` 为 [DeepSeek Harness](https://github.com/deepseek-ai) 提供一层**凭据路由**：
维护 SSH 主机和 PAT 令牌的元数据清单，让模型用自然语言找到正确的 `alias`，再由 Host
在内部解析私钥或令牌并直接交给系统 `ssh` / `fetch`。

清单只保存 `credentialRef`，提示词只包含元数据；设置页支持 write-only 值写入和
AES-256-GCM 加密的换机同步。

<details>
<summary><strong>目录</strong></summary>

- [功能](#功能)
- [要求](#要求)
- [快速开始](#快速开始)
- [工作原理](#工作原理)
- [工具](#工具)
- [匹配与提示词](#匹配与提示词)
- [加密同步](#加密同步)
- [配置](#配置)
- [安全模型](#安全模型)
- [故障排查](#故障排查)
- [开发与测试](#开发与测试)
- [已知限制](#已知限制)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

</details>

## 功能

- **按标签路由：** 中英文标签、描述、alias、主机/平台字段参与匹配；环境词（生产/测试）不会串台。
- **元数据提示词：** 系统提示词只列 alias、tags、description、credentialRef，不列 host、port 或密钥。
- **Host 侧解析：** SSH/PAT 工具在 Host 内部读取凭据；值不进入工具参数、工具结果或模型上下文。
- **设置页管理：** 记录 CRUD、搜索、write-only 凭据值、运行配置，以及加密导入/导出。
- **无构建步骤：** Host 是 ESM，Client 使用 `React.createElement`，安装后无需单独打包。

## 要求

| 组件 | 要求 |
|---|---|
| DSH | `>= 0.2.2-rc.1`；在 `0.2.2-rc.3` 实测 |
| 凭据服务 | profile 需挂载 `@deepseek-ai/dsh-credentials-local` 或等价实现 |
| Node.js | `>= 20`；使用 DSH 自带运行时即可 |
| SSH | 系统 OpenSSH 客户端（SSH 工具需要） |

> 如果 profile 没有挂载凭据服务，插件会停在
> `pending (waiting for service: credentials)`，而不是假装清单可用。

## 快速开始

### 1. 安装

桌面端：**设置 → 插件 → 添加插件 → 安装本地插件目录**，选择本仓库。

命令行（自定义 profile）：

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-credential-hub
```

安装后 bundle 会插入一行 `credential-hub`，默认配置见
[`cordis.patch.yml`](cordis.patch.yml)。

### 2. 添加记录

打开 **Settings → 凭据路由中枢**，在“SSH 主机”或“PAT 令牌”页签新增记录。
也可以直接编辑 YAML：

```text
$DSH_HOME/credential-hub/inventory.yml
# 通常是 ~/.dsh/credential-hub/inventory.yml
```

文件不存在时插件会创建 0600 的空清单，目录为 0700。示例见
[`examples/inventory.example.yml`](examples/inventory.example.yml)。

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

| 字段 | 说明 |
|---|---|
| `alias` | 全局唯一，`[A-Za-z0-9][A-Za-z0-9._-]{0,63}` |
| `tags` | 字符串数组，最多 32 个；推荐 `env:*`、`service:*`、`platform:*` |
| `description` | 人类可读描述，最多 500 字符 |
| `credentialRef` | DSH 凭据引用；**只写引用名，不写值** |
| SSH `host` / `username` | 必填；`port` 可选，默认 22 |
| PAT `baseUrl` | 可选但强烈推荐；PAT 只发往这个 origin |
| PAT `authScheme` | `bearer`（默认）、`token`、`basic`、`header` |
| PAT `headerName` / `username` | `header` / `basic` 模式必填对应字段 |

### 3. 写入真实值

真实私钥/令牌放在 DSH 凭据存储里，清单只保留引用：

- 设置页的“凭据值”字段是 **write-only**：粘贴后只写入凭据存储，不回显、不写清单；
- 也可以在 **Settings → 账户（Account）** 的凭据区域配置；
- 或在受信任的 Host 插件中调用 `ctx.credentials.set()`：

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'

await ctx.credentials.set(credentialRef('SSH_PROD_WEB_KEY'), await readFile('id_ed25519', 'utf8'))
await ctx.credentials.set(credentialRef('PAT_GITHUB_PROD'), 'github_pat_...')
```

测试或 CI 可用启动环境变量作为后备：`SSH_PROD_WEB_KEY=... PAT_GITHUB_PROD=... dsh ...`。
存储值优先于环境值，轮换后下一次操作立即生效。

> **不要把私钥或 PAT 写进 `inventory.yml`。** 清单校验会拒绝 `privateKey`、`token`、
> `password`、`secret`、`passphrase` 等字段。

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

清单只存引用；值由 DSH 凭据服务保管。SSH/PAT 工具在 Host 侧解析值后直接交给 `ssh` 或
`fetch`；模型只能看到元数据、退出状态和脱敏后的输出。

### 两个命名约束

1. **`credentialRef` 是 POSIX 标识符。** 语法为 `^[A-Za-z_][A-Za-z0-9_]*$`；
   `ssh/prod-key` 会被拒绝，请使用 `SSH_PROD_WEB_KEY`。
2. **提示词变量名必须是小写加下划线。** 插件注册 `ssh_inventory_summary` 和
   `pat_inventory_summary`，不是 camelCase。

提示词段 order 为 **3200**：当前第一方工具指导段落在 1000–3100，3200 位于工具说明之后、
`TOOLS_SDK`（5000）之前，符合“先工具说明、再凭据概览”的顺序。

## 工具

| 工具 | 作用 | 是否接触凭据值 |
|---|---|---|
| `credential_hub_match` | 按自然语言线索匹配记录，返回元数据；零匹配返回 `[]` | 否 |
| `credential_hub_resolve` | 报告 ref 是否已配置、来源和可写性，返回固定掩码 | 只检查存在性，丢弃值 |
| `credential_hub_ssh_exec` | 用 alias 在远端执行一条命令；Host 内部解析私钥 | 值只在 Host 内存和 0600 临时文件 |
| `credential_hub_pat_request` | 用 alias 发 HTTP 请求；Host 内部附加认证头 | 值只在 Host 请求头 |

### 典型轨迹

```text
用户：去生产环境看下 web 日志
→ credential_hub_match({ query: "生产环境 web 日志", kind: "ssh" })
← [{ alias: "prod-web-01", kind: "ssh", tags: ["env:production","service:web"], ... }]
→ credential_hub_ssh_exec({ alias: "prod-web-01", command: "tail -n 20 /var/log/web/app.log" })
← ssh prod-web-01 ... exit 0 ... <脱敏后的日志>
```

## 匹配与提示词

- 大小写不敏感；ASCII 单词、CJK 2–4 字 n-gram、标签键值都参与匹配。
- 内置中英同义词：`生产/线上/prod` → `production`，`测试/预发/stage` → `staging` 等。
- 查询出现环境词时，带不同 `env:*` 标签的记录会被排除；没有 `env` 标签的记录视为环境未知。
- 动作/平台词会推断 kind；显式传 `kind` 时以参数为准。
- 多条匹配按分数降序全部返回，由模型根据 `alias`、`tags`、`description` 选择。

系统提示词每行只包含：

```text
- prod-web-01｜tags: env:production, service:web｜生产环境 Web 应用主机｜credentialRef: SSH_PROD_WEB_KEY
```

描述里的 `{{...}}` 会被转义，避免被当成提示词变量。清单解析失败时保留上一次可用快照，
并提示“最近一次修改无法解析”；YAML 错误只报行列与错误码，不回显源行。

## 加密同步

“导入 / 导出”页签用于换机同步：

| 操作 | 行为 |
|---|---|
| 导出 | Host 读取清单和已配置的凭据值，在 Host 内加密，只把密文返回浏览器下载 |
| 合并导入 | 保留当前记录；同一 alias 由导入记录覆盖 |
| 替换导入 | 清空当前清单后写入导入清单；不会删除凭据存储中的旧条目 |

- 口令至少 8 位，不保存、不回显；丢失后无法解密。
- 算法：scrypt（`N=32768, r=8, p=1`）派生 256-bit key；AES-256-GCM；随机 16-byte salt
  和 12-byte IV；AAD 绑定格式版本。
- 信封字段：`format=dsh-credential-hub.encrypted`、`version=1`、`kdf`、`cipher`、
  `payload`（base64 密文）。导入只接受同格式版本。
- 解密/格式/清单校验失败时不会写清单；清单写入后若凭据写入失败，会报告失败的 ref。
- **文件本身仍是机密**：拿到文件和口令就能还原全部凭据。请通过可信通道传输，导入后删除
  临时文件，只导入自己导出的包。

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
| `allowLoopbackHttp` | `true` | 允许 loopback 明文 HTTP；设为 `false` 可完全关闭 |
| `allowCrossOriginPat` | `false` | 允许 PAT 跨 origin（危险） |
| `followRedirects` | `false` | 是否自动跟随重定向（可能泄露令牌） |
| `sshBinary` | `ssh` | OpenSSH 客户端路径 |
| `sshConfigFile` | `''` | 空表示不传 `-F` |
| `sshKnownHostsFile` | `''` | 空表示用户默认 `known_hosts` |
| `sshStrictHostKeyChecking` | `accept-new` | `yes` / `accept-new` / `no` |
| `sshConnectTimeoutMs` | `10000` | SSH 连接超时 |

设置页只编辑 `promptSection`、`maxPromptEntriesPerKind`、`sshTimeoutMs`、
`httpTimeoutMs`、`allowLoopbackHttp`、`allowCrossOriginPat`、`followRedirects`、
`sshStrictHostKeyChecking` 这 8 个字段；`inventoryPath`、`maxOutputBytes`、
`maxHttpResponseBytes`、`sshBinary`、`sshConfigFile`、`sshKnownHostsFile`、
`sshConnectTimeoutMs` 通过 profile patch / YAML 修改。

## 安全模型

1. **清单只携带引用。** `inventory.yml` 只保存 `credentialRef`，适合截图和提交；唯一的
   例外是用户主动导出的加密包，它包含加密后的值，必须按机密文件保管。
2. **提示词只含元数据。** `credential_hub_match` 不调用凭据服务；`resolve` 只报告存在性。
3. **值只在 Host 侧解析。** 工具在 `execute` 内调用 `ctx.credentials.resolve()`，把值直接交给
   `ssh` 或 `fetch`；设置页只能 write-only 写入，不能读回明文。
4. **结果二次脱敏。** SSH stdout/stderr 与 PAT 响应体会替换原始值、URL 编码、base64、
   Basic `user:secret` 和 PEM 每一行。
5. **PAT 不跨 origin。** 默认只向记录 `baseUrl` 的 origin 发令牌；重定向默认不跟随。
6. **HTTP 明文限制。** 非 loopback 地址必须 HTTPS；`allowLoopbackHttp=false` 会连 loopback 也拒绝。
7. **临时私钥 0600。** 私钥写入 `mkdtemp` 目录后交给 `ssh -i`，进程结束即删除。
8. **加密包的明文只在 Host 内存。** 导出只返回密文；导入在 Host 解密、校验后写入；
   口令和明文不写日志、不回显。
9. **清单是受信任的本机配置。** `description`/`tags` 会进入提示词；不要同步不可信清单或
   不可信加密包，否则元数据可能构成提示词注入面。

## 故障排查

| 现象 | 处理 |
|---|---|
| 插件停在 `pending (waiting for service: credentials)` | 为 profile 挂载 `@deepseek-ai/dsh-credentials-local` 或等价服务 |
| `credentialRef` 语法错误 | 使用 POSIX 标识符，如 `SSH_PROD_WEB_KEY`；不要带斜杠或路径 |
| SSH 认证失败 | 只支持无口令私钥；检查 `sshBinary`、`sshKnownHostsFile` 和 host key 策略 |
| PAT 返回 401/403 | 检查 `baseUrl`、`authScheme`、`headerName`；GitHub 常用 Bearer，GitLab 常用 `PRIVATE-TOKEN` |
| 导入报错 | 错误口令/损坏文件会统一报错；只接受当前格式版本；解密/校验失败不会写清单 |
| 设置页修改后未生效 | Client 模块需要刷新 Web 页面或重启 DSH；Host 代码变更通常需重载插件行 |
| 导出没有开始下载 | 检查浏览器下载拦截；页面会保留“重新下载”按钮 |

## 开发与测试

```sh
npm ci
npm run check   # 逐个文件 node --check
npm test        # check + 单元/路由/安全测试
npm run test:live  # 可选：真实 DSH + 模型 + 本地 mock SSH/HTTP
```

- CI 在 Node 20/22/24 上执行 `npm ci` 和 `npm test`；live 不会在 CI 中启动。
- 当前测试：**75 pass / 0 fail**，覆盖清单校验、匹配、提示词、工具 schema、脱敏、
  write-only 值、加密包、路由错误分支、provider 错误脱敏、部分凭据写入失败和写文件回滚。
- Host 代码在 `index.js` + `src/`，Client 在 `client.js`；修改 Client 后刷新页面。
- 测试使用临时目录和假凭据；不要提交真实 `inventory.yml`、`*.dshcredhub.json`、`.env`。

详细验收记录见 [`docs/manual-tests.md`](docs/manual-tests.md) 和
[`docs/ui-verification.md`](docs/ui-verification.md)。

## 已知限制

- **不支持 SSH 密码认证或带口令的私钥：** `BatchMode=yes` + `IdentitiesOnly=yes` 需要无口令私钥。
- **不做 SSH 主机指纹持久化管理：** 默认 `accept-new` 使用用户默认 `known_hosts`；高安全环境请设为
  `yes` 并预先维护。
- **PAT 是通用 HTTP 客户端：** 它按 `baseUrl` 的 origin 发令牌，但不理解具体 API；请求路径由模型决定。
- **设置页写入凭据值但不读取：** 值保存后无法从本页读回；导出只能得到加密文件。
- **加密包仍含机密：** 持有文件和口令即可还原已配置凭据；口令丢失无法恢复，替换导入不会清理旧条目。
- **保存运行配置会重启插件行：** 普通字段不是热更新；页面会提示重启。
- **兼容性以 DSH 0.2.2-rc.3 实测：** 升级 DSH 后请先跑 `npm test` 与 live 验收。

## 参与贡献

- 开发、测试和 PR 约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 社区行为准则见 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。
- 安全漏洞请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要带密钥或口令开公开 issue。
- 版本变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 许可证

MIT，见 [`LICENSE`](LICENSE)。

<div align="center">
<sub>为 DeepSeek Harness 构建 · 元数据路由，值留在 Host。</sub>
</div>
