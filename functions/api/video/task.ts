import { apiVideoTaskHandler } from "../../../worker/video-proxy";

export const onRequest: PagesFunction<{ ARK_API_KEY: string }> = (context) => {
  return apiVideoTaskHandler(context.request, context.env);
};
