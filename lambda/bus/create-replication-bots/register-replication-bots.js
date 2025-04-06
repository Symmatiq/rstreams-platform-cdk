"use strict";
const leo = require("leo-sdk");

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

module.exports = function ({
	ReplicatorLambdaName: lambdaName,
	QueueReplicationDestinationLeoBotRoleARNs: destinationLeoBotRoleARNs,
	QueueReplicationMapping
}) {

	const accountStackArnMap = destinationLeoBotRoleARNs.reduce((obj, cur) => {
		const accountStackMatch = cur.match(/arn:aws:iam::(.*):role\/(.*)-LeoBotRole/);
		if (!accountStackMatch || !accountStackMatch[1] || !accountStackMatch[2]) {
			return obj;
		}
		const accountStack = `${accountStackMatch[1]}:${accountStackMatch[2]}`;
		if (!(accountStack in obj)) {
			obj[accountStack] = cur.trim();
		} 
		return obj;
	}, {});

	var accountStacks = Object.keys(accountStackArnMap);
	if (accountStacks.length === 0) {
		return Promise.reject(new Error("Malformed QueueReplicationDestinationLeoBotRoleARNs parameter. Should be a comma delimited list of LeoBotRole ARNs."));
	}
	const accountStackDefaults = {
		defaultAccount: accountStacks[0].split(":")[0], 
		defaultStack: accountStacks[0].split(":")[1]
	};
	let queueMapping;
	try {
		const parsedQueueMap = JSON.parse(QueueReplicationMapping);
		if (!Array.isArray(parsedQueueMap)) {
			return Promise.reject(new Error("Malformed QueueReplicationMapping parameter. Must be JSON Array."));
		}
		queueMapping = parsedQueueMap.map(getInfoFromQ(accountStackDefaults));
	} catch (err) {
		return Promise.reject(new Error("Malformed QueueReplicationMapping parameter. Must be valid JSON."));
	}

	const queueMapsHaveAccountStacks = queueMapping.reduce((doesMatch, qm) => {
		if (!doesMatch) return false;
		if (!accountStackArnMap[`${qm.destAccount}:${qm.destStack}`]) return false;
		return true;
	}, true);

	const accountStacksHaveQueueMaps = Object.keys(accountStackArnMap).reduce((doesMatch, acctSt) => {
		if (!doesMatch) return false;
		if (!queueMapping.find((qm) => acctSt === `${qm.destAccount}:${qm.destStack}`)) return false;
		return true;
	}, true);

	if (!queueMapsHaveAccountStacks || !accountStacksHaveQueueMaps) {
		return Promise.reject(new Error("QueueReplication* parameters do not match per account and stack"));
	}

	const createBotPromises = [];
	queueMapping.forEach(({ sourceQueue, destAccount, destStack, destQueue }) => {
		const botId = `replicate-${sourceQueue}-to-${destAccount}-${destStack}-${destQueue}`;
		const botModel = {
			"id": botId,
			"triggers": [sourceQueue],
			"lambdaName": lambdaName,
			"settings": {
				"sourceQueue": sourceQueue,
				"destinationQueue": destQueue,
				"destinationBusStack": destStack,
				"destinationLeoBotRoleArn": accountStackArnMap[`${destAccount}:${destStack}`]
			}
		};
		let createBotPromise;
		try {
			createBotPromise = leo.bot.createBot(botId, botModel);
		} catch (err) {
			createBotPromises.push(Promise.reject(new Error("Error Creating Bot.")));
		}
		createBotPromises.push(createBotPromise);
	});
	return Promise.all(createBotPromises);
};
