import type { ModelListItem, ModelParameterValue, ModelSelection } from '@cursor/sdk';

const EFFORT_PARAM_ID = 'effort';
const REASONING_PARAM_ID = 'reasoning';
const THINKING_PARAM_ID = 'thinking';
const CONTEXT_PARAM_ID = 'context';
const FAST_PARAM_ID = 'fast';

const LEGACY_MODEL_PARAMS_SEPARATOR = '#cursor-sdk-params=';

type ModelAlias = {
  id: string;
  selection: ModelSelection;
};

const normalizeParams = (params: ModelParameterValue[]): ModelParameterValue[] => [...params].sort((left, right) => left.id.localeCompare(right.id));

const getDefaultParams = (model: ModelListItem, legacy = false): ModelParameterValue[] => {
  const defaultVariant = model.variants?.find((variant) => variant.isDefault) ?? (legacy ? undefined : model.variants?.[0]);
  if (defaultVariant) {
    return normalizeParams(defaultVariant.params);
  }

  return normalizeParams(
    (model.parameters ?? []).flatMap((parameter) => {
      const defaultValue = parameter.values[0];
      return defaultValue ? [{ id: parameter.id, value: defaultValue.value }] : [];
    }),
  );
};

const getSelectionKey = (selection: ModelSelection): string =>
  JSON.stringify({
    id: selection.id,
    params: normalizeParams(selection.params ?? []),
  });

const getParamValue = (params: ModelParameterValue[], id: string): string | undefined => params.find((param) => param.id === id)?.value;

const getReasoningLevel = (params: ModelParameterValue[]): string | undefined =>
  getParamValue(params, EFFORT_PARAM_ID) ?? getParamValue(params, REASONING_PARAM_ID);

const supportsVisibleThinking = (params: ModelParameterValue[]): boolean => {
  const reasoningLevel = getReasoningLevel(params);
  if (!reasoningLevel) return true;

  return reasoningLevel !== 'none' && getParamValue(params, THINKING_PARAM_ID) !== 'false';
};

const createAliasId = (modelId: string, params: ModelParameterValue[]): string => {
  const reasoningLevel = getReasoningLevel(params);
  const isFast = getParamValue(params, FAST_PARAM_ID) === 'true';
  const hasOneMillionContext = getParamValue(params, CONTEXT_PARAM_ID) === '1m';
  const suffix = [reasoningLevel, isFast ? 'fast' : undefined].filter(Boolean).join('-');

  return `${modelId}${suffix ? `-${suffix}` : ''}${hasOneMillionContext ? '[1m]' : ''}`;
};

const createLegacyModelAliases = (model: ModelListItem): ModelAlias[] => {
  const defaultParams = getDefaultParams(model, true);
  const candidates: ModelSelection[] = [
    ...(defaultParams.length > 0 || !model.variants?.length
      ? [
          {
            id: model.id,
            ...(defaultParams.length > 0 ? { params: defaultParams } : {}),
          },
        ]
      : []),
    ...(model.variants ?? []).map((variant) => ({
      id: model.id,
      params: normalizeParams(variant.params),
    })),
  ];

  if (!model.variants?.length && defaultParams.length > 0) {
    for (const parameter of model.parameters ?? []) {
      for (const value of parameter.values) {
        candidates.push({
          id: model.id,
          params: normalizeParams([...defaultParams.filter((defaultParam) => defaultParam.id !== parameter.id), { id: parameter.id, value: value.value }]),
        });
      }
    }
  }

  const aliases = new Map<string, ModelAlias>();
  const usedAliases = new Map<string, number>();
  const seenSelections = new Set<string>();

  for (const candidate of candidates) {
    const selectionKey = getSelectionKey(candidate);
    if (seenSelections.has(selectionKey)) continue;
    seenSelections.add(selectionKey);

    const params = candidate.params ?? [];
    if (!supportsVisibleThinking(params)) continue;

    const aliasBase = createAliasId(candidate.id, params);
    const duplicateNumber = usedAliases.get(aliasBase) ?? 0;
    usedAliases.set(aliasBase, duplicateNumber + 1);
    const id = duplicateNumber === 0 ? aliasBase : `${aliasBase}-${duplicateNumber + 1}`;
    aliases.set(id, { id, selection: candidate });
  }

  return [...aliases.values()];
};

const getVariantReasoningLevel = (params: ModelParameterValue[]): string | undefined => getReasoningLevel(params) ?? getParamValue(params, 'reasoning_effort');

const getContextSize = (value: string): number => {
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(value);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1);
};

const getStandardContext = (selections: ModelSelection[]): string | undefined =>
  selections
    .flatMap((selection) => {
      const context = getParamValue(selection.params ?? [], CONTEXT_PARAM_ID);
      return context ? [context] : [];
    })
    .sort((left, right) => getContextSize(left) - getContextSize(right) || left.localeCompare(right))[0];

const createEncodedAliasId = (selection: ModelSelection): string =>
  `${selection.id}${LEGACY_MODEL_PARAMS_SEPARATOR}${normalizeParams(selection.params ?? [])
    .map((param) => `${encodeURIComponent(param.id)}=${encodeURIComponent(param.value)}`)
    .join('&')}`;

export const createModelAliases = (model: ModelListItem, reservedIds = new Set<string>()): ModelAlias[] => {
  const candidates: ModelSelection[] = model.variants?.length
    ? [{ id: model.id, params: getDefaultParams(model) }, ...model.variants.map((variant) => ({ id: model.id, params: normalizeParams(variant.params) }))]
    : createLegacyModelAliases(model).map((alias) => alias.selection);
  const selections = [...new Map(candidates.map((selection) => [getSelectionKey(selection), selection])).values()].filter((selection) => {
    const params = selection.params ?? [];
    const reasoning = getVariantReasoningLevel(params);
    return !reasoning || (reasoning !== 'none' && getParamValue(params, THINKING_PARAM_ID) !== 'false');
  });
  const standardContext = getStandardContext(selections);
  const knownParams = new Set([EFFORT_PARAM_ID, REASONING_PARAM_ID, 'reasoning_effort', THINKING_PARAM_ID, CONTEXT_PARAM_ID, FAST_PARAM_ID]);
  const extraParamIds = [...new Set(selections.flatMap((selection) => (selection.params ?? []).map((param) => param.id)))]
    .filter((id) => !knownParams.has(id) && new Set(selections.map((selection) => getParamValue(selection.params ?? [], id))).size > 1)
    .sort();
  const usedIds = new Set<string>();

  return selections.map((selection) => {
    const params = selection.params ?? [];
    const reasoning = getVariantReasoningLevel(params);
    const context = getParamValue(params, CONTEXT_PARAM_ID);
    const suffix = [
      reasoning,
      !reasoning && getParamValue(params, THINKING_PARAM_ID) === 'true' ? 'thinking' : undefined,
      getParamValue(params, FAST_PARAM_ID) === 'true' ? 'fast' : undefined,
      ...extraParamIds.flatMap((id) => {
        const value = getParamValue(params, id);
        return value === undefined ? [] : [`${encodeURIComponent(id)}=${encodeURIComponent(value)}`];
      }),
    ]
      .filter(Boolean)
      .join('-');
    const contextSuffix = context && (context !== standardContext || context === '1m') ? `[${encodeURIComponent(context)}]` : '';
    const base = `${model.id}${suffix ? `-${suffix}` : ''}${contextSuffix}`;
    const id = usedIds.has(base) || (reservedIds.has(base) && base !== model.id) ? createEncodedAliasId(selection) : base;
    usedIds.add(id);
    return { id, selection };
  });
};

export const createModelSelections = (models: ModelListItem[]): Map<string, ModelSelection> => {
  const selections = new Map<string, ModelSelection>();
  const reservedIds = new Set(models.map((model) => model.id));

  for (const model of models) {
    for (const alias of createLegacyModelAliases(model)) {
      selections.set(alias.id, alias.selection);
    }
  }

  const currentAliases = models.flatMap((model) => createModelAliases(model, reservedIds));
  for (const alias of currentAliases) {
    selections.set(alias.id, alias.selection);
  }

  for (const model of models) {
    const aliases = currentAliases.filter((alias) => alias.selection.id === model.id);
    const fastSelections = aliases.map((alias) => alias.selection).filter((selection) => getParamValue(selection.params ?? [], FAST_PARAM_ID) === 'true');
    const standardContext = getStandardContext(fastSelections);
    const standardFastSelections = fastSelections.filter((selection) => getParamValue(selection.params ?? [], CONTEXT_PARAM_ID) === standardContext);
    const defaultReasoning = getVariantReasoningLevel(getDefaultParams(model));
    const fastSelection =
      standardFastSelections.find((selection) => getVariantReasoningLevel(selection.params ?? []) === defaultReasoning) ?? standardFastSelections[0];
    if (fastSelection && !reservedIds.has(`${model.id}-fast`) && !currentAliases.some((alias) => alias.id === `${model.id}-fast`)) {
      selections.set(`${model.id}-fast`, fastSelection);
    }

    const directAlias = aliases.find((alias) => alias.id === model.id);
    selections.set(model.id, directAlias?.selection ?? { id: model.id });
  }

  return selections;
};

export const resolveModelSelection = (modelId: string, aliases: Map<string, ModelSelection>): ModelSelection => {
  const selection = aliases.get(modelId);
  if (selection) return selection;

  const legacyParamsIndex = modelId.lastIndexOf(LEGACY_MODEL_PARAMS_SEPARATOR);
  if (legacyParamsIndex !== -1) {
    try {
      const id = modelId.slice(0, legacyParamsIndex);
      const params = modelId
        .slice(legacyParamsIndex + LEGACY_MODEL_PARAMS_SEPARATOR.length)
        .split('&')
        .flatMap((pair) => {
          const equalsIndex = pair.indexOf('=');
          if (equalsIndex === -1) return [];
          return [
            {
              id: decodeURIComponent(pair.slice(0, equalsIndex)),
              value: decodeURIComponent(pair.slice(equalsIndex + 1)),
            },
          ];
        });
      return { id, params: normalizeParams(params) };
    } catch {
      return { id: modelId };
    }
  }

  return { id: modelId };
};
