export const ACTIVITY_LOG_TASK_LIMIT = 2;

export function activityLogTaskKey(entry) {
  return entry?.taskId ? `capture:${entry.taskId}` : 'legacy';
}

export function retainRecentActivityTasks(entries, limit = ACTIVITY_LOG_TASK_LIMIT) {
  const logs = Array.isArray(entries) ? entries : [];
  const safeLimit = Math.max(1, Math.floor(Number(limit) || ACTIVITY_LOG_TASK_LIMIT));
  const taskOrder = [];
  const seen = new Set();

  for (const entry of logs) {
    const key = activityLogTaskKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    taskOrder.push(key);
  }

  const retainedTasks = new Set(taskOrder.slice(-safeLimit));
  return logs.filter((entry) => retainedTasks.has(activityLogTaskKey(entry)));
}
