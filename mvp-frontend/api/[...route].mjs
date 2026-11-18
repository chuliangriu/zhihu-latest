import { createApp } from "../api-backend-dist/api/app.js";
import { loadConfig } from "../api-backend-dist/config.js";
import { DiscoveryRuntime } from "../api-backend-dist/runtime.js";
import { createSecurityStores } from "../api-backend-dist/security/stores.js";
import { SupabaseAdapter } from "../api-backend-dist/sources/supabase-adapter.js";
import { ProfileSummaryService } from "../api-backend-dist/profile/summary-service.js";
import { ZhihuFootprintSource } from "../api-backend-dist/profile/zhihu-footprints.js";
import { OpenAiCompatibleProvider } from "../api-backend-dist/llm/openai-compatible-provider.js";
import { WorkflowMockProvider } from "../api-backend-dist/llm/workflow-mock-provider.js";
import { ChatService } from "../api-backend-dist/chat/service.js";
import { InMemoryWorkflowStore } from "../api-backend-dist/workflow/store.js";
import { WorkflowService } from "../api-backend-dist/workflow/service.js";
import { SupabaseWorkflowStore } from "../api-backend-dist/workflow/supabase-store.js";

let appPromise;
async function getApp() {
  if (!appPromise) appPromise = (async () => {
    const config = loadConfig();
    const stores = await createSecurityStores(config);
    const database = config.authMode === "session" || config.profile.enabled
      ? new SupabaseAdapter(config.supabase.url, config.supabase.serviceKey) : null;
    const profileInspector = database && config.profile.accessSecret && config.profile.encryptionKey
      ? new ProfileSummaryService(new ZhihuFootprintSource(database, config.profile.accessSecret, config.profile.encryptionKey, fetch, { gate: stores.profileRequestGate, policy: config.profile.userDataPolicy }), () => new OpenAiCompatibleProvider(config.llm))
      : undefined;
    const profileService = config.profile.enabled ? profileInspector : undefined;
    const workflowStore = config.businessStoreMode === "supabase"
      ? new SupabaseWorkflowStore(config.supabase.url, config.supabase.serviceKey)
      : new InMemoryWorkflowStore();
    const createWorkflowLlm = () => config.llm.mode === "live" ? new OpenAiCompatibleProvider(config.llm) : new WorkflowMockProvider();
    const chatService = new ChatService(workflowStore, createWorkflowLlm);
    const workflowService = new WorkflowService(workflowStore, createWorkflowLlm);
    return createApp({ config, runtime: new DiscoveryRuntime(config), ...stores, workflowStore, chatService, workflowService,
      ...(profileService ? { profileService } : {}), ...(profileInspector ? { profileInspector } : {}), ...(database ? { sessionResolver: database.session.bind(database) } : {}) });
  })();
  return appPromise;
}
export default async function handler(req, res) { (await getApp())(req, res); }
