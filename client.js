/**
 * dsh-credential-hub — Web client half.
 *
 * Registers one Settings section (nav label + optional icon) that manages the
 * metadata inventory: SSH hosts, PAT tokens, the behavior config, and encrypted
 * transfer. Secret values can be written through a write-only field or an
 * encrypted bundle, but are never read back or displayed; each credentialRef
 * shows only "configured / not configured" through the Host route.
 *
 * No build step: this file uses React.createElement and the browser module table.
 */

window.__ModuleLoader__.load({
  id: 'dsh-credential-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'credential-hub'
    const STATE_ROUTE = '/api/credential-hub/state'
    const ACTION_ROUTE = '/api/credential-hub/action'

    const ZH = {
      sectionTitle: '凭据路由中枢',
      title: '凭据路由中枢',
      refresh: '刷新',
      addRecord: '新增记录',
      searchPlaceholder: '搜索 alias、标签、描述或引用',
      tabSsh: 'SSH 主机',
      tabPat: 'PAT 令牌',
      tabConfig: '运行配置',
      tabTransfer: '导入 / 导出',
      exportTitle: '导出',
      importTitle: '导入',
      exportHint: '包含凭据值，AES-256-GCM 加密；口令不保存，丢失无法恢复。',
      importHint: '合并保留现有记录；替换会清空当前清单。',
      passphrase: '口令（至少 8 位）',
      passphraseConfirm: '确认口令',
      exportButton: '下载加密文件',
      working: '处理中…',
      importButton: '解密并导入',
      confirmReplace: '确认替换导入',
      importFile: '加密文件',
      importMode: '导入方式',
      modeMerge: '合并（同 alias 覆盖）',
      modeReplace: '替换（清空当前清单）',
      passphraseTooShort: '口令至少 8 位。',
      passphraseMismatch: '两次口令不一致。',
      fileInvalid: '文件不是有效的 JSON。',
      fileTooLarge: '文件超过 8 MB。',
      fileReadFailed: '无法读取文件。',
      fileRequired: '请选择加密文件。',
      exportDone: '已导出 {ssh} 台主机、{pat} 个令牌、{credentials} 个凭据。',
      importDone: '已导入 {ssh} 台主机、{pat} 个令牌、{credentials} 个凭据。',
      transferTimeout: '请求超时（60 秒）；请重试。',
      downloadAgain: '重新下载',
      downloadFailed: '文件已生成，但浏览器没有开始下载；请点“重新下载”。',
      exportMissingRefs: '未配置：{refs}',
      importFailedRefs: '写入失败：{refs}',
      importIgnored: '忽略 {n} 个未使用的凭据条目。',
      replaceWarning: '替换会清空当前清单，且不会删除旧凭据条目。',
      count: '{n} 条',
      loading: '正在读取清单…',
      loadFailed: '读取失败',
      retry: '重试',
      emptyTitle: '还没有记录',
      addFirst: '新增第一条',
      noMatches: '没有匹配的记录',
      edit: '编辑',
      delete: '删除',
      confirmDelete: '确认删除',
      deleteConfirm: '确认删除 {alias}？',
      deleteConfirmHint: '此操作不可撤销；删除后模型将无法再匹配到该记录。',
      deleteArming: '请稍候…',
      cancel: '取消',
      save: '保存',
      saving: '保存中…',
      newSsh: '新增 SSH 主机',
      newPat: '新增 PAT 令牌',
      editRecord: '编辑记录',
      fieldAlias: '别名',
      fieldTags: '标签',
      fieldDescription: '描述',
      descriptionPlaceholder: '生产环境 Web 应用主机',
      fieldSecret: '凭据值（私钥 / PAT）',
      fieldSecretPlaceholder: '粘贴私钥或令牌；不会显示',
      fieldSecretHint: '留空不修改；只写入凭据存储，不回显。私钥整段粘贴（含 BEGIN/END 行），换行会原样保存。',
      recordSavedWithCredential: '已保存 {alias}，凭据值已写入。',
      credentialWriteFailed: '记录已保存，但凭据值写入失败；请检查凭据存储后重试。',
      fieldRef: 'credentialRef',
      fieldHost: '主机',
      fieldPort: '端口',
      fieldUsername: '登录用户',
      fieldPlatform: '平台',
      fieldBaseUrl: 'Base URL',
      fieldAuthScheme: '请求头格式',
      advancedAuth: '高级：请求头格式',
      fieldHeaderName: '自定义头名',
      fieldBasicUsername: 'Basic 用户名',
      authBearer: 'Bearer（默认）',
      authToken: 'token（GitHub classic）',
      authBasic: 'Basic',
      authHeader: '自定义头',
      statusConfigured: '已配置',
      statusMissing: '未配置',
      enabled: '启用',
      disabled: '停用',
      clearSearch: '清除搜索',
      statusInvalid: '引用无效',
      configuredSource: '来源：{source}',
      target: '目标',
      refLabel: '凭据引用',
      tagsLabel: '标签',
      configTitle: '运行配置',
      configNoEntry: '当前 profile 没有可编辑的插件行；请编辑 cordis.patch.yml。',
      configNoEditor: '当前 profile 未启用 config editor；请编辑 cordis.patch.yml。',
      configRestart: '保存并重启',
      configSaved: '配置已提交，插件正在重启。若面板消失，请重新打开设置。',
      configReloadPending: '配置已提交，但插件重启后暂时无法重新读取；请稍后点击刷新。',
      requestTimeout: '请求超时（10 秒）；请重试。',
      noChanges: '没有检测到配置改动。',
      configPromptSection: '注入系统提示词概览',
      configMaxEntries: '每类概览条目上限',
      configSshTimeout: 'SSH 超时（毫秒）',
      configHttpTimeout: 'PAT 请求超时（毫秒）',
      configAllowLoopback: '允许 loopback 明文 HTTP',
      configAllowCrossOrigin: '允许 PAT 跨 origin',
      configFollowRedirects: '跟随 HTTP 重定向',
      configStrictHostKey: 'SSH host key 校验',
      strictYes: 'yes（严格）',
      strictAcceptNew: 'accept-new（默认）',
      strictNo: 'no（不校验）',
      strictNoWarning: '不校验 host key 会接受任意主机指纹，容易受到中间人攻击。',
      errorTitle: '操作失败',
      requiredFields: '别名、描述和 credentialRef 不能为空。',
      invalidRef: 'credentialRef 必须是 POSIX 标识符，例如 SSH_PROD_WEB_KEY（不能含斜杠或空格）。',
      missingConnectionFields: '请填写主机和登录用户。',
      missingPatAuthFields: '当前认证方式需要补全自定义头名或 Basic 用户名。',
      invalidPort: '端口必须是 1–65535 之间的整数。',
      sshHost: 'SSH 主机',
      patToken: 'PAT 令牌',
      recordSaved: '已保存 {alias}',
      recordDeleted: '已删除 {alias}',
    }

    const EN = {
      sectionTitle: 'Credential hub',
      title: 'Credential hub',
      refresh: 'Refresh',
      addRecord: 'Add record',
      searchPlaceholder: 'Search alias, tags, description or reference',
      tabSsh: 'SSH hosts',
      tabPat: 'PAT tokens',
      tabConfig: 'Runtime config',
      tabTransfer: 'Import / export',
      exportTitle: 'Export',
      importTitle: 'Import',
      exportHint: 'Includes credential values, AES-256-GCM encrypted; the passphrase is not stored and cannot be recovered.',
      importHint: 'Merge keeps current records; replace clears the current inventory.',
      passphrase: 'Passphrase (min 8)',
      passphraseConfirm: 'Confirm passphrase',
      exportButton: 'Download encrypted file',
      working: 'Working…',
      importButton: 'Decrypt and import',
      confirmReplace: 'Confirm replace import',
      importFile: 'Encrypted file',
      importMode: 'Import mode',
      modeMerge: 'Merge (same alias overwrites)',
      modeReplace: 'Replace (clear current inventory)',
      passphraseTooShort: 'Use at least 8 characters.',
      passphraseMismatch: 'The passphrases do not match.',
      fileInvalid: 'The file is not valid JSON.',
      fileTooLarge: 'The file exceeds 8 MB.',
      fileReadFailed: 'Could not read the file.',
      fileRequired: 'Choose an encrypted file.',
      exportDone: 'Exported {ssh} hosts, {pat} tokens, {credentials} credentials.',
      importDone: 'Imported {ssh} hosts, {pat} tokens, {credentials} credentials.',
      transferTimeout: 'Request timed out after 60 seconds; please retry.',
      downloadAgain: 'Download again',
      downloadFailed: 'The file was created, but the browser did not start the download; use “Download again”.',
      exportMissingRefs: 'Not configured: {refs}',
      importFailedRefs: 'Failed to write: {refs}',
      importIgnored: 'Ignored {n} unused credential entries.',
      replaceWarning: 'Replace clears the current inventory and does not delete old credential entries.',
      count: '{n} records',
      loading: 'Reading inventory…',
      loadFailed: 'Could not load',
      retry: 'Retry',
      emptyTitle: 'No records yet',
      addFirst: 'Add the first record',
      noMatches: 'No matching records',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      deleteConfirm: 'Delete {alias}?',
      deleteConfirmHint: 'This cannot be undone; the model will no longer match this record.',
      deleteArming: 'Please wait…',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      newSsh: 'New SSH host',
      newPat: 'New PAT token',
      editRecord: 'Edit record',
      fieldAlias: 'Alias',
      fieldTags: 'Tags',
      fieldDescription: 'Description',
      descriptionPlaceholder: 'Production web app host',
      fieldSecret: 'Credential value (key / PAT)',
      fieldSecretPlaceholder: 'Paste a private key or token; never displayed',
      fieldSecretHint: 'Leave blank to keep the current value; written only to the credential store, never shown. Paste a whole private key, BEGIN/END lines included: its line breaks are kept.',
      recordSavedWithCredential: 'Saved {alias}; credential value stored.',
      credentialWriteFailed: 'Record saved, but the credential value could not be stored; check the credential store and retry.',
      fieldRef: 'credentialRef',
      fieldHost: 'Host',
      fieldPort: 'Port',
      fieldUsername: 'Username',
      fieldPlatform: 'Platform',
      fieldBaseUrl: 'Base URL',
      fieldAuthScheme: 'Header format',
      advancedAuth: 'Advanced: header format',
      fieldHeaderName: 'Header name',
      fieldBasicUsername: 'Basic username',
      authBearer: 'Bearer (default)',
      authToken: 'token (GitHub classic)',
      authBasic: 'Basic',
      authHeader: 'Custom header',
      statusConfigured: 'Configured',
      statusMissing: 'Not configured',
      enabled: 'On',
      disabled: 'Off',
      clearSearch: 'Clear search',
      statusInvalid: 'Invalid reference',
      configuredSource: 'Source: {source}',
      target: 'Target',
      refLabel: 'Credential reference',
      tagsLabel: 'Tags',
      configTitle: 'Runtime config',
      configNoEntry: 'This profile has no editable plugin row; edit cordis.patch.yml.',
      configNoEditor: 'This profile has no config editor; edit cordis.patch.yml.',
      configRestart: 'Save and restart',
      configSaved: 'Config submitted; the plugin is restarting. Reopen Settings if the panel disappears.',
      configReloadPending: 'Config submitted, but the plugin could not be re-read after restart; try Refresh in a moment.',
      requestTimeout: 'Request timed out after 10 seconds; please retry.',
      noChanges: 'No configuration changes detected.',
      configPromptSection: 'Inject the system-prompt overview',
      configMaxEntries: 'Overview entries per kind',
      configSshTimeout: 'SSH timeout (ms)',
      configHttpTimeout: 'PAT request timeout (ms)',
      configAllowLoopback: 'Allow loopback plain HTTP',
      configAllowCrossOrigin: 'Allow PAT cross-origin',
      configFollowRedirects: 'Follow HTTP redirects',
      configStrictHostKey: 'SSH host-key checking',
      strictYes: 'yes (strict)',
      strictAcceptNew: 'accept-new (default)',
      strictNo: 'no (no check)',
      strictNoWarning: 'Disabling host-key checking accepts any fingerprint and is vulnerable to MITM attacks.',
      errorTitle: 'Operation failed',
      requiredFields: 'Alias, description and credentialRef are required.',
      invalidRef: 'credentialRef must be a POSIX identifier such as SSH_PROD_WEB_KEY (no slash or spaces).',
      missingConnectionFields: 'Host and username are required.',
      missingPatAuthFields: 'This auth scheme needs a header name or Basic username.',
      invalidPort: 'Port must be an integer from 1 to 65535.',
      sshHost: 'SSH host',
      patToken: 'PAT token',
      recordSaved: 'Saved {alias}',
      recordDeleted: 'Deleted {alias}',
    }

    const CSS = `
      .credhub-root { display: flex; flex-direction: column; gap: 18px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
      .credhub-root *, .credhub-root *::before, .credhub-root *::after { box-sizing: border-box; }
      .credhub-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .credhub-title { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; }
      .credhub-tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .credhub-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 8px 11px; border-radius: 6px 6px 0 0; cursor: pointer; font: inherit; }
      .credhub-tab:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
      .credhub-tab[aria-pressed="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); box-shadow: inset 0 -2px 0 var(--dsw-alias-brand-primary); }
      .credhub-tab:focus-visible, .credhub-btn:focus-visible, .credhub-input:focus-visible, .credhub-select:focus-visible, .credhub-textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .credhub-toolbar { display: flex; align-items: center; gap: 8px; }
      .credhub-toolbar .credhub-grow { flex: 1 1 auto; min-width: 160px; }
      .credhub-input, .credhub-select, .credhub-textarea { width: 100%; min-height: 30px; padding: 5px 9px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; font: inherit; }
      .credhub-textarea { min-height: 58px; resize: vertical; }
      /* A textarea is the only control that keeps a pasted key's line breaks;
         the disc rule preserves the masking <input type="password"> gave it. */
      .credhub-secret { -webkit-text-security: disc; }
      .credhub-input::placeholder, .credhub-textarea::placeholder { color: var(--dsw-alias-state-idle-primary); }
      .credhub-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 4px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); font: inherit; cursor: pointer; white-space: nowrap; }
      .credhub-btn:hover { border-color: var(--dsw-alias-border-l2); }
      .credhub-btn:disabled { opacity: .55; cursor: default; }
      .credhub-input:disabled, .credhub-select:disabled, .credhub-textarea:disabled { opacity: .6; cursor: not-allowed; }
      .credhub-check input:disabled { cursor: not-allowed; }
      .credhub-info { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 9px 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
      .credhub-btn-primary { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); border-color: transparent; }
      .credhub-btn-primary:hover { border-color: transparent; filter: brightness(1.04); }
      .credhub-btn-danger { color: var(--dsw-alias-state-error-primary); background: transparent; }
      .credhub-btn-link { min-height: 24px; padding: 0 2px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); }
      .credhub-btn-link:hover { color: var(--dsw-alias-label-primary); }
      .credhub-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px; }
      .credhub-list { display: flex; flex-direction: column; gap: 10px; }
      .credhub-record { display: flex; flex-direction: column; gap: 9px; }
      .credhub-record-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .credhub-record-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .credhub-alias { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
      .credhub-kind { color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
      .credhub-desc { color: var(--dsw-alias-label-secondary); }
      .credhub-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); }
      .credhub-meta-label { color: var(--dsw-alias-state-idle-primary); }
      .credhub-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
      .credhub-chip { display: inline-flex; align-items: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; padding: 1px 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
      .credhub-badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; white-space: nowrap; }
      .credhub-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .credhub-badge-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
      .credhub-badge-warn { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
      .credhub-badge-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
      .credhub-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .credhub-form { display: flex; flex-direction: column; gap: 13px; }
      .credhub-form-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .credhub-form-title { margin: 0; font-size: 14px; font-weight: 600; }
      .credhub-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .credhub-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .credhub-field-wide { grid-column: 1 / -1; }
      .credhub-label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
      .credhub-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .credhub-check { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; }
      .credhub-check input { margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }
      .credhub-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
      .credhub-alert { border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; padding: 9px 11px; color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
      .credhub-notice { border: 1px solid var(--dsw-alias-state-success-primary); border-radius: 8px; padding: 9px 11px; color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
      .credhub-confirm-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 10px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); }
      .credhub-confirm-row .credhub-actions { margin-left: auto; }
      .credhub-error-text { color: var(--dsw-alias-state-error-primary); }
      .credhub-advanced { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; }
      .credhub-advanced-summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .credhub-advanced[open] .credhub-advanced-summary { margin-bottom: 10px; }
      .credhub-transfer { display: flex; flex-direction: column; gap: 14px; }
      .credhub-transfer-card { display: flex; flex-direction: column; gap: 12px; }
      .credhub-transfer-card .credhub-form-actions { justify-content: flex-start; }
      .credhub-transfer-card input[type="file"] { padding: 8px; }
      .credhub-transfer-card > .credhub-hint { margin: 0; }
      .credhub-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; padding: 28px 20px; text-align: center; color: var(--dsw-alias-label-secondary); }
      .credhub-empty-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; margin: 0 0 4px; }
      .credhub-empty p { margin: 0 0 14px; }
      .credhub-config-list { display: flex; flex-direction: column; gap: 14px; }
      .credhub-config-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 220px); gap: 16px; align-items: start; }
      .credhub-config-row .credhub-check { padding: 0; }
      .credhub-select { height: 30px; }
      @media (max-width: 720px) {
        .credhub-head { flex-direction: column; }
        .credhub-toolbar { flex-wrap: wrap; }
        .credhub-grid { grid-template-columns: 1fr; }
        .credhub-config-row { grid-template-columns: 1fr; gap: 6px; }
        .credhub-record-top { flex-direction: column; }
      }
    `

    /**
     * @param {string} path
     * @returns {Promise<object>}
     */
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    const REQUEST_TIMEOUT_MS = 10_000
    const TRANSFER_TIMEOUT_MS = 60_000
    const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024

    /**
     * @param {string} path
     * @param {RequestInit} options
     * @param {string | undefined} timeoutMessage
     * @returns {Promise<Response>}
     */
    async function fetchWithTimeout(path, options, timeoutMessage, timeoutMs = REQUEST_TIMEOUT_MS) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        return await fetch(path, { ...options, signal: controller.signal })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(timeoutMessage ?? 'Request timed out')
        }
        throw error
      } finally {
        clearTimeout(timer)
      }
    }

    async function getJson(path, timeoutMessage) {
      const response = await fetchWithTimeout(path, { cache: 'no-store', credentials: 'same-origin' }, timeoutMessage)
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload === null) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
      }
      return payload
    }

    /**
     * @param {object} body
     * @returns {Promise<object>}
     */
    async function postJson(body, timeoutMessage, timeoutMs = REQUEST_TIMEOUT_MS) {
      const response = await fetchWithTimeout(ACTION_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, timeoutMessage, timeoutMs)
      const payload = await response.json().catch(() => null)
      if (payload === null) throw new Error(`HTTP ${response.status}`)
      return payload
    }

    /**
     * @param {object} record
     * @returns {object}
     */
    function emptyValues(record) {
      return {
        alias: record?.alias ?? '',
        tags: Array.isArray(record?.tags) ? record.tags.join(', ') : '',
        description: record?.description ?? '',
        credentialRef: record?.credentialRef ?? '',
        secret: '',
        host: record?.host ?? '',
        port: record?.port === undefined ? '22' : String(record.port),
        username: record?.username ?? '',
        platform: record?.platform ?? '',
        baseUrl: record?.baseUrl ?? '',
        authScheme: record?.authScheme ?? 'bearer',
        headerName: record?.headerName ?? '',
      }
    }

    /**
     * @param {object} values
     * @param {'ssh'|'pat'} kind
     * @returns {object}
     */
    function valuesToRecord(values, kind) {
      const common = {
        alias: values.alias.trim(),
        tags: values.tags.split(',').map((tag) => tag.trim()).filter((tag) => tag !== ''),
        description: values.description.trim(),
        credentialRef: values.credentialRef.trim(),
      }
      if (kind === 'ssh') {
        return {
          ...common,
          host: values.host.trim(),
          port: values.port === '' ? undefined : Number(values.port),
          username: values.username.trim(),
        }
      }
      const record = {
        ...common,
        ...values.platform.trim() !== '' ? { platform: values.platform.trim() } : {},
        ...values.baseUrl.trim() !== '' ? { baseUrl: values.baseUrl.trim() } : {},
        authScheme: values.authScheme,
        ...values.authScheme === 'header' ? { headerName: values.headerName.trim() } : {},
        ...values.authScheme === 'basic' ? { username: values.username.trim() } : {},
      }
      return record
    }

    /**
     * Keep this component identity stable across renders: a component factory
     * inside the settings render would remount the form on every keystroke and
     * drop input focus.
     * @param {object} props
     * @returns {object}
     */
    function RecordEditor({ kind, t, mode, values, saving, error, onChange, onCancel, onSave }) {
        const label = kind === 'pat' ? t('newPat') : t('newSsh')
        const set = (field) => (event) => onChange(field, event.target.value)
        return h('form', {
          className: 'credhub-card credhub-form',
          onSubmit: (event) => {
            event.preventDefault()
            onSave()
          },
        },
        h('div', { className: 'credhub-form-head' },
          h('h3', { className: 'credhub-form-title' }, mode === 'new' ? label : t('editRecord')),
          h('span', { className: 'credhub-kind' }, kind === 'ssh' ? t('sshHost') : t('patToken')),
        ),
        h('div', { className: 'credhub-grid' },
          h('div', { className: 'credhub-field' },
            h('label', { className: 'credhub-label', htmlFor: 'credhub-alias' }, t('fieldAlias')),
            h('input', {
              id: 'credhub-alias', className: 'credhub-input', value: values.alias,
              placeholder: 'prod-web-01', onChange: set('alias'), spellCheck: false, autoComplete: 'off',
              maxLength: 64, pattern: '[A-Za-z0-9][A-Za-z0-9._-]{0,63}', autoFocus: true,
            }),
          ),
          h('div', { className: 'credhub-field' },
            h('label', { className: 'credhub-label', htmlFor: 'credhub-tags' }, t('fieldTags')),
            h('input', {
              id: 'credhub-tags', className: 'credhub-input', value: values.tags,
              placeholder: 'env:production, service:web', onChange: set('tags'), spellCheck: false,
            }),
          ),
          h('div', { className: 'credhub-field credhub-field-wide' },
            h('label', { className: 'credhub-label', htmlFor: 'credhub-description' }, t('fieldDescription')),
            h('textarea', {
              id: 'credhub-description', className: 'credhub-textarea', value: values.description,
              placeholder: t('descriptionPlaceholder'), onChange: set('description'), rows: 2, maxLength: 500,
            }),
          ),
          h('div', { className: 'credhub-field credhub-field-wide' },
            h('label', { className: 'credhub-label', htmlFor: 'credhub-ref' }, t('fieldRef')),
            h('input', {
              id: 'credhub-ref', className: 'credhub-input credhub-mono', value: values.credentialRef,
              placeholder: 'SSH_PROD_WEB_KEY', onChange: set('credentialRef'), spellCheck: false, autoComplete: 'off',
            }),
          ),
          h('div', { className: 'credhub-field credhub-field-wide' },
            h('label', { className: 'credhub-label', htmlFor: 'credhub-secret' }, t('fieldSecret')),
            // An <input> collapses a pasted key's line breaks into spaces; a
            // textarea is the only control that keeps them, which is what lets
            // the credential store save the value as a '|' block scalar.
            h('textarea', {
              id: 'credhub-secret', className: 'credhub-textarea credhub-mono credhub-secret', value: values.secret ?? '',
              placeholder: t('fieldSecretPlaceholder'), onChange: set('secret'), spellCheck: false,
              autoComplete: 'off', rows: 3, 'aria-describedby': 'credhub-secret-hint',
            }),
            h('span', { id: 'credhub-secret-hint', className: 'credhub-hint' }, t('fieldSecretHint')),
          ),
          kind === 'ssh' ? h(React.Fragment, null,
            h('div', { className: 'credhub-field' },
              h('label', { className: 'credhub-label', htmlFor: 'credhub-host' }, t('fieldHost')),
              h('input', {
                id: 'credhub-host', className: 'credhub-input', value: values.host,
                placeholder: '10.0.0.10', onChange: set('host'), spellCheck: false, autoComplete: 'off',
              }),
            ),
            h('div', { className: 'credhub-field' },
              h('label', { className: 'credhub-label', htmlFor: 'credhub-port' }, t('fieldPort')),
              h('input', {
                id: 'credhub-port', className: 'credhub-input', value: values.port,
                type: 'number', min: 1, max: 65535, onChange: set('port'),
              }),
            ),
            h('div', { className: 'credhub-field' },
              h('label', { className: 'credhub-label', htmlFor: 'credhub-username' }, t('fieldUsername')),
              h('input', {
                id: 'credhub-username', className: 'credhub-input', value: values.username,
                placeholder: 'deploy', onChange: set('username'), spellCheck: false, autoComplete: 'off',
              }),
            ),
          ) : h(React.Fragment, null,
            h('div', { className: 'credhub-field' },
              h('label', { className: 'credhub-label', htmlFor: 'credhub-platform' }, t('fieldPlatform')),
              h('input', {
                id: 'credhub-platform', className: 'credhub-input', value: values.platform,
                placeholder: 'github', onChange: set('platform'), spellCheck: false, autoComplete: 'off',
              }),
            ),
            h('div', { className: 'credhub-field' },
              h('label', { className: 'credhub-label', htmlFor: 'credhub-base-url' }, t('fieldBaseUrl')),
              h('input', {
                id: 'credhub-base-url', className: 'credhub-input credhub-mono', value: values.baseUrl,
                placeholder: 'https://api.github.com', onChange: set('baseUrl'), spellCheck: false, autoComplete: 'off',
              }),
            ),
            h('details', { className: 'credhub-advanced credhub-field-wide' },
              h('summary', { className: 'credhub-advanced-summary' }, t('advancedAuth'), values.authScheme !== 'bearer' ? ` · ${values.authScheme}` : ''),
              h('div', { className: 'credhub-grid' },
                h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-auth-scheme' }, t('fieldAuthScheme')),
                  h('select', {
                    id: 'credhub-auth-scheme', className: 'credhub-select', value: values.authScheme,
                    onChange: set('authScheme'),
                  },
                  h('option', { value: 'bearer' }, t('authBearer')),
                  h('option', { value: 'token' }, t('authToken')),
                  h('option', { value: 'basic' }, t('authBasic')),
                  h('option', { value: 'header' }, t('authHeader')),
                  ),
                ),
                values.authScheme === 'header' ? h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-header-name' }, t('fieldHeaderName')),
                  h('input', {
                    id: 'credhub-header-name', className: 'credhub-input credhub-mono', value: values.headerName,
                    placeholder: 'PRIVATE-TOKEN', onChange: set('headerName'), spellCheck: false, autoComplete: 'off',
                  }),
                ) : null,
                values.authScheme === 'basic' ? h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-basic-username' }, t('fieldBasicUsername')),
                  h('input', {
                    id: 'credhub-basic-username', className: 'credhub-input', value: values.username,
                    placeholder: 'bot', onChange: set('username'), spellCheck: false, autoComplete: 'off',
                  }),
                ) : null,
              ),
            ),
          ),
        ),
        error !== '' ? h('div', { className: 'credhub-alert', role: 'alert' }, error) : null,
        h('div', { className: 'credhub-form-actions' },
          h('button', { type: 'button', className: 'credhub-btn', onClick: onCancel, disabled: saving }, t('cancel')),
          h('button', { type: 'submit', className: 'credhub-btn credhub-btn-primary', disabled: saving },
            saving ? t('saving') : t('save')),
        ),
        )
    }

    /**
     * @param {Function} t
     * @returns {Function}
     */
    function makeSettingsSection(t) {
      return function CredentialHubSettings() {
        const [state, setState] = React.useState(null)
        const [loading, setLoading] = React.useState(true)
        const [error, setError] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const [tab, setTab] = React.useState('ssh')
        const [query, setQuery] = React.useState('')
        const [form, setForm] = React.useState(null)
        const [saving, setSaving] = React.useState(false)
        const [formError, setFormError] = React.useState('')
        const [deleteTarget, setDeleteTarget] = React.useState(null)
        const [deleteArmed, setDeleteArmed] = React.useState(false)
        const [deleteError, setDeleteError] = React.useState('')
        const deleteArmTimer = React.useRef(null)
        const [configDraft, setConfigDraft] = React.useState(null)
        const [configError, setConfigError] = React.useState('')
        const [configNotice, setConfigNotice] = React.useState('')
        const [configInfo, setConfigInfo] = React.useState('')
        const [exportPassphrase, setExportPassphrase] = React.useState('')
        const [exportConfirm, setExportConfirm] = React.useState('')
        const [importPassphrase, setImportPassphrase] = React.useState('')
        const [importFile, setImportFile] = React.useState(null)
        const [importMode, setImportMode] = React.useState('merge')
        const [importArmed, setImportArmed] = React.useState(false)
        const [exportError, setExportError] = React.useState('')
        const [exportNotice, setExportNotice] = React.useState('')
        const [importError, setImportError] = React.useState('')
        const [importNotice, setImportNotice] = React.useState('')
        const [exportedFile, setExportedFile] = React.useState(null)
        const [exporting, setExporting] = React.useState(false)
        const [importing, setImporting] = React.useState(false)
        const fileInputRef = React.useRef(null)
        const importReadId = React.useRef(0)
        const exportBusyRef = React.useRef(false)
        const importBusyRef = React.useRef(false)
        const alive = React.useRef(true)
        const configDirtyRef = React.useRef(false)
        const formRef = React.useRef(null)

        const updateConfig = (patch) => {
          configDirtyRef.current = true
          setConfigDraft((current) => ({ ...(current ?? {}), ...patch }))
          setConfigError('')
          setConfigNotice('')
          setConfigInfo('')
        }
        const resetDelete = () => {
          clearTimeout(deleteArmTimer.current)
          setDeleteTarget(null)
          setDeleteArmed(false)
          setDeleteError('')
        }
        const requestDelete = (record) => {
          clearTimeout(deleteArmTimer.current)
          setDeleteTarget(record)
          setDeleteArmed(false)
          setDeleteError('')
          setNotice('')
          setForm(null)
          // A double-click must not be able to delete: the confirm button is
          // disabled for a short arming period and is a different control from
          // the one that opened the row.
          deleteArmTimer.current = setTimeout(() => {
            if (alive.current) setDeleteArmed(true)
          }, 350)
        }

        const load = async () => {
          resetDelete()
          setLoading(true)
          setError('')
          try {
            const payload = await getJson(STATE_ROUTE, t('requestTimeout'))
            if (alive.current) {
              if (payload.state !== undefined) {
                setState(payload.state)
                if (payload.state.config !== undefined && !configDirtyRef.current) setConfigDraft(payload.state.config)
              }
              if (payload.ok === false) {
                setError(payload.error?.message ?? t('loadFailed'))
              }
            }
          } catch (cause) {
            if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            if (alive.current) setLoading(false)
          }
        }

        React.useEffect(() => {
          alive.current = true
          void load()
          return () => { alive.current = false }
        }, [])

        // Opening a form from a card low in a long list must not leave the
        // editor off-screen; scroll it into view and focus the first field.
        // The identity excludes field values so typing does not re-trigger it.
        const formIdentity = form === null ? '' : `${form.mode}:${form.kind}:${form.originalAlias}`
        React.useEffect(() => {
          if (form === null) return
          formRef.current?.scrollIntoView({ block: 'nearest' })
          document.getElementById('credhub-alias')?.focus({ preventScroll: true })
        }, [formIdentity])

        const focusAdd = () => {
          setTimeout(() => document.getElementById('credhub-add-record')?.focus(), 0)
        }
        const resetTransfer = () => {
          importReadId.current += 1
          setExportPassphrase('')
          setExportConfirm('')
          setImportPassphrase('')
          setImportFile(null)
          setImportArmed(false)
          setExportError('')
          setExportNotice('')
          setImportError('')
          setImportNotice('')
          if (fileInputRef.current !== null) fileInputRef.current.value = ''
        }
        const downloadBundle = (fileName, bundle) => {
          const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = fileName
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }

        const records = state?.records ?? []
        const active = records.filter((record) => record.kind === tab)
        const needle = query.trim().toLowerCase()
        const filtered = needle === ''
          ? active
          : active.filter((record) => [
            record.alias, record.description, record.credentialRef, record.host,
            record.username, record.platform, record.baseUrl, ...(record.tags ?? []),
          ].filter((value) => typeof value === 'string').some((value) => value.toLowerCase().includes(needle)))
        const counts = { ssh: 0, pat: 0 }
        for (const record of records) counts[record.kind] += 1
        const recordTab = tab === 'ssh' || tab === 'pat'

        const startNew = () => {
          setForm({ mode: 'new', kind: tab, originalAlias: '', values: emptyValues(null) })
          setFormError('')
          resetDelete()
          resetTransfer()
        }
        const startEdit = (record) => {
          setForm({ mode: 'edit', kind: record.kind, originalAlias: record.alias, values: emptyValues(record) })
          setFormError('')
          resetDelete()
          resetTransfer()
        }
        const setField = (field, value) => {
          setForm((current) => current === null
            ? current
            : { ...current, values: { ...current.values, [field]: value } })
        }
        const saveRecord = async () => {
          if (form === null || saving) return
          setFormError('')
          if (form.values.alias.trim() === '' || form.values.description.trim() === '' || form.values.credentialRef.trim() === '') {
            setFormError(t('requiredFields'))
            return
          }
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.values.credentialRef.trim())) {
            // Do not echo the rejected value: a user can paste a secret here.
            setFormError(t('invalidRef'))
            return
          }
          if (form.kind === 'ssh') {
            if (form.values.host.trim() === '' || form.values.username.trim() === '') {
              setFormError(t('missingConnectionFields'))
              return
            }
            const port = Number(form.values.port)
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
              setFormError(t('invalidPort'))
              return
            }
          } else if ((form.values.authScheme === 'header' && form.values.headerName.trim() === '')
            || (form.values.authScheme === 'basic' && form.values.username.trim() === '')) {
            setFormError(t('missingPatAuthFields'))
            return
          }
          setSaving(true)
          try {
            const record = valuesToRecord(form.values, form.kind)
            const payload = await postJson({
              action: 'save-record',
              kind: form.kind,
              ...form.originalAlias !== '' ? { originalAlias: form.originalAlias } : {},
              record,
            }, t('requestTimeout'))
            if (payload.ok !== true) {
              setFormError(payload.error?.message ?? t('errorTitle'))
              return
            }
            let nextState = payload.state
            let message = t('recordSaved', { alias: record.alias })
            if (typeof form.values.secret === 'string' && form.values.secret !== '') {
              const write = await postJson({
                action: 'set-credential',
                ref: record.credentialRef,
                value: form.values.secret,
              }, t('requestTimeout'))
              if (write.ok !== true) {
                // The metadata is already saved; keep the form open so the user
                // can retry the value without re-entering the key.
                setState(payload.state)
                setFormError(`${t('credentialWriteFailed')}${write.error?.message ? ` (${write.error.message})` : ''}`)
                return
              }
              if (write.state !== undefined) nextState = write.state
              message = t('recordSavedWithCredential', { alias: record.alias })
            }
            setState(nextState)
            setNotice(message)
            setForm(null)
            focusAdd()
          } catch (cause) {
            setFormError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setSaving(false)
          }
        }
        const deleteRecord = async (record) => {
          if (saving || !deleteArmed) return
          setSaving(true)
          setDeleteError('')
          setNotice('')
          try {
            const payload = await postJson({ action: 'delete-record', kind: record.kind, alias: record.alias }, t('requestTimeout'))
            if (payload.ok !== true) {
              setDeleteError(payload.error?.message ?? t('errorTitle'))
              return
            }
            setState(payload.state)
            setNotice(t('recordDeleted', { alias: record.alias }))
            resetDelete()
            focusAdd()
          } catch (cause) {
            setDeleteError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setSaving(false)
          }
        }
        const saveConfig = async () => {
          if (configDraft === null || saving) return
          setConfigError('')
          setConfigNotice('')
          const patch = {}
          for (const [key, value] of Object.entries(configDraft)) {
            if (state?.config?.[key] !== value) patch[key] = value
          }
          if (Object.keys(patch).length === 0) {
            setConfigInfo(t('noChanges'))
            return
          }
          setSaving(true)
          let restarting = false
          try {
            const payload = await postJson({ action: 'save-config', config: patch }, t('requestTimeout'))
            if (payload.ok !== true) {
              setConfigError(payload.error?.message ?? t('errorTitle'))
              return
            }
            configDirtyRef.current = false
            setConfigInfo('')
            setConfigNotice(t('configSaved'))
            restarting = true
            // The ordinary config fields restart the plugin row. Poll a few
            // times instead of assuming a fixed restart duration, and keep the
            // save button disabled while the row is coming back.
            void (async () => {
              for (let attempt = 0; attempt < 8; attempt += 1) {
                await sleep(900 + attempt * 300)
                if (!alive.current) return
                try {
                  const next = await getJson(STATE_ROUTE, t('requestTimeout'))
                  if (next.state !== undefined) {
                    setState(next.state)
                    if (next.state.config !== undefined && !configDirtyRef.current) {
                      setConfigDraft(next.state.config)
                    }
                    setSaving(false)
                    return
                  }
                } catch {
                  // The plugin row is still restarting; retry.
                }
              }
              if (alive.current) {
                setSaving(false)
                setConfigError(t('configReloadPending'))
              }
            })()
          } catch (cause) {
            setConfigError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            if (!restarting) setSaving(false)
          }
        }
        const runExport = async () => {
          if (exporting || exportBusyRef.current) return
          exportBusyRef.current = true
          setExportError('')
          setExportNotice('')
          if (exportPassphrase.length < 8) {
            setExportError(t('passphraseTooShort'))
            exportBusyRef.current = false
            return
          }
          if (exportPassphrase !== exportConfirm) {
            setExportError(t('passphraseMismatch'))
            exportBusyRef.current = false
            return
          }
          setExporting(true)
          try {
            const payload = await postJson({
              action: 'export-bundle',
              passphrase: exportPassphrase,
            }, t('transferTimeout'), TRANSFER_TIMEOUT_MS)
            if (payload.ok !== true || payload.bundle === undefined) {
              setExportError(payload.error?.message ?? t('errorTitle'))
              return
            }
            setExportedFile({ fileName: payload.fileName, bundle: payload.bundle })
            try {
              downloadBundle(payload.fileName, payload.bundle)
            } catch {
              setExportError(t('downloadFailed'))
            }
            const summary = payload.summary ?? {}
            let message = t('exportDone', {
              ssh: summary.ssh ?? 0,
              pat: summary.pat ?? 0,
              credentials: summary.credentials ?? 0,
            })
            if ((payload.missingRefs?.length ?? 0) > 0) {
              message += ` ${t('exportMissingRefs', { refs: payload.missingRefs.join(', ') })}`
            }
            setExportNotice(message)
            setExportPassphrase('')
            setExportConfirm('')
          } catch (cause) {
            setExportError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setExporting(false)
            exportBusyRef.current = false
          }
        }
        const handleImportFile = async (event) => {
          const file = event.target.files?.[0]
          const readId = ++importReadId.current
          setImportError('')
          setImportNotice('')
          setImportArmed(false)
          if (file === undefined) {
            setImportFile(null)
            return
          }
          if (file.size > MAX_IMPORT_FILE_BYTES) {
            importReadId.current += 1
            setImportError(t('fileTooLarge'))
            setImportFile(null)
            event.target.value = ''
            return
          }
          try {
            const text = await file.text()
            if (readId !== importReadId.current || !alive.current) return
            setImportFile({ name: file.name, text })
          } catch {
            if (readId !== importReadId.current || !alive.current) return
            setImportError(t('fileReadFailed'))
            setImportFile(null)
            event.target.value = ''
          }
        }
        const runImport = async () => {
          if (importing || importBusyRef.current) return
          importBusyRef.current = true
          setImportError('')
          setImportNotice('')
          if (importFile === null) {
            setImportError(t('fileRequired'))
            importBusyRef.current = false
            return
          }
          if (importPassphrase.length < 8) {
            setImportError(t('passphraseTooShort'))
            importBusyRef.current = false
            return
          }
          let bundle
          try {
            bundle = JSON.parse(importFile.text)
          } catch {
            setImportError(t('fileInvalid'))
            importBusyRef.current = false
            return
          }
          if (importMode === 'replace' && !importArmed) {
            setImportArmed(true)
            importBusyRef.current = false
            return
          }
          setImporting(true)
          try {
            const payload = await postJson({
              action: 'import-bundle',
              bundle,
              passphrase: importPassphrase,
              mode: importMode,
            }, t('transferTimeout'), TRANSFER_TIMEOUT_MS)
            if (payload.ok !== true) {
              setImportError(payload.error?.message ?? t('errorTitle'))
              setImportArmed(false)
              return
            }
            setState(payload.state)
            if (payload.state?.config !== undefined && !configDirtyRef.current) {
              setConfigDraft(payload.state.config)
            }
            const summary = payload.import ?? {}
            let message = t('importDone', {
              ssh: summary.ssh ?? 0,
              pat: summary.pat ?? 0,
              credentials: summary.credentials ?? 0,
            })
            if ((summary.credentialFailures?.length ?? 0) > 0) {
              message += ` ${t('importFailedRefs', { refs: summary.credentialFailures.join(', ') })}`
            }
            if ((summary.ignoredCredentials ?? 0) > 0) {
              message += ` ${t('importIgnored', { n: summary.ignoredCredentials })}`
            }
            setImportNotice(message)
            setImportPassphrase('')
            setImportFile(null)
            setImportArmed(false)
            if (fileInputRef.current !== null) fileInputRef.current.value = ''
          } catch (cause) {
            setImportError(cause instanceof Error ? cause.message : String(cause))
            setImportArmed(false)
          } finally {
            setImporting(false)
            importBusyRef.current = false
          }
        }

        return h('div', { className: 'credhub-root' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h('div', { className: 'credhub-head' },
            h('h2', { className: 'credhub-title' }, t('title')),
            h('button', {
              type: 'button', className: 'credhub-btn', onClick: () => { void load() }, disabled: loading,
            }, loading ? t('loading') : t('refresh')),
          ),
          error !== '' ? h('div', { className: 'credhub-alert', role: 'alert' },
            h('strong', null, t('errorTitle')),
            h('div', null, error),
            h('button', { type: 'button', className: 'credhub-btn credhub-btn-link', onClick: () => { void load() } }, t('retry')),
          ) : null,
          notice !== '' ? h('div', { className: 'credhub-notice', role: 'status' }, notice) : null,
          h('div', { className: 'credhub-tabs', role: 'group', 'aria-label': t('title') },
            h('button', {
              type: 'button', className: 'credhub-tab', 'aria-pressed': tab === 'ssh',
              onClick: () => { setTab('ssh'); setQuery(''); setForm(null); resetDelete(); resetTransfer(); setNotice('') },
            }, `${t('tabSsh')} · ${t('count', { n: counts.ssh })}`),
            h('button', {
              type: 'button', className: 'credhub-tab', 'aria-pressed': tab === 'pat',
              onClick: () => { setTab('pat'); setQuery(''); setForm(null); resetDelete(); resetTransfer(); setNotice('') },
            }, `${t('tabPat')} · ${t('count', { n: counts.pat })}`),
            h('button', {
              type: 'button', className: 'credhub-tab', 'aria-pressed': tab === 'transfer',
              onClick: () => { setTab('transfer'); setQuery(''); setForm(null); resetDelete(); resetTransfer(); setNotice('') },
            }, t('tabTransfer')),
            h('button', {
              type: 'button', className: 'credhub-tab', 'aria-pressed': tab === 'config',
              onClick: () => { setTab('config'); setQuery(''); setForm(null); resetDelete(); resetTransfer(); setNotice('') },
            }, t('tabConfig')),
          ),
          recordTab ? h('div', { className: 'credhub-toolbar' },
            h('input', {
              className: 'credhub-input credhub-grow', value: query, onChange: (event) => setQuery(event.target.value),
              placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder'), spellCheck: false,
            }),
            h('button', { id: 'credhub-add-record', type: 'button', className: 'credhub-btn credhub-btn-primary', onClick: startNew }, t('addRecord')),
          ) : null,
          recordTab && form !== null ? h('div', { ref: formRef }, h(RecordEditor, {
            kind: form.kind, t, mode: form.mode, values: form.values, saving, error: formError,
            onChange: setField,
            onCancel: () => { setForm(null); setFormError(''); focusAdd() },
            onSave: () => { void saveRecord() },
          })) : null,
          tab === 'config' ? h('div', { className: 'credhub-card credhub-config-list' },
            h('div', { className: 'credhub-form-head' },
              h('h3', { className: 'credhub-form-title' }, t('configTitle')),
            ),
            state !== null && state.configEditable !== true
              ? h('div', { className: 'credhub-info' }, state.configReadOnlyCode === 'no-entry' ? t('configNoEntry') : t('configNoEditor'))
              : null,
            configDraft === null
              ? h('div', { className: 'credhub-empty' },
                h('p', { className: 'credhub-empty-title' }, loading ? t('loading') : t('loadFailed')),
                loading ? null : h('button', { type: 'button', className: 'credhub-btn', onClick: () => { void load() } }, t('retry')),
              )
              : h(React.Fragment, null,
              h('div', { className: 'credhub-config-row' },
                h('div', null,
                  h('div', { className: 'credhub-label' }, t('configPromptSection')),
                ),
                h('label', { className: 'credhub-check' },
                  h('input', {
                    type: 'checkbox', checked: configDraft.promptSection === true,
                    disabled: !state?.configEditable || saving,
                    'aria-label': t('configPromptSection'),
                    onChange: (event) => updateConfig({ promptSection: event.target.checked }),
                  }),
                  h('span', null, configDraft.promptSection === true ? t('enabled') : t('disabled')),
                ),
              ),
              h('div', { className: 'credhub-config-row' },
                h('div', null,
                  h('div', { className: 'credhub-label' }, t('configMaxEntries')),
                ),
                h('input', {
                  className: 'credhub-input', type: 'number', min: 1, max: 100, value: configDraft.maxPromptEntriesPerKind,
                  'aria-label': t('configMaxEntries'),
                  disabled: !state?.configEditable || saving,
                  onChange: (event) => updateConfig({ maxPromptEntriesPerKind: Number(event.target.value) }),
                }),
              ),
              h('div', { className: 'credhub-config-row' },
                h('div', null, h('div', { className: 'credhub-label' }, t('configSshTimeout'))),
                h('input', {
                  className: 'credhub-input', type: 'number', min: 1000, max: 1800000, value: configDraft.sshTimeoutMs,
                  'aria-label': t('configSshTimeout'),
                  disabled: !state?.configEditable || saving,
                  onChange: (event) => updateConfig({ sshTimeoutMs: Number(event.target.value) }),
                }),
              ),
              h('div', { className: 'credhub-config-row' },
                h('div', null, h('div', { className: 'credhub-label' }, t('configHttpTimeout'))),
                h('input', {
                  className: 'credhub-input', type: 'number', min: 1000, max: 300000, value: configDraft.httpTimeoutMs,
                  'aria-label': t('configHttpTimeout'),
                  disabled: !state?.configEditable || saving,
                  onChange: (event) => updateConfig({ httpTimeoutMs: Number(event.target.value) }),
                }),
              ),
              h('div', { className: 'credhub-config-row' },
                h('div', null,
                  h('div', { className: 'credhub-label' }, t('configStrictHostKey')),
                ),
                h('select', {
                  className: 'credhub-select', value: configDraft.sshStrictHostKeyChecking,
                  'aria-label': t('configStrictHostKey'),
                  disabled: !state?.configEditable || saving,
                  onChange: (event) => updateConfig({ sshStrictHostKeyChecking: event.target.value }),
                },
                h('option', { value: 'yes' }, t('strictYes')),
                h('option', { value: 'accept-new' }, t('strictAcceptNew')),
                h('option', { value: 'no' }, t('strictNo')),
                ),
              ),
              configDraft.sshStrictHostKeyChecking === 'no'
                ? h('div', { className: 'credhub-hint credhub-error-text' }, t('strictNoWarning'))
                : null,
              h('div', { className: 'credhub-config-row' },
                h('div', null,
                  h('div', { className: 'credhub-label' }, t('configAllowLoopback')),
                ),
                h('label', { className: 'credhub-check' },
                  h('input', {
                    type: 'checkbox', checked: configDraft.allowLoopbackHttp === true,
                    disabled: !state?.configEditable || saving,
                    'aria-label': t('configAllowLoopback'),
                    onChange: (event) => updateConfig({ allowLoopbackHttp: event.target.checked }),
                  }),
                  h('span', null, configDraft.allowLoopbackHttp === true ? t('enabled') : t('disabled')),
                ),
              ),
              h('div', { className: 'credhub-config-row' },
                h('div', null,
                  h('div', { className: 'credhub-label' }, t('configAllowCrossOrigin')),
                ),
                h('label', { className: 'credhub-check' },
                  h('input', {
                    type: 'checkbox', checked: configDraft.allowCrossOriginPat === true,
                    disabled: !state?.configEditable || saving,
                    'aria-label': t('configAllowCrossOrigin'),
                    onChange: (event) => updateConfig({ allowCrossOriginPat: event.target.checked }),
                  }),
                  h('span', null, configDraft.allowCrossOriginPat === true ? t('enabled') : t('disabled')),
                ),
              ),
              h('div', { className: 'credhub-config-row' },
                h('div', null,
                  h('div', { className: 'credhub-label' }, t('configFollowRedirects')),
                ),
                h('label', { className: 'credhub-check' },
                  h('input', {
                    type: 'checkbox', checked: configDraft.followRedirects === true,
                    disabled: !state?.configEditable || saving,
                    'aria-label': t('configFollowRedirects'),
                    onChange: (event) => updateConfig({ followRedirects: event.target.checked }),
                  }),
                  h('span', null, configDraft.followRedirects === true ? t('enabled') : t('disabled')),
                ),
              ),
              configError !== '' ? h('div', { className: 'credhub-alert', role: 'alert' }, configError) : null,
              configInfo !== '' ? h('div', { className: 'credhub-info', role: 'status' }, configInfo) : null,
              configNotice !== '' ? h('div', { className: 'credhub-notice', role: 'status' }, configNotice) : null,
              h('div', { className: 'credhub-form-actions' },
                h('button', {
                  type: 'button', className: 'credhub-btn credhub-btn-primary',
                  disabled: !state?.configEditable || saving,
                  onClick: () => { void saveConfig() },
                }, saving ? t('saving') : t('configRestart')),
              ),
            ),
          ) : null,
          tab === 'transfer' ? h('div', { className: 'credhub-transfer' },
            h('div', { className: 'credhub-card credhub-transfer-card' },
              h('h3', { className: 'credhub-form-title' }, t('exportTitle')),
              h('p', { className: 'credhub-hint' }, t('exportHint')),
              h('div', { className: 'credhub-grid' },
                h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-export-pass' }, t('passphrase')),
                  h('input', {
                    id: 'credhub-export-pass', className: 'credhub-input', type: 'password',
                    value: exportPassphrase, onChange: (event) => setExportPassphrase(event.target.value),
                    autoComplete: 'new-password', spellCheck: false,
                  }),
                ),
                h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-export-confirm' }, t('passphraseConfirm')),
                  h('input', {
                    id: 'credhub-export-confirm', className: 'credhub-input', type: 'password',
                    value: exportConfirm, onChange: (event) => setExportConfirm(event.target.value),
                    autoComplete: 'new-password', spellCheck: false,
                  }),
                ),
              ),
              h('div', { className: 'credhub-form-actions' },
                h('button', {
                  type: 'button', className: 'credhub-btn credhub-btn-primary',
                  disabled: exporting, onClick: () => { void runExport() },
                }, exporting ? t('working') : t('exportButton')),
                exportedFile === null ? null : h('button', {
                  type: 'button', className: 'credhub-btn',
                  onClick: () => {
                    try {
                      downloadBundle(exportedFile.fileName, exportedFile.bundle)
                      setExportError('')
                    } catch {
                      setExportError(t('downloadFailed'))
                    }
                  },
                }, t('downloadAgain')),
              ),
              exportError !== '' ? h('div', { className: 'credhub-alert', role: 'alert' }, exportError) : null,
              exportNotice !== '' ? h('div', { className: 'credhub-notice', role: 'status' }, exportNotice) : null,
            ),
            h('div', { className: 'credhub-card credhub-transfer-card' },
              h('h3', { className: 'credhub-form-title' }, t('importTitle')),
              h('p', { className: 'credhub-hint' }, t('importHint')),
              h('div', { className: 'credhub-grid' },
                h('div', { className: 'credhub-field credhub-field-wide' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-import-file' }, t('importFile')),
                  h('input', {
                    id: 'credhub-import-file', ref: fileInputRef, className: 'credhub-input', type: 'file',
                    accept: '.json,application/json', onChange: (event) => { void handleImportFile(event) },
                  }),
                  importFile === null ? null : h('span', { className: 'credhub-hint' }, importFile.name),
                ),
                h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-import-mode' }, t('importMode')),
                  h('select', {
                    id: 'credhub-import-mode', className: 'credhub-select', value: importMode,
                    onChange: (event) => { setImportMode(event.target.value); setImportArmed(false) },
                  },
                  h('option', { value: 'merge' }, t('modeMerge')),
                  h('option', { value: 'replace' }, t('modeReplace')),
                  ),
                ),
                h('div', { className: 'credhub-field' },
                  h('label', { className: 'credhub-label', htmlFor: 'credhub-import-pass' }, t('passphrase')),
                  h('input', {
                    id: 'credhub-import-pass', className: 'credhub-input', type: 'password',
                    value: importPassphrase, onChange: (event) => setImportPassphrase(event.target.value),
                    autoComplete: 'new-password', spellCheck: false,
                  }),
                ),
              ),
              importMode === 'replace' && importArmed ? h('div', {
                className: 'credhub-confirm-row', role: 'alert',
              },
              h('span', null, t('replaceWarning')),
              h('div', { className: 'credhub-actions' },
                h('button', {
                  type: 'button', className: 'credhub-btn',
                  onClick: () => setImportArmed(false), disabled: importing,
                }, t('cancel')),
                h('button', {
                  type: 'button', className: 'credhub-btn credhub-btn-danger',
                  onClick: () => { void runImport() }, disabled: importing,
                }, importing ? t('working') : t('confirmReplace')),
              ),
              ) : null,
              importError !== '' ? h('div', { className: 'credhub-alert', role: 'alert' }, importError) : null,
              importNotice !== '' ? h('div', { className: 'credhub-notice', role: 'status' }, importNotice) : null,
              h('div', { className: 'credhub-form-actions' },
                h('button', {
                  type: 'button', className: 'credhub-btn credhub-btn-primary',
                  disabled: importing || (importMode === 'replace' && importArmed),
                  onClick: () => { void runImport() },
                }, importing ? t('working') : t('importButton')),
              ),
            ),
          ) : null,
          recordTab ? (loading && state === null
            ? h('div', { className: 'credhub-empty' }, t('loading'))
            : state === null && error !== ''
              ? h('div', { className: 'credhub-empty' },
                h('p', { className: 'credhub-empty-title' }, t('loadFailed')),
                h('p', null, error),
                h('button', { type: 'button', className: 'credhub-btn', onClick: () => { void load() } }, t('retry')),
              )
            : filtered.length === 0
              ? h('div', { className: 'credhub-empty' },
                h('p', { className: 'credhub-empty-title' }, active.length === 0 ? t('emptyTitle') : t('noMatches')),
                active.length === 0
                  ? h('button', { type: 'button', className: 'credhub-btn credhub-btn-primary', onClick: startNew }, t('addFirst'))
                  : h('button', { type: 'button', className: 'credhub-btn', onClick: () => setQuery('') }, t('clearSearch')),
              )
              : h('div', { className: 'credhub-list', role: 'list' },
                filtered.map((record) => h('div', {
                  className: 'credhub-card credhub-record', role: 'listitem', key: `${record.kind}:${record.alias}`,
                },
                h('div', { className: 'credhub-record-top' },
                  h('div', { className: 'credhub-record-name' },
                    h('span', { className: 'credhub-alias' }, record.alias),
                    h('span', { className: 'credhub-kind' }, record.kind === 'ssh' ? t('sshHost') : t('patToken')),
                    h('span', {
                      className: `credhub-badge ${record.credential?.configured === true
                        ? 'credhub-badge-ok'
                        : record.credential?.error !== undefined ? 'credhub-badge-error' : 'credhub-badge-warn'}`,
                      title: record.credential?.error ?? record.credential?.source ?? '',
                    }, record.credential?.configured === true
                      ? t('statusConfigured')
                      : record.credential?.error !== undefined ? t('statusInvalid') : t('statusMissing')),
                    record.credential?.source !== undefined
                      ? h('span', { className: 'credhub-hint' }, t('configuredSource', { source: record.credential.source }))
                      : null,
                  ),
                  h('div', { className: 'credhub-actions' },
                    h('button', { type: 'button', className: 'credhub-btn', onClick: () => startEdit(record) }, t('edit')),
                    deleteTarget?.alias === record.alias ? null : h('button', {
                      type: 'button',
                      className: 'credhub-btn credhub-btn-danger',
                      disabled: saving,
                      onClick: () => requestDelete(record),
                    }, t('delete')),
                  ),
                ),
                h('div', { className: 'credhub-desc' }, record.description),
                record.tags?.length > 0 ? h('div', { className: 'credhub-meta' },
                  h('span', { className: 'credhub-meta-label' }, t('tagsLabel')),
                  record.tags.map((tag) => h('span', { className: 'credhub-chip', key: tag }, tag)),
                ) : null,
                h('div', { className: 'credhub-meta' },
                  h('span', { className: 'credhub-meta-label' }, t('target')),
                  h('span', { className: 'credhub-mono' }, record.kind === 'ssh'
                    ? `${record.username}@${record.host}:${record.port}`
                    : [record.platform, record.baseUrl].filter((value) => typeof value === 'string' && value !== '').join(' · ') || '—'),
                  h('span', { className: 'credhub-meta-label' }, t('refLabel')),
                  h('code', { className: 'credhub-mono' }, record.credentialRef),
                ),
                record.credential?.error !== undefined
                  ? h('div', { className: 'credhub-hint credhub-error-text', role: 'status' }, record.credential.error)
                  : null,
                deleteTarget?.alias === record.alias ? h('div', {
                  className: 'credhub-confirm-row', role: 'group', 'aria-label': t('deleteConfirm', { alias: record.alias }),
                },
                h('div', { className: 'credhub-confirm-text' },
                  h('div', { className: 'credhub-label' }, t('deleteConfirm', { alias: record.alias })),
                  h('div', { className: 'credhub-hint' }, t('deleteConfirmHint')),
                ),
                deleteError !== '' ? h('div', { className: 'credhub-alert', role: 'alert' }, deleteError) : null,
                h('div', { className: 'credhub-actions' },
                  h('button', { type: 'button', className: 'credhub-btn', onClick: () => { resetDelete(); focusAdd() }, disabled: saving }, t('cancel')),
                  h('button', {
                    type: 'button', className: 'credhub-btn credhub-btn-danger',
                    disabled: !deleteArmed || saving,
                    onClick: () => { void deleteRecord(record) },
                  }, deleteArmed ? t('confirmDelete') : t('deleteArming')),
                ),
                ) : null,
                )),
              ))
          : null,
        )
      }
    }

    function CredentialHubIcon({ size = 18 }) {
      const edge = Number.isFinite(size) ? size : 18
      return h('svg', {
        width: edge, height: edge, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M12 3.2 19 6v5.1c0 4.5-2.8 7.8-7 9.7-4.2-1.9-7-5.2-7-9.7V6l7-2.8Z' }),
      h('circle', { cx: 12, cy: 10.2, r: 2.1 }),
      h('path', { d: 'M12 12.3v3.1' }),
      h('path', { d: 'M5.4 19.2c2.2-1.4 4.1-1.4 6.6 0' }),
      h('path', { d: 'M18.6 19.2c-2.2-1.4-4.1-1.4-6.6 0' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, { zh: ZH, en: EN })
          } catch {
            return () => {}
          }
        }, 'credential-hub: locale dictionaries')
        ctx.slots.inject('settings.section', () => {
          try {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'credential-hub',
              order: 30,
              label: () => t('sectionTitle'),
              locale: NS,
            }, makeSettingsSection(t))
          } catch (error) {
            console.warn('[credential-hub] settings section could not be registered', error)
            return () => {}
          }
        })
        ctx.slots.inject('settings.section.icon', () => {
          try {
            return ctx.slots.register({
              name: 'settings.section.icon',
              id: 'credential-hub',
            }, CredentialHubIcon)
          } catch (error) {
            console.warn('[credential-hub] settings icon could not be registered', error)
            return () => {}
          }
        })
      },
    }
  },
})
