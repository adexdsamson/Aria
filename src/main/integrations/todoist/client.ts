import type { CanonicalTask, TaskCreateInput } from '../../../shared/provider';

export interface TodoistApiTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  project_name?: string;
  labels?: string[];
  due?: { date?: string; datetime?: string } | null;
  priority?: number;
  is_completed?: boolean;
  updated_at?: string;
}

interface TodoistListResponse {
  results?: TodoistApiTask[];
}

export interface TodoistClient {
  validateToken(): Promise<{ ok: true }>;
  createTask(input: TaskCreateInput, opts: { idempotencyKey: string }): Promise<{ externalId: string }>;
  listTasks(): Promise<CanonicalTask[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = 'https://api.todoist.com/api/v1';

export class TodoistApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TodoistApiError';
    this.status = status;
  }
}

export function createTodoistClient(token: string, fetchImpl: FetchLike = fetch): TodoistClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TodoistApiError(response.status, body || `todoist-${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async validateToken() {
      normalizeTaskList(await request<TodoistApiTask[] | TodoistListResponse>('/tasks?limit=1'));
      return { ok: true as const };
    },
    async createTask(input, opts) {
      const body = {
        content: input.content,
        description: input.description,
        project_id: input.projectId,
        labels: input.labels,
        due_string: input.dueIso,
        priority: input.priority,
      };
      const task = await request<TodoistApiTask>('/tasks', {
        method: 'POST',
        headers: { 'X-Request-Id': opts.idempotencyKey },
        body: JSON.stringify(body),
      });
      return { externalId: task.id };
    },
    async listTasks() {
      const tasks = normalizeTaskList(await request<TodoistApiTask[] | TodoistListResponse>('/tasks'));
      return tasks.map(mapTodoistTask);
    },
  };
}

export function normalizeTaskList(payload: TodoistApiTask[] | TodoistListResponse): TodoistApiTask[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  throw new TodoistApiError(200, 'todoist-unexpected-tasks-response');
}

export function mapTodoistTask(task: TodoistApiTask): CanonicalTask {
  return {
    externalId: task.id,
    content: task.content,
    description: task.description ?? null,
    projectId: task.project_id ?? null,
    projectName: task.project_name ?? null,
    labels: task.labels ?? [],
    dueIso: task.due?.datetime ?? task.due?.date ?? null,
    priority: task.priority ?? 1,
    isCompleted: task.is_completed ?? false,
    updatedAt: task.updated_at ?? null,
  };
}
