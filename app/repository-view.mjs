// Repository revisions also include cursors, device observations and sync times.
// Only planner content/settings and undo availability require rebuilding its view.
export function repositoryViewKey(record, day) {
  return JSON.stringify([day, record.state, record.past.length > 0, record.future.length > 0]);
}
