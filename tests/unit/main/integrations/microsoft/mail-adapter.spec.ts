import { describe, expect, it, vi } from 'vitest';
import { getMessage, sendMailViaGraph } from '../../../../../src/main/integrations/microsoft/mail';

function makeClient() {
  const select = vi.fn(() => ({
    get: vi.fn(async () => ({
      id: 'msg-1',
      subject: 'Hello',
      body: { contentType: 'text', content: 'World' },
    })),
  }));
  const post = vi.fn(async () => ({ ok: true }));
  const api = vi.fn((path: string) => ({
    select,
    get: vi.fn(async () => ({})),
    post,
    header: vi.fn(() => ({ post })),
  }));
  return { graph: { api } };
}

describe('microsoft mail adapter', () => {
  it('loads a full message with body selected', async () => {
    const client = makeClient();
    const message = await getMessage(client as never, 'msg-1');
    expect(client.graph.api).toHaveBeenCalledWith('/me/messages/msg-1');
    expect(message.subject).toBe('Hello');
  });

  it('posts sendMail payloads to /me/sendMail', async () => {
    const client = makeClient();
    const result = await sendMailViaGraph(client as never, { message: { subject: 'Hi' } });
    expect(client.graph.api).toHaveBeenCalledWith('/me/sendMail');
    expect(result).toEqual({ ok: true });
  });
});
