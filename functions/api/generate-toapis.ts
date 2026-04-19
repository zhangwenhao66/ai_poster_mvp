import { apiToapisGenerateHandler } from "../../worker/toapis-proxy";

export const onRequest: PagesFunction<{ TOAPIS_API_KEY?: string }> = (context) => {
  return apiToapisGenerateHandler(context.request, context.env);
};
