import { apiGenerateHandler } from "../../worker/ark-proxy";

export const onRequest: PagesFunction<{ ARK_API_KEY: string }> = (context) => {
  return apiGenerateHandler(context.request, context.env);
};
