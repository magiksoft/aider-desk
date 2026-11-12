({ message, ui, icons }) => {
  const { ExpandableMessageBlock, Tooltip } = ui;
  const { CgSpinner } = icons.Cg;
  const { RiCheckboxCircleFill, RiErrorWarningFill, RiGlobalLine, RiFileList3Line, RiCursorLine, RiEditBoxLine, RiCloseCircleLine, RiTerminalBoxLine, RiDownloadCloud2Line } = icons.Ri;

  const TOOL_META = {
    agent_browser_open: { label: 'Browser open', icon: RiGlobalLine },
    agent_browser_snapshot: { label: 'Browser snapshot', icon: RiFileList3Line },
    agent_browser_click: { label: 'Browser click', icon: RiCursorLine },
    agent_browser_fill: { label: 'Browser fill', icon: RiEditBoxLine },
    agent_browser_close: { label: 'Browser close', icon: RiCloseCircleLine },
    agent_browser_execute: { label: 'Browser command', icon: RiTerminalBoxLine },
    agent_browser_install: { label: 'Browser install', icon: RiDownloadCloud2Line },
  };

  const parseContent = (rawContent) => {
    if (!rawContent) {
      return { text: '', isError: false };
    }

    let value = rawContent;
    for (let i = 0; i < 4; i++) {
      if (typeof value !== 'string') {
        break;
      }
      try {
        value = JSON.parse(value);
      } catch {
        break;
      }
    }

    if (typeof value === 'string') {
      return { text: value, isError: /^error/i.test(value) };
    }

    const texts = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node.type === 'text' && typeof node.text === 'string') {
        texts.push(node.text);
        return;
      }
      Object.values(node).forEach(walk);
    };

    walk(value);

    const isError =
      (typeof value === 'object' && (value.isError === true || value.type === 'error-json' || value.type === 'error-text')) ||
      /^\s*error/i.test(texts.join(' '));

    return { text: texts.join('\n'), isError };
  };

  const result = parseContent(message.content);
  const args = message.args || {};
  const meta = TOOL_META[message.toolName] ?? { label: 'Browser', icon: RiTerminalBoxLine };
  const Icon = meta.icon;

  const title = (
    <div className="flex items-center gap-2 w-full">
      <div className="text-text-muted flex-shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-xs text-text-primary flex-shrink-0">{meta.label}</div>
      <span className="text-xs text-text-secondary truncate flex-1 min-w-0">
        {message.toolName === 'agent_browser_open' ? args.url : message.toolName === 'agent_browser_click' || message.toolName === 'agent_browser_fill' ? args.selector : message.toolName === 'agent_browser_execute' ? (args.args || []).join(' ') : ''}
      </span>
      {!message.content ? (
        <CgSpinner className="animate-spin w-3 h-3 text-text-muted-light flex-shrink-0" />
      ) : result.isError ? (
        <Tooltip content={result.text}>
          <RiErrorWarningFill className="w-3 h-3 text-error flex-shrink-0" />
        </Tooltip>
      ) : (
        <RiCheckboxCircleFill className="w-3 h-3 text-success flex-shrink-0" />
      )}
    </div>
  );

  const rows = [];
  if (args.headed) {
    rows.push(['Mode', 'headed']);
  }
  if (args.interactive) {
    rows.push(['Interactive', 'true']);
  }
  if (args.compact) {
    rows.push(['Compact', 'true']);
  }
  if (typeof args.depth === 'number') {
    rows.push(['Depth', String(args.depth)]);
  }
  if (typeof args.selector === 'string' && args.selector && message.toolName !== 'agent_browser_click' && message.toolName !== 'agent_browser_fill') {
    rows.push(['Selector', args.selector]);
  }
  if (typeof args.text === 'string' && args.text) {
    rows.push(['Value', args.text]);
  }
  if (typeof args.session === 'string' && args.session) {
    rows.push(['Session', args.session]);
  }
  if (message.toolName === 'agent_browser_execute' && Array.isArray(args.args) && args.args.length) {
    rows.push(['Command', args.args.join(' ')]);
  }

  const showOutput = message.toolName !== 'agent_browser_open' || result.text.length > 0;

  const content = (
    <div className="px-3 pb-3 text-xs text-text-tertiary bg-bg-secondary relative">
      {rows.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {rows.map(([label, value]) => (
            <div key={label} className="text-2xs text-text-tertiary">
              <span className="font-medium uppercase tracking-wide text-text-secondary">{label}&nbsp;&nbsp;</span>
              <span className="font-mono break-all" title={value}>
                {value.length > 200 ? `${value.slice(0, 200)}…` : value}
              </span>
            </div>
          ))}
        </div>
      )}
      {message.content &&
        (result.isError ? (
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-primary-light p-3 font-mono text-2xs text-error">
            {result.text}
          </pre>
        ) : showOutput ? (
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-primary-light p-3 font-mono text-2xs text-text-secondary">
            {result.text || 'Completed without output.'}
          </pre>
        ) : null)}
    </div>
  );

  return (
    <ExpandableMessageBlock
      message={message}
      title={title}
      content={content}
      usageReport={message.usageReport}
      initialExpanded={false}
      hideMessageBar={true}
    />
  );
};
