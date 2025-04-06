"use strict";

const registerReplicationBots = require("./register-replication-bots");
const leo = require("leo-sdk");
const logger = require('leo-logger');
const util = require('util');
const https = require('https');
const url = require('url');

// Function to send response back to CloudFormation
async function sendCustomResourceResponse(event, context, responseStatus, responseData, physicalResourceId, noEcho) {
	const responseBody = JSON.stringify({
		Status: responseStatus,
		Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
		PhysicalResourceId: physicalResourceId || context.logStreamName,
		StackId: event.StackId,
		RequestId: event.RequestId,
		LogicalResourceId: event.LogicalResourceId,
		NoEcho: noEcho || false,
		Data: responseData
	});

	console.log("Response body:\n", responseBody);

	const parsedUrl = url.parse(event.ResponseURL);
	const options = {
		hostname: parsedUrl.hostname,
		port: 443,
		path: parsedUrl.path,
		method: "PUT",
		headers: {
			"content-type": "",
			"content-length": responseBody.length
		}
	};

	return new Promise((resolve, reject) => {
		const request = https.request(options, (response) => {
			console.log("Status code: " + response.statusCode);
			console.log("Status message: " + response.statusMessage);
			resolve();
		});

		request.on("error", (error) => {
			console.error("send(..) failed executing https.request(..): " + error);
			reject(error);
		});

		request.write(responseBody);
		request.end();
	});
}

exports.handler = (event, context, callback) => {
	logger.log(JSON.stringify(event, null, 2));
	try {
		event.PhysicalResourceId = event.LogicalResourceId;
		registerReplicationBots(event.ResourceProperties).then(() => {
			logger.info("Replication Bots Registered");
			sendCustomResourceResponse(event, context, 'SUCCESS', {})
				.then(() => callback()).catch(callback);
		}).catch((err) => {
			logger.error("Got error: ", err);
			sendCustomResourceResponse(event, context, 'FAILED', {}, undefined, err.message)
				.then(() => callback()).catch(callback);
		});
	} catch (err) {
		logger.error("Caught error: ", err);
		sendCustomResourceResponse(event, context, 'FAILED', {}, undefined, err.message)
			.then(() => callback()).catch(callback);
	}
};
