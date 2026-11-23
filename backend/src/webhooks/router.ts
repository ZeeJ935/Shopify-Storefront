/** One recorded webhook, as seen by handlers. */
export type WebhookEvent = {
  topic: string;
  payload: unknown;
  triggeredAt?: string | null;
  apiVersion?: string | null;
};

export type WebhookHandler = {
  /** Stable name for logs/tests (e.g. "catalog", "revalidate", "placeholder"). */
  name: string;
  handle(event: WebhookEvent): Promise<void>;
};

/**
 * Topic → ordered list of handlers. A later step can register another handler on
 * the same topic (e.g. inventory next to catalog) without replacing existing ones.
 *
 * On failure the whole event is retried and every handler runs again — handlers
 * must be idempotent. Skipping already-succeeded handlers would need persisted
 * progress; that is intentionally not done here.
 */
export type TopicRouter = {
  register(topic: string, handler: WebhookHandler): void;
  /** Matches any topic that starts with `prefix` (e.g. "fulfillment_orders/"). */
  registerPrefix(prefix: string, handler: WebhookHandler): void;
  handlersFor(topic: string): WebhookHandler[];
  isHandled(topic: string): boolean;
  dispatch(event: WebhookEvent): Promise<void>;
};

export function createTopicRouter(): TopicRouter {
  const byTopic = new Map<string, WebhookHandler[]>();
  const prefixes: { prefix: string; handlers: WebhookHandler[] }[] = [];

  function handlersFor(topic: string): WebhookHandler[] {
    const exact = byTopic.get(topic) ?? [];
    const fromPrefix = prefixes.filter((p) => topic.startsWith(p.prefix)).flatMap((p) => p.handlers);
    return [...exact, ...fromPrefix];
  }

  return {
    register(topic, handler) {
      const list = byTopic.get(topic) ?? [];
      list.push(handler);
      byTopic.set(topic, list);
    },
    registerPrefix(prefix, handler) {
      let entry = prefixes.find((p) => p.prefix === prefix);
      if (!entry) {
        entry = { prefix, handlers: [] };
        prefixes.push(entry);
      }
      entry.handlers.push(handler);
    },
    handlersFor,
    isHandled(topic) {
      return handlersFor(topic).length > 0;
    },
    async dispatch(event) {
      for (const handler of handlersFor(event.topic)) {
        await handler.handle(event);
      }
    },
  };
}
