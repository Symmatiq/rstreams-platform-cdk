"use strict";

const config = require("leo-config");
const env = process.env.LEO_ENVIRONMENT as string
const resourcesJson = JSON.parse(process.env.Resources as string);
config.bootstrap({ [env]: { leoaws: resourcesJson, leoauth: resourcesJson } })
var leoAuth = require("leo-auth");

export interface EventBody { requestContext: { identity: { cognitoIdentityId: string } }; }
export interface Event { body: { event: EventBody; resource: { lrn: string }; request_id: any; } }

export async function handler(event: Event, _: any) {
  const user = await leoAuth.authorize(event.body.event, event.body.resource)
  return {
    authorized: event.body.request_id,
    user: user
  }
};

