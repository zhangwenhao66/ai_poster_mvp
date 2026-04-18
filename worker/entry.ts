import { apiGenerateHandler } from "./ark-proxy";

export interface Env {
  ARK_API_KEY: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/generate") {
      return apiGenerateHandler(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
