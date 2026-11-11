export type ProjectCheckItem = {
  name: string;
  path: string;
};

export type ProjectCheckResult = {
  agents: ProjectCheckItem[];
  mcpServers: ProjectCheckItem[];
  extensions: ProjectCheckItem[];
};

export type GitCheckoutResult = {
  requiresSmartCheckout?: boolean;
  conflictedFiles?: string[];
  backupRef?: string;
};
