// packages/server/src/routes/threads.ts
// thread / chat 路由 —— chat 驱动范式的入口,两模式:brainstorm / directed

import type { StepSpec } from '@fireit/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChatService } from '../services/chat-service.js';

export interface ThreadRoutesDeps {
  chatService: ChatService;
}

export function registerThreadRoutes(app: FastifyInstance, deps: ThreadRoutesDeps): void {
  const { chatService } = deps;

  // POST /threads/:tid/messages —— 发送消息(chat 驱动一切)
  app.post('/threads/:tid/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tid } = req.params as { tid: string };
    const body = (req.body ?? {}) as { text?: string };
    if (!body.text || !body.text.trim()) {
      return reply.code(400).send({ error: 'text is required' });
    }
    const msg = await chatService.sendMessage(tid, body.text);
    return reply.code(201).send(msg);
  });

  // GET /threads/:tid/messages —— 拉取消息历史
  app.get('/threads/:tid/messages', async (req: FastifyRequest) => {
    const { tid } = req.params as { tid: string };
    return {
      mode: chatService.getMode(tid),
      taskId: chatService.getTaskId(tid),
      dmAgentId: chatService.getDmAgentId(tid),
      messages: chatService.getMessages(tid),
    };
  });

  // GET /threads —— 会话列表(摘要)
  app.get('/threads', async () => {
    return chatService.listThreads();
  });

  // POST /threads —— 创建 thread(默认 brainstorm;传 dmAgentId → 建 DM 单聊)
  app.post('/threads', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { taskId?: string; dmAgentId?: string };
    if (body.dmAgentId) {
      const tid = chatService.createThread('dm', body.dmAgentId);
      return reply.code(201).send({ threadId: tid, mode: 'dm', dmAgentId: body.dmAgentId });
    }
    const tid = chatService.createThread('brainstorm');
    if (body.taskId) chatService.linkTask(tid, body.taskId);
    return reply.code(201).send({ threadId: tid, mode: 'brainstorm' });
  });

  // DELETE /threads/:tid —— 删除会话
  app.delete('/threads/:tid', async (req: FastifyRequest) => {
    const { tid } = req.params as { tid: string };
    chatService.deleteThread(tid);
    return { ok: true };
  });

  // POST /threads/:tid/direct —— 头脑风暴 → 有向协作(用 plan + 负责人建 task)
  app.post('/threads/:tid/direct', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tid } = req.params as { tid: string };
    const body = req.body as {
      title?: string;
      vision?: string;
      leadAgentId?: string;
      plan?: StepSpec[];
    };
    if (!body.title || !body.vision || !body.leadAgentId || !Array.isArray(body.plan)) {
      return reply.code(400).send({ error: 'title, vision, leadAgentId, plan are required' });
    }
    try {
      const taskId = await chatService.transitionToDirected(tid, body.plan, {
        title: body.title,
        vision: body.vision,
        leadAgentId: body.leadAgentId,
      });
      return reply.code(201).send({ taskId, mode: 'directed' });
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
