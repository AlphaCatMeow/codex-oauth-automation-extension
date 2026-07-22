(function attachBackgroundSub2ApiAgentIdentityImport(root, factory) {
  root.MultiPageBackgroundSub2ApiAgentIdentityImport = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSub2ApiAgentIdentityImportModule() {
  const IMPORT_RETRY_DELAY_MS = 1000;

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function isRetryableSub2ApiImportError(error) {
    const status = Number(error?.status);
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
      return true;
    }
    if (error?.isTimeout || error?.code === 'SUB2API_TIMEOUT' || error?.name === 'AbortError') {
      return true;
    }
    if (error?.isNetworkError || error?.name === 'TypeError') {
      return true;
    }

    const code = normalizeString(error?.code).toUpperCase();
    if (/^(ECONN|ENET|EAI_|ETIMEDOUT|UND_ERR_)/.test(code)) {
      return true;
    }
    const message = normalizeString(error?.message);
    return /(?:请求超时|timed?\s*out|timeout|network\s*error|fetch\s*failed|connection\s*(?:reset|closed)|socket\s*hang\s*up)/i.test(message);
  }

  function createSub2ApiAgentIdentityImportExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      completeNodeFromBackground,
      normalizeSub2ApiUrl = (value) => value,
      throwIfStopped = () => {},
      sleepWithStop = async () => {},
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
    } = deps;

    let sub2ApiApi = null;
    let sessionReader = null;

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'sub2api-agent-identity-import',
      });
    }

    function getSub2ApiApi() {
      if (sub2ApiApi) {
        return sub2ApiApi;
      }
      const apiFactory = deps.createSub2ApiApi
        || self.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi;
      if (typeof apiFactory !== 'function') {
        throw new Error('SUB2API 接口模块未加载，无法导入 Agent Identity。');
      }
      sub2ApiApi = apiFactory({
        addLog: rawAddLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
      return sub2ApiApi;
    }

    function getSessionReader() {
      if (sessionReader) {
        return sessionReader;
      }
      const readerFactory = deps.createOpenAiSessionReader
        || self.MultiPageBackgroundOpenAiSessionReader?.createOpenAiSessionReader;
      if (typeof readerFactory !== 'function') {
        throw new Error('OpenAI 会话读取模块未加载，无法生成 Agent Identity。');
      }
      sessionReader = readerFactory(deps);
      return sessionReader;
    }

    function getCreateAgentIdentity() {
      const createAgentIdentity = deps.createAgentIdentity
        || self.MultiPageBackgroundOpenAiAgentIdentity?.createAgentIdentity;
      if (typeof createAgentIdentity !== 'function') {
        throw new Error('OpenAI Agent Identity 模块未加载，无法继续交付。');
      }
      return createAgentIdentity;
    }

    function resolveVisibleStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 10;
    }

    function resolveAccountName(state = {}, session = null, authJson = null) {
      const accountIdentifierEmail = normalizeString(state.accountIdentifierType).toLowerCase() === 'email'
        ? normalizeString(state.accountIdentifier)
        : '';
      return normalizeString(
        authJson?.agent_identity?.email
        || session?.user?.email
        || session?.email
        || state.email
        || accountIdentifierEmail
      );
    }

    async function executeSub2ApiAgentIdentityImport(state = {}) {
      throwIfStopped();
      const visibleStep = resolveVisibleStep(state);
      const api = getSub2ApiApi();
      const logOptions = {
        visibleStep,
        logLabel: `步骤 ${visibleStep}`,
        logOptions: { step: visibleStep, stepKey: 'sub2api-agent-identity-import' },
        timeoutMs: 120000,
      };

      const prepared = await api.prepareCodexSessionImport(state, logOptions);
      throwIfStopped();

      await addStepLog(visibleStep, 'SUB2API 预检完成，正在读取当前 ChatGPT accessToken...', 'info');
      throwIfStopped();
      const sessionState = await getSessionReader().readCurrentSessionFromState(state, {
        visibleStep,
        targetLabel: 'SUB2API Agent Identity',
        requiredFields: ['accessToken'],
      });
      throwIfStopped();

      await addStepLog(visibleStep, '正在生成 Ed25519 密钥并注册 OpenAI Agent...', 'info');
      throwIfStopped();
      const authJson = await getCreateAgentIdentity()(
        sessionState.accessToken,
        sessionState.session
      );
      throwIfStopped();

      const importInput = {
        authJson,
        accountName: resolveAccountName(state, sessionState.session, authJson),
        expiresAt: null,
      };
      const importOptions = {
        ...logOptions,
        resultLabel: 'SUB2API Agent Identity 导入完成',
      };

      let result;
      try {
        result = await api.importPreparedCodexAuth(prepared, importInput, importOptions);
      } catch (error) {
        throwIfStopped();
        if (!isRetryableSub2ApiImportError(error)) {
          throw error;
        }
        await addStepLog(
          visibleStep,
          'SUB2API 导入遇到临时错误，1 秒后复用当前 Agent Identity 重试一次...',
          'warn'
        );
        throwIfStopped();
        await sleepWithStop(IMPORT_RETRY_DELAY_MS);
        throwIfStopped();
        result = await api.importPreparedCodexAuth(prepared, importInput, importOptions);
      }
      throwIfStopped();

      await completeNodeFromBackground(
        state?.nodeId || 'sub2api-agent-identity-import',
        result
      );
    }

    return {
      executeSub2ApiAgentIdentityImport,
    };
  }

  return {
    IMPORT_RETRY_DELAY_MS,
    createSub2ApiAgentIdentityImportExecutor,
    isRetryableSub2ApiImportError,
  };
});
