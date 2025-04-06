'use strict';

import { LambdaClient } from "@aws-sdk/client-lambda";
import configure from "leo-sdk/leoConfigure.js";
import { handler as resourceHandler } from "leo-sdk/wrappers/resource";

const lambda = new LambdaClient({
  region: configure.aws.region
});

const proxies = [{
  match: /^csv\/upload/,
  file: "systems/csv/api/upload/index.js",
  lambda_function: 'Leo_csv_api_upload',
  event: {}
}];

export const handler = resourceHandler(async (event, context, callback) => {
  const proxy = proxies[0];

  if (configure._meta.env === "local") {
    const file = await import("leo-sdk/" + proxy.file);
    file.handler(event, context, callback);
  }
});
