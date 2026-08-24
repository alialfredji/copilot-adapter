import type { Provider } from "#providers/types.js";
import { createCompletionsHandler } from "#providers/openai/handler.js";
import { DefaultConversationManager } from "#conversation-manager.js";

export const openaiProvider = {
  name: "OpenAI",
  routes: ["POST /v1/chat/completions"],

  register(app, ctx) {
    const manager = new DefaultConversationManager(ctx.logger);
    app.post("/v1/chat/completions", createCompletionsHandler(ctx, manager));
  },
} satisfies Provider;
