# Model Fallback

Continues the current agent run with a configured secondary model when the active provider rejects a model call because its quota or rate limit is exhausted, its subscription or plan does not cover the model, or a user-configured error trigger matches.

## Configuration

1. Install and enable **Model Fallback**.
2. Open the extension settings.
3. Leave **Enable model fallback** enabled and choose a **Secondary model**.
4. Ensure the secondary model's provider profile is enabled and configured in the Model Library.
5. Optionally add **Custom error codes** and/or **Custom error patterns** to trigger fallback for provider-specific errors beyond the built-in ones.

The model selector stores both the provider profile ID and the model ID (`provider-profile-id/model-id`), so multiple profiles for the same provider type remain distinct.

### Custom error triggers

Besides the built-in matching, you can configure additional triggers:

- **Custom error codes** — comma-separated error codes (e.g. `ENTITLEMENT_ERROR, SUBSCRIPTION_REQUIRED`) matched case-insensitively against the `code` or `type` field anywhere inside the error object.
- **Custom error patterns** — one case-insensitive regular expression per line, matched against the error message and response body (e.g. `not subscribed to required model plan`).

This is useful for providers reporting non-429 errors when a subscription lapses. For example, clinepass returns the following when the subscription has expired, which is recognized via the built-in `ENTITLEMENT_ERROR` code and the "not subscribed" message pattern:

```
Error 403: the user is not subscribed to required model plan: {"error":{"code":"ENTITLEMENT_ERROR","message":"Error 403: the user is not subscribed to required model plan"}}
```

## Behavior

When an agent step fails with an HTTP `429` response or a recognized quota, rate-limit, credit-exhaustion, subscription/entitlement error, or a configured custom error code/pattern, the extension handles `onAgentStepFinished` and asks AiderDesk to continue the run with the configured secondary model.

Fallback is requested only when the failed step has not emitted output or started tool execution, preventing duplicate output or repeated tool side effects. Completed earlier steps remain in the conversation, and AiderDesk rebuilds the model, provider options, cache controls, toolset, and normalized messages without modifying the task's saved model.

The switch applies only to the remainder of the current run — the next prompt tries the primary model again. If the secondary model also hits a quota limit or fails, the extension does not switch again and normal agent error handling takes over.

## Settings storage

Configuration is stored in `config.json` beside the installed extension:

```json
{
  "enabled": true,
  "fallbackModelId": "provider-profile-id/model-id",
  "customErrorCodes": ["entitlement_error"],
  "customErrorPatterns": ["not subscribed to required model plan"]
}
```

Model IDs may contain additional `/` characters. Clearing the selection or unchecking **Enable model fallback** disables fallback. Custom codes are stored lowercased; invalid regular expressions are rejected when saving.

## Limitations

- One secondary model is supported per installed extension instance; there is no ordered fallback chain.
- A failure after partial output or tool activity cannot safely use automatic mid-step fallback.
- Switching sends the conversation and its context to the fallback provider and may incur charges.
