"use strict";

// Remove registerBot import for now unless needed
// import registerBot from './steps/register.js'; 
import s3LoadTrigger from './steps/s3-load-trigger.js';
import addCrons from './steps/add-crons.js';
import logger from 'leo-logger';
// Remove faulty import
// import { handler } from './steps/index.js'; 
import https from 'https';
import url from 'url';

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

export async function customResourceHandler(event, context) {
	console.log("Request Type:", event.RequestType);
	console.log("Event:", JSON.stringify(event, null, 2));

	let responseStatus = 'SUCCESS';
	let responseData = {};
	// Use a consistent PhysicalResourceId for Create/Update/Delete
	const physicalResourceId = event.PhysicalResourceId || `LeoBusInstall-${event.StackId}-${event.LogicalResourceId}`;

	try {
		if (event.RequestType === 'Create' || event.RequestType === 'Update') {
			logger.info("Executing CREATE/UPDATE steps...");
			// Execute the standard installation steps
			// Pass ResourceProperties if the steps need them
			await s3LoadTrigger(event.ResourceProperties);
			await addCrons(event.ResourceProperties);
			// Add logic here later if ResourceProperties indicate specific bot registration is needed via registerBot
			logger.info("CREATE/UPDATE steps completed successfully.");
			responseData = { Message: "Standard install steps completed." }; // Provide some output data
		} else if (event.RequestType === 'Delete') {
			logger.info("Executing DELETE steps (if any)... currently none defined.");
			// Add delete logic here if necessary in the future
			// e.g., removing cron jobs or deregistering bots
			responseData = {}; // No data needed on delete usually
		}
	} catch (error) {
		logger.error("Error during custom resource execution:", error);
		responseStatus = 'FAILED';
		responseData = { Error: error.message || 'Unknown error' };
	}

	// Send response back to CloudFormation
	try {
		await sendCustomResourceResponse(event, context, responseStatus, responseData, physicalResourceId);
		logger.info(`Sent ${responseStatus} response to CloudFormation.`);
	} catch (sendError) {
		logger.error("Failed to send response to CloudFormation:", sendError);
		// If sending fails, Lambda execution will eventually time out, 
		// and CloudFormation will mark the resource operation as failed after retries.
	}
}
