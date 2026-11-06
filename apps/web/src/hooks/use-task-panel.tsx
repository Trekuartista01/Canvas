import { TaskDetailPanel } from "@/components/task-detail-panel";
import { createContext, useContext, useState, type ReactNode } from "react";

const TaskPanelContext = createContext<(taskId: string) => void>(() => {});

/** Opens a task over the current page, so reading one never leaves that page. */
export function useOpenTaskPanel() {
  return useContext(TaskPanelContext);
}

export function TaskPanelProvider({
  workspaceId,
  children,
}: {
  workspaceId: string | undefined;
  children: ReactNode;
}) {
  const [taskId, setTaskId] = useState<string | null>(null);
  return (
    <TaskPanelContext.Provider value={setTaskId}>
      {children}
      {taskId && workspaceId && (
        <TaskDetailPanel
          key={taskId}
          taskId={taskId}
          workspaceId={workspaceId}
          onClose={() => setTaskId(null)}
        />
      )}
    </TaskPanelContext.Provider>
  );
}
