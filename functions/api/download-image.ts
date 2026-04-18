import { downloadImageProxyHandler } from "../../worker/download-proxy";

export const onRequest: PagesFunction = (context) => {
  return downloadImageProxyHandler(context.request);
};
