import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./api/app.js";
import { loadConfig } from "./config.js";
import { DiscoveryRuntime } from "./runtime.js";
import { createSecurityStores } from "./security/stores.js";
import { SupabaseAdapter } from "./sources/supabase-adapter.js";
import { ProfileSummaryService } from "./profile/summary-service.js";
import { ZhihuFootprintSource } from "./profile/zhihu-footprints.js";
import { OpenAiCompatibleProvider } from "./llm/openai-compatible-provider.js";
import { WorkflowMockProvider } from "./llm/workflow-mock-provider.js";
import { ChatService } from "./chat/service.js";
import { InMemoryWorkflowStore } from "./workflow/store.js";
import { WorkflowService } from "./workflow/service.js";
import { SupabaseWorkflowStore } from "./workflow/supabase-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const stores = await createSecurityStores(config);
  const database = config.authMode === "session" || config.profile.enabled ? new SupabaseAdapter(config.supabase.url!, config.supabase.serviceKey!) : null;
  const profileInspector = database && config.profile.accessSecret && config.profile.encryptionKey ? new ProfileSummaryService(
    new ZhihuFootprintSource(database, config.profile.accessSecret, config.profile.encryptionKey),
    () => new OpenAiCompatibleProvider(config.llm)) : undefined;
  const profileService = config.profile.enabled ? profileInspector : undefined;
  const workflowStore = config.businessStoreMode === "supabase"
    ? new SupabaseWorkflowStore(config.supabase.url!,config.supabase.serviceKey!)
    : new InMemoryWorkflowStore();
  const createWorkflowLlm = () => config.llm.mode === "live" ? new OpenAiCompatibleProvider(config.llm) : new WorkflowMockProvider();
  const chatService = new ChatService(workflowStore, createWorkflowLlm);
  const workflowService = new WorkflowService(workflowStore, createWorkflowLlm);
  const app = createApp({ config, runtime: new DiscoveryRuntime(config), ...stores,
    workflowStore, chatService, workflowService,
    ...(profileService ? { profileService } : {}),
    ...(profileInspector ? { profileInspector } : {}),
    ...(database ? { sessionResolver: database.session.bind(database) } : {}) });
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 30_000, headersTimeout: 10_000 }, app);

  server.listen(config.port, config.host, () => {
    console.info(`Discovery service listening on http://${config.host}:${config.port}`);
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.info(`${signal} received; stopping server`);
    server.close(async (error) => {
      try {
        await stores.close();
      } catch {
        console.error("Security store shutdown failed");
        process.exitCode = 1;
      }
      if (error) {
        console.error("Server shutdown failed");
        process.exitCode = 1;
      }
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error) => {
  console.error("Discovery service failed to start", error instanceof Error ? error.message : "UnknownError");
  process.exitCode = 1;
});
