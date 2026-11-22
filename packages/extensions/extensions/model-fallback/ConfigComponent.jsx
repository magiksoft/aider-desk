({ config, updateConfig, models, providers, ui }) => {
  const { Button, Checkbox, Input, ModelSelector, TextArea } = ui;
  const fallbackModelId = config?.fallbackModelId || '';
  const customErrorCodes = (config?.customErrorCodes ?? []).join(', ');
  const customErrorPatterns = (config?.customErrorPatterns ?? []).join('\n');
  const enabledProviders = (providers ?? []).filter((provider) => !provider.disabled);
  const enabledProviderIds = new Set(enabledProviders.map((provider) => provider.id));
  const enabledModels = (models ?? []).filter((model) => enabledProviderIds.has(model.providerId));

  const handleEnabledChange = (checked) => {
    updateConfig({ ...config, enabled: checked });
  };

  const handleModelChange = (model) => {
    updateConfig({
      ...config,
      fallbackModelId: model ? `${model.providerId}/${model.id}` : '',
    });
  };

  const handleClear = () => {
    updateConfig({ ...config, fallbackModelId: '' });
  };

  const handleCodesChange = (event) => {
    updateConfig({
      ...config,
      customErrorCodes: event.target.value.split(',').map((code) => code.trim()).filter(Boolean),
    });
  };

  const handlePatternsChange = (event) => {
    updateConfig({
      ...config,
      customErrorPatterns: event.target.value.split('\n').map((pattern) => pattern.trim()).filter(Boolean),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <Checkbox
          label="Enable model fallback"
          checked={config?.enabled ?? true}
          onChange={handleEnabledChange}
        />
        <span className="text-xs text-text-secondary">
          Continue the current agent run with another model when the active provider rejects a request due to rate or quota limits, an exhausted subscription, or a configured custom error.
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <label className="block text-sm font-medium text-text-primary">
          Secondary model
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 p-2 bg-bg-secondary-light border-2 border-border-default rounded focus-within:outline-none focus-within:border-border-light">
            <ModelSelector
              className="w-full justify-between"
              selectedModelId={fallbackModelId || null}
              onChange={handleModelChange}
              models={enabledModels}
              providers={enabledProviders}
              labelOnNull="Select a model"
              skipPreferredModelsUpdate
              usePortal
            />
          </div>
          {fallbackModelId && (
            <Button size="sm" variant="outline" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-text-secondary">
          Used after HTTP 429 or a provider response reporting quota, rate-limit, credit exhaustion, or subscription errors — and for any configured custom error codes or patterns — only before the failed step has produced output or started tool activity.
        </p>
        <p className="text-xs text-text-secondary">
          The task&apos;s saved model is not changed and will be tried again on the next run. Switching sends the conversation and its context to the fallback provider and may incur charges.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Input
          label="Custom error codes"
          value={customErrorCodes}
          onChange={handleCodesChange}
          placeholder="ENTITLEMENT_ERROR, SUBSCRIPTION_REQUIRED"
        />
        <p className="text-xs text-text-secondary">
          Comma-separated provider error codes that should also trigger fallback, matched case-insensitively against the error&apos;s code or type.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <TextArea
          label="Custom error patterns"
          rows={3}
          value={customErrorPatterns}
          onChange={handlePatternsChange}
          placeholder={'not subscribed to required model plan\nsubscription expired'}
        />
        <p className="text-xs text-text-secondary">
          One case-insensitive regular expression per line, matched against the error message and response body.
        </p>
      </div>
    </div>
  );
};
