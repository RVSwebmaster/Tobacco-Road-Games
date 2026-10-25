import { collectSource } from "../functions/_lib/news-service.mjs";

export default {
  async scheduled(controller, env) {
    const sources = await env.TRG_ORDERS.prepare("SELECT * FROM news_sources WHERE enabled=1 AND source_kind='external_feed'").all();
    for (const source of sources.results || []) {
      try {
        await collectSource(env.TRG_ORDERS, source);
      } catch (error) {
        console.error(JSON.stringify({ job: "news_collector", sourceId: source.id, error: String(error.message || error) }));
      }
    }
  }
};
