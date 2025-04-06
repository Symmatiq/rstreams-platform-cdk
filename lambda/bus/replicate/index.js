"use strict";

const leo = require("leo-sdk");
const logger = require("leo-logger");
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");

exports.handler = leo.bot((event, context, callback) => {
    logger.info("Replication Event", JSON.stringify(event, null, 2));
    
    // Extract settings from the event (these come from the bot settings configured by register-replication-bots.js)
    const sourceQueue = event.settings.sourceQueue;
    const destinationQueue = event.settings.destinationQueue;
    const destinationBusStack = event.settings.destinationBusStack;
    const destinationLeoBotRoleArn = event.settings.destinationLeoBotRoleArn;
    
    // Create STS client for assuming the destination account role
    const stsClient = new STSClient({ region: process.env.AWS_REGION || "us-east-1" });
    
    // Parameters for assuming the destination role
    const params = {
        DurationSeconds: 900,
        RoleArn: destinationLeoBotRoleArn,
        RoleSessionName: "ReplicationBot"
    };
    
    // Assume role and then replicate events
    stsClient.send(new AssumeRoleCommand(params))
        .then(data => {
            logger.info("Assumed role successfully");
            
            // Extract temporary credentials from the response
            const credentials = {
                accessKeyId: data.Credentials.AccessKeyId,
                secretAccessKey: data.Credentials.SecretAccessKey,
                sessionToken: data.Credentials.SessionToken
            };
            
            // Configure SDK for the destination account
            const destinationConfig = {
                credentials: credentials,
                region: process.env.AWS_REGION || "us-east-1"
            };
            
            // Get a configured SDK for the destination
            const destinationSdk = require('leo-sdk')(destinationConfig);
            
            // Set up replication pipeline
            const transform = leo.streams.through((obj, done) => {
                // Pass through the event as-is
                done(null, obj);
            });
            
            // Read from source queue
            let stream = leo.read(event.botId, sourceQueue);
            const stats = leo.streams.stats(event.botId, sourceQueue);
            
            // Pipe the data through transform to the destination queue
            stream
                .pipe(transform)
                .pipe(stats)
                .pipe(destinationSdk.load(event.botId, destinationQueue))
                .on('error', (err) => {
                    logger.error("Error in replication stream:", err);
                    callback(err);
                })
                .on('end', () => {
                    logger.info("Replication complete");
                    // Checkpoint the source queue to mark events as processed
                    stats.checkpoint(callback);
                });
        })
        .catch(err => {
            logger.error("Error assuming role:", err);
            callback(err);
        });
}); 