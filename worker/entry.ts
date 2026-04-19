import { apiGenerateHandler } from "./ark-proxy";
import { downloadImageProxyHandler } from "./download-proxy";
import { apiToapisGenerateHandler } from "./toapis-proxy";

export interface Env {
  ARK_API_KEY: string;
  /** ToAPIs（Nano banana 2 / gemini-3.1-flash-image-preview），可选 */
  TOAPIS_API_KEY?: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/generate") {
      return apiGenerateHandler(request, env);
    }
    if (url.pathname === "/api/generate-toapis") {
      return apiToapisGenerateHandler(request, env);
    }
    if (url.pathname === "/api/download-image") {
      return downloadImageProxyHandler(request);
    }
    return env.ASSETS.fetch(request);
  },
};
