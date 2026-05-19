import type { Provider } from '../../../shared/provider';
import type { TodoistClient } from './client';

export function createTodoistProvider(client: TodoistClient): Provider {
  return {
    providerKey: 'todoist',
    accountId: 'default',
    accountEmail: 'Todoist',
    capabilities: { tasks: true },
    task: {
      async listTasksDelta() {
        const items = await client.listTasks();
        return {
          items,
          tombstones: [],
          cursor: new Date().toISOString(),
          hadFullResync: true,
        };
      },
      async createTask(task, opts) {
        return client.createTask(task, opts);
      },
    },
  };
}
