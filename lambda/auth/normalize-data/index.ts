// import { log } from '../../../leo-sdk/lib/streams'; // Commented out - needs refactoring
const { unmarshall, marshall } = require("@aws-sdk/util-dynamodb");
const config = require("leo-config");
const env = process.env.LEO_ENVIRONMENT as string
const resourcesJson = JSON.parse(process.env.Resources as string);
config.bootstrap({ [env]: { leoaws: resourcesJson } })
const leoAws = require("leo-aws");
const dynamodb = leoAws.dynamodb;
const logger = require("leo-logger");

let AUTH_TABLE = config.leoaws.LeoAuth;
let IDENTITY_TABLE = config.leoaws.LeoAuthIdentity;
let POLICY_TABLE = config.leoaws.LeoAuthPolicy;

interface Event { Records: any[] }
interface Identity { identity?: any, policies?: any }

export const handler = async (event: any) => {
  console.log(JSON.stringify(event, null, 2)); // Use console.log for now
  if (!event.Records || event.Records.length === 0) {
    return "No records found";
  }

  const record = event.Records[0]; //We limit to 1 event per call
  logger.log(record.eventSourceARN);

  try {
    if (record.eventSourceARN.match(POLICY_TABLE)) {
      logger.log(JSON.stringify(record, null, 2));
      const policy = unmarshall(record.dynamodb.NewImage);
      logger.log(JSON.stringify(policy, null, 2));

      const Items = await dynamodb.query({
        TableName: IDENTITY_TABLE,
        IndexName: "policy-identity-id",
        KeyConditionExpression: "policy = :policy",
        ExpressionAttributeValues: {
          ":policy": policy.name
        }
      });

      logger.log("[Data]", Items);

      const ids = Items.reduce((sum: any, each: any) => {
        sum[each.identity] = true;
        return sum;
      }, {});

      logger.log("[ids]", ids);

      // Update all identities with default policies object
      await Promise.all(Object.keys(ids).map(async (id) => {
        logger.log("ID", id);
        await dynamodb.update({
          TableName: AUTH_TABLE,
          Key: {
            identity: id
          },
          UpdateExpression: 'set #policies = if_not_exists(#policies, :policies)',
          ExpressionAttributeNames: {
            '#policies': "policies"
          },
          ExpressionAttributeValues: {
            ':policies': {}
          }
        });
      }));

      // Update all identities with policy statements
      await Promise.all(Items.map(async (identity:any) => {
        logger.log("Identity", identity.identity, policy.name, policy.statements);
        await dynamodb.update({
          TableName: AUTH_TABLE,
          Key: {
            identity: identity.identity
          },
          UpdateExpression: 'set policies.#policy = :policy',
          ExpressionAttributeNames: {
            '#policy': policy.name
          },
          ExpressionAttributeValues: {
            ':policy': policy.statements
          }
        });
      }));

    } else {
      logger.log(JSON.stringify(record, null, 2));
      const keys = unmarshall(record.dynamodb.Keys);
      const Item = await dynamodb.get({
        TableName: AUTH_TABLE,
        Key: {
          identity: keys.identity
        }
      });
      logger.log("Item", Item);

      let identity: Identity = Item || {
        identity: keys.identity,
        policies: {}
      };

      logger.log("in identity", identity);

      if (record.eventName == "REMOVE") {
        delete identity.policies[keys.policy.toLowerCase()];
        await saveIdentity(identity);
      } else {
        const { Item: policyItem } = await dynamodb.get({
          TableName: POLICY_TABLE,
          Key: {
            name: keys.policy
          }
        });

        if (policyItem) {
          identity.policies[keys.policy.toLowerCase()] = policyItem.statements;
        } else {
          identity.policies[keys.policy.toLowerCase()] = "";
        }

        await saveIdentity(identity);
      }
    }
    return "Success";
  } catch (error) {
    logger.error("Error:", error);
    throw error;
  }
}

async function saveIdentity(identity: Identity) {
  logger.log("out identity", identity);
  await dynamodb.put({
    TableName: AUTH_TABLE,
    Item: identity
  });
}