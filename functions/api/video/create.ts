import { apiVideoCreateHandler } from "../../../worker/video-proxy";

export const onRequest: PagesFunction<{ ARK_API_KEY: string }> = (context) => {
  return apiVideoCreateHandler(context.request, context.env);
};
