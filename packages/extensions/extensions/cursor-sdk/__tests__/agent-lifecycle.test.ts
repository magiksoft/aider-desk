import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CursorSdkExtension from '../index';

import type { AgentStartedEvent, ContextAssistantMessage, ContextToolMessage, ExtensionContext, InterruptedEvent, TaskContext } from '@aiderdesk/extensions';

const sdk = vi.hoisted(() => ({ create: vi.fn(), resume: vi.fn(), list: vi.fn() }));
vi.mock('@cursor/sdk', () => ({ Agent: { create: sdk.create, resume: sdk.resume }, Cursor: { models: { list: sdk.list } } }));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const setup = (signal?: AbortSignal, resume = false) => {
  const run = {
    id: 'run',
    supports: () => true,
    cancel: vi.fn(async () => {}),
    wait: vi.fn(async () => ({ status: 'finished' })),
  };
  const agent = {
    agentId: 'agent',
    reload: vi.fn(async () => {}),
    send: vi.fn(async () => run),
    [Symbol.asyncDispose]: vi.fn(async () => {}),
  };
  sdk.create.mockResolvedValue(agent);
  sdk.resume.mockResolvedValue(agent);
  const task = {
    data: { id: 'task', metadata: resume ? { cursorAgentId: 'existing' } : {} },
    getTaskDir: () => '/task/workspace',
    updateTask: vi.fn(async () => {}),
    addContextMessage: vi.fn(async () => {}),
    activateSkill: vi.fn<TaskContext['activateSkill']>().mockResolvedValue(null),
    addLogMessage: vi.fn(),
    addLoadingMessage: vi.fn(),
    addResponseMessage: vi.fn(),
  };
  const context = { getTaskContext: () => task, getModelConfigs: async () => [], log: vi.fn() };
  const event = {
    providerProfile: { id: 'cursor-sdk' },
    model: 'auto',
    prompt: 'Hello',
    agentProfile: { enabledServers: [] },
    modelCallSettings: { abortSignal: signal },
  } as unknown as AgentStartedEvent;
  const extension = new CursorSdkExtension();
  return { extension, event, context: context as unknown as ExtensionContext, task, agent, run };
};

beforeEach(() => {
  vi.resetAllMocks();
  sdk.list.mockResolvedValue([]);
  vi.stubEnv('CURSOR_API_KEY', 'test-private-key');
});
afterEach(() => vi.unstubAllEnvs());

const skillMessages = (name: string): [ContextAssistantMessage, ContextToolMessage] => [
  {
    id: `${name}-assistant`,
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: name,
        toolName: 'skills---activate_skill',
        input: { skill: name },
      },
    ],
  },
  {
    id: `${name}-tool`,
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: name,
        toolName: 'skills---activate_skill',
        output: { type: 'text', value: `${name} instructions` },
      },
    ],
  },
];

describe('Cursor extension skill activation', () => {
  it.each(['Execute writing-tests skill', 'Add coverage for the parser'])('activates requested skills after the user message for "%s"', async (prompt) => {
    const { extension, event, context, task, agent } = setup();
    event.prompt = prompt;
    event.skillsToActivate = ['writing-tests'];
    event.contextMessages = [{ id: 'previous-user', role: 'user', content: 'Previous prompt' }];
    task.activateSkill.mockImplementation(async () => {
      expect(task.addContextMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: prompt }));
      expect(agent.send).not.toHaveBeenCalled();
      return skillMessages('writing-tests');
    });

    await expect(extension.onAgentStarted(event, context)).resolves.toEqual({ blocked: true });

    expect(task.activateSkill).toHaveBeenCalledExactlyOnceWith('writing-tests');
    expect(agent.send).toHaveBeenCalledWith(`<skill name="writing-tests">\nwriting-tests instructions\n</skill>\n\n${prompt}`, expect.anything());
    expect(task.addContextMessage).toHaveBeenCalledTimes(1);
  });

  it('sends ordinary prompts without activating skills', async () => {
    const { extension, event, context, task, agent } = setup();

    await extension.onAgentStarted(event, context);

    expect(task.activateSkill).not.toHaveBeenCalled();
    expect(agent.send).toHaveBeenCalledWith('Hello', expect.anything());
  });

  it('preserves already activated skill content without duplicating it', async () => {
    const { extension, event, context, task, agent } = setup();
    event.skillsToActivate = ['writing-tests'];
    event.contextMessages = skillMessages('writing-tests');

    await extension.onAgentStarted(event, context);

    expect(task.activateSkill).toHaveBeenCalledWith('writing-tests');
    expect(agent.send).toHaveBeenCalledWith('<skill name="writing-tests">\nwriting-tests instructions\n</skill>\n\nHello', expect.anything());
  });

  it('injects multiple skills once and preserves images', async () => {
    const { extension, event, context, task, agent } = setup();
    event.skillsToActivate = ['writing-tests', 'review'];
    event.contextMessages = skillMessages('writing-tests');
    event.images = ['data:image/png;base64,aGVsbG8='];
    task.activateSkill.mockImplementation(async (name) => skillMessages(name));

    await extension.onAgentStarted(event, context);

    expect(task.activateSkill.mock.calls).toEqual([['writing-tests'], ['review']]);
    expect(agent.send).toHaveBeenCalledWith(
      {
        text: '<skill name="writing-tests">\nwriting-tests instructions\n</skill>\n\n<skill name="review">\nreview instructions\n</skill>\n\nHello',
        images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }],
      },
      expect.anything(),
    );
  });

  it('does not send the prompt if core skill activation fails', async () => {
    const { extension, event, context, task, agent } = setup();
    event.skillsToActivate = ['missing'];
    task.activateSkill.mockRejectedValue(new Error("Skill 'missing' not found"));

    await extension.onAgentStarted(event, context);

    expect(agent.send).not.toHaveBeenCalled();
    expect(task.addLogMessage).toHaveBeenCalledWith('error', expect.stringContaining("Skill 'missing' not found"));
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledOnce();
  });
});

describe('Cursor extension lifecycle integration', () => {
  it('does not create an agent for an already-aborted prompt', async () => {
    const controller = new AbortController();
    controller.abort();
    const { extension, event, context } = setup(controller.signal);
    await expect(extension.onAgentStarted(event, context)).resolves.toEqual({ blocked: true });
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it.each([false, true])('disposes late acquisition without sending after interruption (resume=%s)', async (resume) => {
    const { extension, event, context, agent, task } = setup(undefined, resume);
    const acquisition = deferred<typeof agent>();
    (resume ? sdk.resume : sdk.create).mockReturnValue(acquisition.promise);
    const pending = extension.onAgentStarted(event, context);
    await vi.waitFor(() => expect(resume ? sdk.resume : sdk.create).toHaveBeenCalled());
    await extension.onInterrupted({} as InterruptedEvent, context);
    acquisition.resolve(agent);
    await pending;
    expect(agent.send).not.toHaveBeenCalled();
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(task.addLogMessage).not.toHaveBeenCalledWith('error', expect.anything());
    expect(task.updateTask).not.toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
  });

  it('cancels a run arriving after send was interrupted', async () => {
    const controller = new AbortController();
    const { extension, event, context, agent, run } = setup(controller.signal);
    const sending = deferred<typeof run>();
    agent.send.mockReturnValue(sending.promise);
    const pending = extension.onAgentStarted(event, context);
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalled());
    controller.abort();
    sending.resolve(run);
    await pending;
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(run.wait).not.toHaveBeenCalled();
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it('rejects overlapping task runs and releases the reservation on completion', async () => {
    const { extension, event, context, agent } = setup();
    const acquisition = deferred<typeof agent>();
    sdk.create.mockReturnValueOnce(acquisition.promise);
    const pending = extension.onAgentStarted(event, context);
    await vi.waitFor(() => expect(sdk.create).toHaveBeenCalledTimes(1));
    await expect(extension.onAgentStarted(event, context)).resolves.toEqual({ blocked: true });
    expect(sdk.create).toHaveBeenCalledTimes(1);
    acquisition.resolve(agent);
    await pending;
    await extension.onAgentStarted(event, context);
    expect(sdk.create).toHaveBeenCalledTimes(2);
  });

  it('reports terminal run errors with code and redacted key, without retrying', async () => {
    const { extension, event, context, run, task } = setup();
    run.wait.mockResolvedValue({ status: 'error', error: { message: 'Failed test-private-key', code: 'AUTH' } } as never);
    await extension.onAgentStarted(event, context);
    expect(task.addLogMessage).toHaveBeenCalledWith('error', expect.stringContaining('code=AUTH'));
    expect(JSON.stringify(task.addLogMessage.mock.calls)).not.toContain('test-private-key');
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });

  it('marks setup sessions cancelled on unload', async () => {
    const { extension, event, context, agent } = setup();
    const acquisition = deferred<typeof agent>();
    sdk.create.mockReturnValue(acquisition.promise);
    const pending = extension.onAgentStarted(event, context);
    await vi.waitFor(() => expect(sdk.create).toHaveBeenCalled());
    await extension.onUnload();
    acquisition.resolve(agent);
    await pending;
    expect(agent.send).not.toHaveBeenCalled();
  });
});
