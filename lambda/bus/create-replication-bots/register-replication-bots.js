"use strict";
const leo = require("leo-sdk");
const logger = require('leo-logger');

// Initialize Leo SDK from environment variables
// This should come from Lambda environment variables
const leoConfig = process.env.leosdk ? JSON.parse(process.env.leosdk) : {};
const region = process.env.AWS_REGION || 'us-east-1';

// Configure the Leo SDK with the tables
if (leoConfig && leoConfig.resources) {
    logger.info('Initializing Leo SDK with resources from environment variables:', leoConfig.resources);
    leo.configuration = {
        ...leo.configuration,
        ...leoConfig
    };
} else {
    logger.warn('No Leo SDK configuration found in environment variables');
}

// TODO: On update.. delete the old bots. you can compare with old params passed in
// TODO: On delete.. do nothing. Just success return

function getInfoFromQ({defaultAccount, defaultStack}) {
	return (mapping) => {
		if (typeof mapping === 'string') {
			return {
				sourceQueue: mapping,
				destAccount: defaultAccount,
				destStack: defaultStack,
				destQueue: mapping
			};
		}

		for (let [key, value] of Object.entries(mapping)) {
			return {
				sourceQueue: key,
				destAccount: value.account ? value.account : defaultAccount,
				destStack: value.stack ? value.stack : defaultStack,
				destQueue: value.destination ? value.destination : key
			};
		}
	};
}

// --- Main Handler --- 
module.exports = async function (resourceProperties) {
	logger.info("Received resourceProperties:", resourceProperties);
	
	// Check if LeoSdkConfig is provided in properties
	if (resourceProperties.LeoSdkConfig) {
		try {
			const sdkConfig = JSON.parse(resourceProperties.LeoSdkConfig);
			logger.info('Using Leo SDK configuration from properties:', sdkConfig);
			leo.configuration = {
				...leo.configuration,
				...sdkConfig
			};
		} catch (err) {
			logger.error('Error parsing LeoSdkConfig from properties:', err);
		}
	}

	// Determine action based on properties
	const isReplicationSetup = resourceProperties.ReplicatorLambdaArn && resourceProperties.QueueReplicationMapping;
	const isGenericBotSetup = Object.keys(resourceProperties).some(key => 
		key !== 'ServiceToken' && // Ignore framework property
		key !== 'ReplicatorLambdaArn' && 
		key !== 'QueueReplicationDestinationLeoBotRoleARNs' && 
		key !== 'QueueReplicationMapping' &&
		key !== 'UpdateTrigger' && // Ignore trigger property
		typeof resourceProperties[key] === 'object' && resourceProperties[key].id // Check for bot objects with an id
	);

	logger.info("Detected setup type - Replication:", isReplicationSetup, "Generic:", isGenericBotSetup);

	let promises = [];

	if (isReplicationSetup) {
		logger.info("Processing as Replication Bot Setup...");
		// --- Logic for registering REPLICATION bots (moved from top level) ---
		const { 
			ReplicatorLambdaArn: lambdaArn,
			QueueReplicationDestinationLeoBotRoleARNs: destinationLeoBotRoleARNs,
			QueueReplicationMapping
		} = resourceProperties;

		const accountStackArnMap = (destinationLeoBotRoleARNs || '').split(',').reduce((obj, cur) => {
			cur = cur.trim();
			if (!cur) return obj;
			const accountStackMatch = cur.match(/arn:aws:iam::(.*):role\/(.*)-LeoBotRole/);
			if (!accountStackMatch || !accountStackMatch[1] || !accountStackMatch[2]) {
				logger.warn("Skipping malformed ARN:", cur);
				return obj;
			}
			const accountStack = `${accountStackMatch[1]}:${accountStackMatch[2]}`;
			if (!(accountStack in obj)) {
				obj[accountStack] = cur;
			}
			return obj;
		}, {});
		logger.info("Parsed Account Stack ARN Map:", accountStackArnMap);

		var accountStacks = Object.keys(accountStackArnMap);
		if (accountStacks.length === 0 && (destinationLeoBotRoleARNs && destinationLeoBotRoleARNs.trim() !== '')) {
			const errorMsg = "Malformed QueueReplicationDestinationLeoBotRoleARNs parameter. Should be a comma delimited list of LeoBotRole ARNs.";
			logger.error(errorMsg, { destinationLeoBotRoleARNs });
			return Promise.reject(new Error(errorMsg));
		}
		let accountStackDefaults = {};
		if (accountStacks.length > 0) {
			accountStackDefaults = {
				defaultAccount: accountStacks[0].split(":")[0], 
				defaultStack: accountStacks[0].split(":")[1]
			};
		}
		logger.info("Account Stack Defaults:", accountStackDefaults);

		let queueMapping = [];
		try {
			const mappingInput = QueueReplicationMapping || '[]';
			logger.info("Parsing QueueReplicationMapping:", mappingInput);
			const parsedQueueMap = JSON.parse(mappingInput);
			if (!Array.isArray(parsedQueueMap)) {
				const errorMsg = "Malformed QueueReplicationMapping parameter. Must be JSON Array.";
				logger.error(errorMsg, { QueueReplicationMapping });
				return Promise.reject(new Error(errorMsg));
			}
			if (accountStacks.length > 0) {
				queueMapping = parsedQueueMap.map(getInfoFromQ(accountStackDefaults));
			} else if (parsedQueueMap.length > 0) {
				logger.warn("QueueReplicationMapping provided, but no valid QueueReplicationDestinationLeoBotRoleARNs parsed. Replication bots will not be created.");
			}
		} catch (err) {
			const errorMsg = "Malformed QueueReplicationMapping parameter. Must be valid JSON.";
			logger.error(errorMsg, err, { QueueReplicationMapping });
			return Promise.reject(new Error(errorMsg));
		}
		logger.info("Parsed Queue Mapping:", queueMapping);

		if (queueMapping.length > 0 && accountStacks.length > 0) {
			const queueMapsHaveAccountStacks = queueMapping.reduce((doesMatch, qm) => {
				if (!doesMatch) return false;
				const key = `${qm.destAccount}:${qm.destStack}`;
				if (!accountStackArnMap[key]) {
					logger.warn("Queue map entry has no matching ARN:", qm, key);
					return false;
				}
				return true;
			}, true);

			const accountStacksHaveQueueMaps = Object.keys(accountStackArnMap).reduce((doesMatch, acctSt) => {
				if (!doesMatch) return false;
				if (!queueMapping.find((qm) => acctSt === `${qm.destAccount}:${qm.destStack}`)) {
					logger.warn("ARN has no matching queue map entry:", acctSt);
					return false;
				}
				return true;
			}, true);

			if (!queueMapsHaveAccountStacks || !accountStacksHaveQueueMaps) {
				const errorMsg = "QueueReplication* parameters do not match per account and stack";
				logger.error(errorMsg, { accountStackArnMap, queueMapping });
				return Promise.reject(new Error(errorMsg));
			}
		} else {
			logger.info("Skipping replication bot creation as either QueueReplicationMapping or QueueReplicationDestinationLeoBotRoleARNs is effectively empty.");
		}

		const replicationBotPromises = [];
		queueMapping.forEach(({ sourceQueue, destAccount, destStack, destQueue }) => {
			const botId = `replicate-${sourceQueue}-to-${destAccount}-${destStack}-${destQueue}`;
			const botModel = {
				"id": botId,
				"triggers": [sourceQueue],
				"lambdaArn": lambdaArn,
				"settings": {
					"sourceQueue": sourceQueue,
					"destinationQueue": destQueue,
					"destinationBusStack": destStack,
					"destinationLeoBotRoleArn": accountStackArnMap[`${destAccount}:${destStack}`]
				}
			};
			logger.info(`Attempting to create replication bot ${botId} with model:`, botModel);
			try {
				replicationBotPromises.push(leo.bot.createBot(botId, botModel));
				logger.info(`Successfully initiated creation for replication bot ${botId}`);
			} catch (err) { 
				logger.error(`Error initiating creation for replication bot ${botId}:`, err);
				replicationBotPromises.push(Promise.reject(new Error(`Error initiating creation for replication bot ${botId}: ${err.message}`)));
			}
		});
		promises = promises.concat(replicationBotPromises); // Add to main promise list

	} else if (isGenericBotSetup) {
		logger.info("Processing as Generic Bot Setup...");
		
		// Verify that Leo SDK has the necessary table information
		if (!leo.configuration || !leo.configuration.resources || !leo.configuration.resources.LeoCron) {
			logger.error("Missing table information for Leo SDK. Environment:", process.env);
			throw new Error("Leo SDK not properly configured with table information. Missing LeoCron table reference.");
		}
		
		// --- Logic for registering GENERIC bots (from botmon stack) ---
		const genericBotPromises = Object.entries(resourceProperties)
			.filter(([key, value]) => 
				key !== 'ServiceToken' && 
				key !== 'ReplicatorLambdaArn' && 
				key !== 'QueueReplicationDestinationLeoBotRoleARNs' && 
				key !== 'QueueReplicationMapping' &&
				key !== 'UpdateTrigger' &&
				typeof value === 'object' && value.id // Filter for bot objects
			)
			.map(([key, botConfig]) => {
				const botId = botConfig.id;
				logger.info(`Processing generic bot ${botId} with config:`, botConfig);
				
				// Extract function name from ARN if needed
				let functionName = botConfig.lambdaArn;
				if (functionName && functionName.includes(':function:')) {
					functionName = functionName.split(':function:')[1];
					logger.info(`Extracted function name from ARN: ${functionName}`);
				}
				
				// Construct the model EXACTLY as Leo expects it
				const botModel = {
					id: botId,
					lambdaName: functionName, // Use function name, not ARN
					...(botConfig.name && { name: botConfig.name }),
					...(botConfig.description && { description: botConfig.description }),
					...(botConfig.paused !== undefined && { paused: botConfig.paused }),
					...(botConfig.owner && { owner: botConfig.owner }),
					...(botConfig.time && { time: botConfig.time }),
					...(botConfig.triggers && { triggers: botConfig.triggers }),
					...(botConfig.ignoreMonitor !== undefined && { ignoreMonitor: botConfig.ignoreMonitor }),
					...(botConfig.settings && { settings: botConfig.settings }),
				};
				
				logger.info(`Attempting to create generic bot ${botId} with model:`, botModel);
				
				try {
					// Return the promise from createBot
					return leo.bot.createBot(botId, botModel).then(() => {
						logger.info(`Successfully registered generic bot ${botId}`);
					}).catch(err => {
						logger.error(`Error during creation for generic bot ${botId}:`, err);
						throw new Error(`Error during creation for generic bot ${botId}: ${err.message}`); 
					});
				} catch (err) {
					logger.error(`Error initiating creation for generic bot ${botId}:`, err);
					return Promise.reject(new Error(`Error initiating creation for generic bot ${botId}: ${err.message}`));
				}
			});
		
		promises = promises.concat(genericBotPromises);
	} else {
		logger.warn("Received properties do not match known patterns for replication or generic bot setup. Doing nothing.", resourceProperties);
		return Promise.resolve(); 
	}

	if (promises.length === 0) {
	    logger.info("No bot creation promises were generated. Resolving successfully.");
	    return Promise.resolve();
	}

	// Wait for all promises (replication and/or generic)
	logger.info(`Waiting for ${promises.length} bot creation promises...`);
	return Promise.all(promises).then(results => {
		logger.info("All bot creation promises resolved.");
		return results;
	}).catch(err => {
		logger.error("Error during Promise.all for bot creation:", err);
		throw err; // Rethrow to ensure CloudFormation failure
	});
};
