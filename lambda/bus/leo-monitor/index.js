import { unmarshall } from "@aws-sdk/util-dynamodb";
import leo from "leo-sdk";
import cron from "leo-sdk/wrappers/cron";

const ID = "leo_cron_monitor";

exports.handler = function(event, context, callback) {

	var loader = leo.load(ID, "monitor", { partitionHashKey: process.env.SHARD_HASH_KEY });
	event?.Records.forEach((record) => {
		let now = record.dynamodb.ApproximateCreationDateTime * 1000;
		var newImage = {
			trigger: 0,
			invokeTime: 0
		};
		var oldImage = {
			trigger: 0,
			invokeTime: 0
		};

		if ("NewImage" in record.dynamodb) {
		  newImage = unmarshall(record.dynamodb.NewImage);
		}
		if ("OldImage" in record.dynamodb) {
		  oldImage = unmarshall(record.dynamodb.OldImage);
		}

		if (newImage.id == ID || newImage.ignoreMonitor === true) {
			return;
		}

		// Let's check if it started since last time
		if (newImage.instances) {
			Object.keys(newImage.instances).forEach(i => {
				var instance = newImage.instances[i];
				var oldInstance = oldImage && oldImage.instances && oldImage.instances[i];
				if (instance.completedTime && (!oldInstance || oldInstance.completedTime == undefined)) {
					const start = (oldInstance && oldInstance.invokeTime) || now;
					var end = instance.completedTime || now;
					loader.write({
						id: newImage.id,
						type: 'completed',
						ts: end,
						start: start,
						is_error: instance.status == "error"
					});
				} else if (instance.invokeTime && (!oldInstance || oldInstance.invokeTime != instance.invokeTime)) {
					const start = instance.invokeTime;
					loader.write({
						id: newImage.id,
						type: 'started',
						start: start
					});
				}
			});
		}

		// Check for Checkpoint Read Events
		if (newImage.checkpoints?.read) {
			Object.keys(newImage.checkpoints.read).forEach(event => {
				var newCheckpoint = newImage.checkpoints.read[event];
				var oldCheckpoint = oldImage && oldImage.checkpoints &&
					oldImage.checkpoints.read && oldImage.checkpoints.read[event] &&
					oldImage.checkpoints.read[event].checkpoint;

				if (oldCheckpoint != newCheckpoint.checkpoint && typeof newCheckpoint.records != undefined) {
					loader.write({
						id: newImage.id,
						type: 'read',
						from: event,
						checkpoint: newCheckpoint.checkpoint,
						ts: newCheckpoint.ended_timestamp || now,
						units: newCheckpoint.records,
						start: newCheckpoint.started_timestamp || now,
						source_ts: newCheckpoint.source_timestamp || now
					});
				}
			});
		}

		//CHeck for Checkpoint Writes
		if (newImage.checkpoints?.write) {
			Object.keys(newImage.checkpoints.write).forEach(event => {
				var newCheckpoint = newImage.checkpoints.write[event];
				var oldCheckpoint = oldImage && oldImage.checkpoints &&
					oldImage.checkpoints.write && oldImage.checkpoints.write[event] &&
					oldImage.checkpoints.write[event].checkpoint;
				if (oldCheckpoint != newCheckpoint.checkpoint && typeof newCheckpoint.records != undefined) {
					loader.write({
						id: newImage.id,
						type: 'write',
						to: event,
						checkpoint: newCheckpoint.checkpoint,
						ts: newCheckpoint.ended_timestamp || now,
						units: newCheckpoint.records,
						start: newCheckpoint.started_timestamp || now,
						source_ts: newCheckpoint.source_timestamp || now
					});
				}
			});
		}
	});
	loader.end(callback);

};


