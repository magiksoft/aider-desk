({ message, ui, icons }) => {
  const { ExpandableMessageBlock, Tooltip } = ui;
  const [expanded, setExpanded] = React.useState(false);
  const { CgSpinner } = icons.Cg;
  const { RiCheckboxCircleFill, RiErrorWarningFill, RiImageLine } = icons.Ri;

  const parseContent = (rawContent) => {
    if (!rawContent) {
      return { text: '', media: null, isError: false };
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
      return { text: value, media: null, isError: /^error/i.test(value) };
    }

    let text = '';
    let media = null;

    const walk = (node) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node.type === 'text' && typeof node.text === 'string') {
        text = text ? `${text}\n${node.text}` : node.text;
        return;
      }
      if (
        (node.type === 'media' || node.type === 'image' || node.type === 'image-data') &&
        typeof (node.data ?? node.image) === 'string' &&
        (node.data ?? node.image).length > 64
      ) {
        if (!media) {
          const mimeType =
            typeof node.mimeType === 'string'
              ? node.mimeType
              : typeof node.mediaType === 'string'
                ? node.mediaType
                : 'image/png';
          media = { data: node.data ?? node.image, mimeType };
        }
        return;
      }
      Object.values(node).forEach(walk);
    };

    walk(value);

    const isError =
      (typeof value === 'object' && (value.isError === true || value.type === 'error-json' || value.type === 'error-text')) ||
      (!media && /^\s*error/i.test(text));

    return { text, media, isError };
  };

  const result = parseContent(message.content);
  const savedPathMatch = /saved to (.+)\. The image is attached/.exec(result.text ?? '');
  const filePath = (typeof message.args?.path === 'string' && message.args.path) || (savedPathMatch ? savedPathMatch[1] : '');
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'screenshot';
  const dataUrl = result.media ? `data:${result.media.mimeType};base64,${result.media.data}` : null;

  const title = (
    <div className="flex items-center gap-2 w-full">
      <div className="text-text-muted flex-shrink-0">
        <RiImageLine className="w-4 h-4" />
      </div>
      <div className="text-xs text-text-primary flex-shrink-0">Browser screenshot</div>
      <span className="text-xs text-text-secondary truncate flex-1 min-w-0">{fileName}</span>
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

  const handleImageClick = () => {
    setExpanded(!expanded);
  };

  const content = (
    <div className="px-3 pb-3 text-xs text-text-tertiary bg-bg-secondary relative">
      {filePath && (
        <div className="text-2xs text-text-tertiary truncate mb-2">
          <span className="font-medium uppercase tracking-wide text-text-secondary">File&nbsp;&nbsp;</span>
          <span className="font-mono" title={filePath}>
            {filePath}
          </span>
        </div>
      )}
      {message.content &&
        (result.isError ? (
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-primary-light p-3 font-mono text-2xs text-error">
            {result.text}
          </pre>
        ) : dataUrl ? (
          <img
            src={dataUrl}
            alt={fileName}
            onClick={handleImageClick}
            className={
              'max-w-full rounded-md border border-border-default-dark bg-bg-primary p-1 object-contain cursor-pointer hover:opacity-80 transition-opacity' +
              (expanded ? '' : ' max-h-48 max-w-[280px]')
            }
          />
        ) : (
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-primary-light p-3 font-mono text-2xs text-text-secondary">
            {result.text}
          </pre>
        ))}
    </div>
  );

  return (
    <ExpandableMessageBlock
      message={message}
      title={title}
      content={content}
      usageReport={message.usageReport}
      initialExpanded={true}
      hideMessageBar={true}
    />
  );
};
