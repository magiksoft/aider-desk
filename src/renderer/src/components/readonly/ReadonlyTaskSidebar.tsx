import { useState } from 'react';
import { TaskData } from '@common/types';

import { TaskSidebar } from '@/components/project/TaskSidebar/TaskSidebar';

type Props = {
  tasks: TaskData[];
  selectedTaskId?: string;
  projectDir: string;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  onSelectTask: (taskId: string) => void;
  isMobile?: boolean;
  onClose?: () => void;
};

export const ReadonlyTaskSidebar = ({
  tasks,
  selectedTaskId,
  projectDir,
  showArchived,
  onShowArchivedChange,
  onSelectTask,
  isMobile = false,
  onClose,
}: Props) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleToggleCollapse = () => setIsCollapsed((collapsed) => !collapsed);

  return (
    <TaskSidebar
      projectDir={projectDir}
      showArchived={showArchived}
      onShowArchivedChange={onShowArchivedChange}
      loading={false}
      tasks={tasks}
      readonly
      activeTaskId={selectedTaskId ?? null}
      onTaskSelect={onSelectTask}
      isCollapsed={isCollapsed}
      onToggleCollapse={handleToggleCollapse}
      isMobile={isMobile}
      onClose={onClose}
    />
  );
};
