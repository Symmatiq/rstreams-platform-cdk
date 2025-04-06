"use strict";
var leo = require("leo-sdk")
var dynamodb = leo.aws.dynamodb;
var statsBuckets = require("./stats-buckets.js");
var zlib = require("zlib");
var refUtil = require("leo-sdk/lib/reference.js");
let logger = require("leo-logger")("stats-lib");

let moment = require("moment");
let later = require("later");
require("moment-round");
let async = require("async");
let _ = require('lodash');

const humanize = require("./humanize.js");

var CRON_TABLE = leo.configuration.resources.LeoCron;
var EVENT_TABLE = leo.configuration.resources.LeoEvent;
var SYSTEM_TABLE = leo.configuration.resources.LeoSystem;
var STATS_TABLE = JSON.parse(process.env.Resources).LeoStats;

let statsCache = {};

const systemSegments = parseInt(process.env.SYSTEM_SCAN_SEGMENTS) || 1;
const botSegments = parseInt(process.env.BOT_SCAN_SEGMENTS) || 1;
const queueSegments = parseInt(process.env.QUEUE_SCAN_SEGMENTS) || 1;


module.exports = function(event, callback) {
	var useLatestCheckpoints = event.params.querystring.useLatestCheckpoints == true;
	var request_timestamp = moment(event.params.querystring.timestamp);
	var period = event.params.querystring.range;
	var numberOfPeriods = event.params.querystring.count || 1;
	var rolling = event.params.querystring.rolling == undefined ? true : !!event.params.querystring.rolling;
	var includeRawBotData = event.includeRawBotData;

	var range = statsBuckets.ranges[period] || {
		period: period,
		count: 1,
		startOf: (timestamp) => timestamp.startOf(period.replace(/_[0-9]+$/))
	};

	var inclusiveStart = true;
	var inclusiveEnd = false;
	var endNextCount = 1;
	if (!rolling && range.startOf) {
		request_timestamp = range.startOf(request_timestamp);
		endNextCount = range.count;
	} else if (rolling && statsBuckets.ranges[period] && statsBuckets.ranges[period].rolling && numberOfPeriods == 1) {
		range = statsBuckets.ranges[period].rolling;
	}
	var bucketUtils = statsBuckets.data[range.period];
	period = bucketUtils.period;

	logger.log("Requested Timestamp:", request_timestamp.format(), range.count, numberOfPeriods)
	var endTime = bucketUtils.value(bucketUtils.next(request_timestamp.clone(), endNextCount));
	var startTime = bucketUtils.prev(endTime, range.count * numberOfPeriods);

	var out = {
		start: startTime.valueOf(),
		end: endTime.valueOf(),
		period: range.period,
		nodes: {
			system: {},
			bot: {},
			queue: {}
		}
	};
	var isCurrent = true;
	var compare_timestamp = request_timestamp.clone();
	if (out.end < moment.now()) {
		compare_timestamp = moment(out.end);
		isCurrent = false;
	}
	if (out.end >= moment.now()) {
		compare_timestamp = moment();
		isCurrent = true;
	}
	if (isCurrent) {
		useLatestCheckpoints = true;
	}

	async.parallel({
		systems: systemsProcessor,
		queues: queuesProcessor,
		bots: botsProcessor,
		stats: statsProcessorParallel,
	}, (err, results) => {
		if (err) {
			logger.log(err);
			return callback(err);
		}
		merge(results, callback);
	});

	function merge(results, done) {
		let statsData = results.stats;

		out.nodes.system = results.systems;
		out.nodes.bot = results.bots;
		out.nodes.queue = results.queues;

		// Post Process Bots
		Object.keys(out.nodes.bot).map(key => {
			let bot = out.nodes.bot[key];

			Object.keys(bot.link_to.parent).map(key => {
				get(key).link_to.children[bot.id] = Object.assign({}, bot.link_to.parent[key], {
					id: bot.id
				});
			});

			Object.keys(bot.link_to.children).map(key => {
				let link = bot.link_to.children[key];
				let child = get(key);

				if (useLatestCheckpoints && child.latest_checkpoint <= link.checkpoint) {
					child.latest_checkpoint = link.checkpoint;
				}
				if (useLatestCheckpoints && child.latest_write <= link.last_write) {
					child.latest_write = link.last_write;
				}
				child.link_to.parent[bot.id] = Object.assign({}, link, {
					id: bot.id
				});
			});

		});

		// Merge In Stats
		Object.keys(statsData).map(botId => {
			let botStats = statsData[botId];
			let exec = botStats.execution;

			var bot = get(botId);
			bot.executions = exec.units;
			bot.errors = exec.errors; //Math.max(exec.errors, exec.units - exec.completions);
			if (bot.health && bot.health.error_limit && typeof bot.health.error_limit === 'number') {
				bot.expect.error_limit = bot.health.error_limit;
			}
			if (bot.errors >= 1 && bot.errors >= bot.executions * bot.expect.error_limit && !bot.archived) {
				bot.isAlarmed = true;
				bot.alarms.errors = {
					value: bot.errors,
					limit: `${bot.errors} > ${bot.executions * bot.expect.error_limit}`,
					msg: ` ${bot.errors} > ${bot.executions * bot.expect.error_limit}`
				};
			}
			bot.duration = {
				min: exec.min_duration,
				max: exec.max_duration,
				total: exec.duration,
				avg: exec.duration / exec.units
			}

			// Reads
			Object.keys(botStats.read).map(key => {
				let linkData = botStats.read[key];
				let other = get(key);

				let data = {
					type: "read",
					last_read: linkData.timestamp,
					last_event_source_timestamp: linkData.source_timestamp,
					checkpoint: linkData.checkpoint,
					units: linkData.units,
					test: true
				}

				if (isCurrent && other.link_to.children[bot.id]) {
					let currentStats = other.link_to.children[bot.id]
					data.checkpoint = currentStats.checkpoint;
					data.last_read = currentStats.last_read;
					data.last_event_source_timestamp = currentStats.last_event_source_timestamp;
				}

				bot.link_to.parent[other.id] = Object.assign({}, data, {
					id: other.id
				});

				other.link_to.children[bot.id] = Object.assign({}, data, {
					id: bot.id
				});

			});

			// Writes
			Object.keys(botStats.write).map(key => {
				let linkData = botStats.write[key];
				let other = get(key);

				let data = {
					type: "write",
					last_write: linkData.timestamp,
					last_event_source_timestamp: linkData.source_timestamp,
					checkpoint: linkData.checkpoint,
					units: linkData.units,
					test: true
				};

				if (isCurrent && other.link_to.parent[bot.id]) {
					let currentStats = other.link_to.parent[bot.id];
					data.checkpoint = currentStats.checkpoint;
					data.last_write = currentStats.last_write;
					data.last_event_source_timestamp = currentStats.last_event_source_timestamp;
				}

				bot.link_to.children[other.id] = Object.assign({}, data, {
					id: other.id
				});

				other.link_to.parent[bot.id] = Object.assign({}, data, {
					id: bot.id
				});

				other.latest_write = Math.max(linkData.timestamp, other.latest_write)
				if (!other.latest_checkpoint || other.latest_checkpoint.localeCompare(linkData.checkpoint) <= 0) {
					other.latest_checkpoint = linkData.checkpoint
				};
			});
		});

		// Post Process Queues
		["queue", "system"].map(type => {
			Object.keys(out.nodes[type]).map(key => {
				let queue = out.nodes[type][key];
				if (queue.owner) {
					queue.hidden = true;
					let ownerCheck = queue.id.replace(/^(system|bot)\./, '$1:');
					if (out.nodes.system[ownerCheck] || out.nodes.bot[ownerCheck]) {
						queue.owner = ownerCheck;
					}
					let owner = get(queue.owner);
					owner.subqueues.push(queue.id);
					let ref = refUtil.ref(queue.id);
					let q = ref.owner().queue;

					// Rename the label if there is a sub queue
					if (queue.label === ref.id && q) {
						queue.label = owner.label + " - " + q;
					}
				}

				// Post Processing on Write Links
				Object.keys(queue.link_to.parent).map(key => {
					let link = queue.link_to.parent[key];
					let bot = get(key);
					let link2 = bot.link_to.children[queue.id];

					link2.event_source_lag = link.event_source_lag = moment(link.last_write).diff(link.last_event_source_timestamp);
					if (link.event_source_lag >= queue.expect.max_event_lag && !queue.archived) {
						link.isAlarmed = link2.isAlarmed = true;
						link.alarms.event_source_lag = link2.alarms.event_source_lag = {
							value: link.event_source_lag,
							msg: ` ${humanize(link.event_source_lag)} >= ${humanize(queue.expect.max_event_lag)} `
						};
					}

					link.checkpoint_lag = link2.checkpoint_lag = Math.max(0, moment(link.last_write).diff(moment(link.checkpoint)));
					if (link.checkpoint_lag >= queue.expect.max_checkpoint_lag && !queue.archived) {
						link.isAlarmed = link2.isAlarmed = true;
						link.alarms.checkpoint_lag = link2.alarms.checkpoint_lag = {
							value: link.checkpoint_lag,
							msg: ` ${humanize(link.checkpoint_lag)} >= ${humanize(queue.expect.max_checkpoint_lag)} `
						}
					}
				});

				// Post Processing on Read Links
				Object.keys(queue.link_to.children).map(key => {
					let link = queue.link_to.children[key];
					let bot = get(key);
					let link2 = bot.link_to.parent[queue.id];

					link.last_read_lag = link2.last_read_lag = Math.max(0, moment(compare_timestamp).diff(link.last_read));
					if (link.last_read_lag >= queue.expect.max_last_read_lag && !queue.archived) {
						link.isAlarmed = link2.isAlarmed = true;
						link.alarms.last_read_lag = link2.alarms.last_read_lag = {
							value: link.last_read_lag,
							msg: ` ${humanize(link.last_read_lag)} >= ${humanize(queue.expect.max_last_read_lag)} `
						}
					}
					link.event_source_lag = link2.event_source_lag = Math.max(0, moment(link.last_read).diff(link.last_event_source_timestamp));
					if (link.event_source_lag >= queue.expect.max_event_lag && !queue.archived) {
						link.isAlarmed = link2.isAlarmed = true;
						link.alarms.event_source_lag = link2.alarms.event_source_lag = {
							value: link.event_source_lag,
							msg: ` ${humanize(link.event_source_lag)} >= ${humanize(queue.expect.max_event_lag)} `
						}
					}

					link.checkpoint_lag = link2.checkpoint_lag = Math.max(0, moment(link.last_read).diff(moment(link.checkpoint)));
					if (link.checkpoint_lag >= queue.expect.max_checkpoint_lag && !queue.archived) {
						link.isAlarmed = link2.isAlarmed = true;
						link.alarms.checkpoint_lag = link2.alarms.checkpoint_lag = {
							value: link.checkpoint_lag,
							msg: ` ${humanize(link.checkpoint_lag)} >= ${humanize(queue.expect.max_checkpoint_lag)} `
						}
					}
				});
			});
		});

		// Post Process Bots Again
		Object.keys(out.nodes.bot).map(key => {
			let bot = out.nodes.bot[key];
			let isAlarmed = bot.isAlarmed || false;

			// Post Processing on Write Links
			Object.keys(bot.link_to.parent).map(key => {
				let link = bot.link_to.parent[key];
				isAlarmed = isAlarmed || link.isAlarmed;
			});

			// Post Processing on Read Links
			Object.keys(bot.link_to.children).map(key => {
				let link = bot.link_to.children[key];
				isAlarmed = isAlarmed || link.isAlarmed;
			});
			bot.isAlarmed = isAlarmed;
		});

		// Filter out hidden
		out.nodes = {
			system: _.pickBy(out.nodes.system, (value, key) => !value.hidden),
			bot: _.pickBy(out.nodes.bot, (value, key) => !value.hidden),
			queue: _.pickBy(out.nodes.queue, (value, key) => !value.hidden)
		};

		done(null, out);
	}

	function statsProcessorParallel(done) {
		let times = splitTime(startTime, endTime);
		parallelQuery(times.map(time => ({
			TableName: STATS_TABLE,
			KeyConditionExpression: "#id = :id and #time >= :starttime",
			ExpressionAttributeNames: {
				"#id": "id",
				"#time": "time"
			},
			ExpressionAttributeValues: {
				":id": period + "-" + time.format("YYYYMMDD"),
				":starttime": startTime.valueOf()
			},
			ExclusiveStartKey: undefined,
			Limit: 20000
		})), {}, (rows) => {
			return rows.filter(r => {
				return r.time >= startTime.valueOf() && r.time < endTime.valueOf();
			});
		}).then((results) => {
			done(null, mergeStatsResults(results));
		}).catch(err => {
			done(err);
		});
	}

	function statsProcessor(done) {
		dynamodb.query({
			TableName: STATS_TABLE,
			KeyConditionExpression: "#id = :id and #time >= :starttime and #time < :endtime",
			ExpressionAttributeNames: {
				"#id": "id",
				"#time": "time"
			},
			ExpressionAttributeValues: {
				":id": period + "-" + startTime.format("YYYYMMDD"),
				":starttime": startTime.valueOf(),
				":endtime": endTime.valueOf()
			},
			ExclusiveStartKey: undefined,
			Limit: 20000
		}, {
			method: "query",
			maxAttempts: 10,
			duration: 1200
		}).then(result => {
			done(null, mergeStatsResults(result.Items));
		}).catch(err => {
			done(err);
		});
	}

	function get(id, type) {
		var ref = refUtil.ref(id, type);
		type = ref.type;
		let node = out.nodes[type][ref.id];
		if (!node) {
			node = create(ref);
		}
		return node;
	}

	function create(ref) {
		var node;
		if (ref.type == "bot") {
			node = createBot(ref.id);
		} else if (ref.type == "queue") {
			node = createQueue(ref.id);
		} else if (ref.type == "system") {
			node = createSystem(ref.id);
		}
		out.nodes[ref.type][ref.id] = node;
		return node;
	}

	function createSystem(systemId) {
		return {
			id: systemId,
			label: systemId,
			type: "system",
			subqueues: [],
			hidden: false,
			archived: false,
			latest_write: 0,
			latest_checkpoint: "",
			expect: {
				max_event_lag: moment.duration(10, "minutes").valueOf(),
				max_checkpoint_lag: moment.duration(1, "hour").valueOf(),
				max_last_read_lag: moment.duration(10, "minutes").valueOf()
			},
			link_to: {
				parent: {},
				children: {}
			}
		};
	}

	function createQueue(queueId) {
		return {
			id: queueId,
			label: queueId,
			type: "queue",
			hidden: false,
			archived: false,
			latest_write: 0,
			latest_checkpoint: "",
			expect: {
				max_event_lag: moment.duration(10, "minutes").valueOf(),
				max_checkpoint_lag: moment.duration(1, "hour").valueOf(),
				max_last_read_lag: moment.duration(10, "minutes").valueOf()
			},
			link_to: {
				parent: {},
				children: {}
			}
		};
	}

	function createBot(botId) {
		return {
			id: botId,
			label: botId,
			type: "bot",
			hidden: false,
			archived: false,
			executions: 0,
			errors: 0,
			isAlarmed: false,
			alarms: {},
			paused: false,
			expect: {
				max_error_count: 1,
				error_limit: 0.02,
				max_duration: moment.duration(10, "minutes").valueOf(),
				min_duration: 0,
				avg_duration: 0
			},
			link_to: {
				parent: {},
				children: {}
			}
		}
	}

	function systemsProcessor(done) {
		var systems = {};
		parallelScan({
			TableName: SYSTEM_TABLE,
			AttributesToGet: ["id", "description", "paused", "name", "owner", "expect", "tags", "archived"]
		}, {}, systemSegments).then(results => {
			results.Items.map(item => {
				var node = get(item.id, "system");
				node.label = item.name || node.label;
				node.tags = item.tags || "";
				node.owner = item.owner;
				node.paused = item.paused || false;
				node.archived = item.archived || false;
				node.description = item.description;
				node.expect = Object.assign({}, node.expect, item.expect);
			});
			done(null, systems);
		}).catch(err => {
			done(err);
		});
	}

	function queuesProcessor(done) {
		var queues = {};
		parallelScan({
			TableName: EVENT_TABLE,
			AttributesToGet: ["id", "description", "paused", "name", "owner", "expect", "tags", "archived", "latest_write", "latest_checkpoint"]
		}, {}, queueSegments).then(results => {
			results.Items.map(item => {
				var node = get(item.id, "queue");
				node.label = item.name || node.label;
				node.tags = item.tags || "";
				node.owner = item.owner;
				node.paused = item.paused || false;
				node.archived = item.archived || false;
				node.description = item.description;
				node.expect = Object.assign({}, node.expect, item.expect);
				node.latest_checkpoint = item.latest_checkpoint;
				node.latest_write = item.latest_write;
			});
			done(null, queues);
		}).catch(err => {
			done(err);
		});
	}

	function botsProcessor(done) {
		var bots = {};
		parallelScan({
			TableName: CRON_TABLE,
			AttributesToGet: ["id", "description", "paused", "name", "trigger", "owner", "expect", "tags", "archived", "health"]
		}, {}, botSegments).then(results => {
			results.Items.map(item => {
				var node = get(item.id, "bot");
				node.label = item.name || node.label;
				node.tags = item.tags || "";
				node.owner = item.owner;
				node.archived = item.archived || false;
				node.description = item.description;
				node.expect = Object.assign({}, node.expect, item.expect);
				node.health = Object.assign({}, item.health);

				node.trigger = item.trigger || "";
				node.paused = item.paused || false;

				if (node.paused) {
					//node.isAlarmed = true;
				}

				if (includeRawBotData) {
					node.raw = item;
				}

				let now = moment();
				try {
					if (node.paused) {
						node.next_run = null;
						node.prev_run = null;
					} else {
						let s = later.parse.cron(node.trigger, true);
						if (s.error == -1) {
							let next = later.schedule(s).next(2, now);
							node.next_run = next[0];
							node.prev_run = next[1];
						} else {
							node.next_run = null;
							node.prev_run = null;
						}
					}
				} catch (e) {
					node.next_run = null;
					node.prev_run = null;
					logger.error(node.trigger, e);
				}
			});
			done(null, bots);
		}).catch(err => {
			done(err);
		});
	}
}

function parallelScan(query, opts, segments) {
	let individualQueries = [];
	for (let i = 0; i < segments; i++) {
		individualQueries.push({
			query: Object.assign({
				Segment: i,
				TotalSegments: segments,
			}, query),
			opts: opts
		});
	}
	return promiseAllConcurrency(individualQueries.map(q => () => {
		return dynamodb.scan(q.query, q.opts);
	}), 10).then(results => {
		let data = {
			Items: [],
			Count: 0,
			ScannedCount: 0
		}
		results.map(r => {
			data.Items = data.Items.concat(r.Items);
			data.Count += r.Count;
			data.ScannedCount += r.ScannedCount;
		});
		return data;
	});
}

function parallelQuery(queries, opts, mergeFn) {
	mergeFn = mergeFn || ((results) => {
		return results;
	});
	return promiseAllConcurrency(queries.map(q => () => {
		return dynamodb.query(q, opts);
	}), 10).then(results => {
		let data = {
			Items: [],
			Count: 0,
			ScannedCount: 0
		}
		results.map(r => {
			data.Items = data.Items.concat(r.Items);
			data.Count += r.Count;
			data.ScannedCount += r.ScannedCount;
		});
		data.Items = mergeFn(data.Items);
		return data;
	});
}

function splitTime(start, end) {
	var current = start.clone();
	var dates = [start];
	let i = 0;
	while (current.valueOf() < end.valueOf() && i < 10) {
		current = current.add(1, 'd').startOf('d');
		if (current.valueOf() < end.valueOf()) {
			dates.push(current);
		}
		i++;
	}
	return dates;
}


function mergeStatsResults(bucketsStats) {
	var mergedStats = {};
	bucketsStats.map(bucket => {
		let id = refUtil.refId(bucket.id, "bot");
		let stats = bucket.stats || {};
		if (!(id in mergedStats)) {
			mergedStats[id] = {
				label: id,
				id: id,
				read: {},
				write: {},
				execution: {
					units: 0,
					errors: 0,
					duration: 0,
					max_duration: 0,
					min_duration: 99999999999999999
				}
			};
		}
		let mergedBotStats = mergedStats[id];
		Object.keys(stats).map(key => {
			if (key === "__execution") {
				mergeExecutionStats(mergedBotStats.execution, stats[key]);
			} else {
				var type = key.match(/^(read|write):/);
				if (type) {
					let otherId = key.substr(type[0].length);
					let other = type[1];
					if (!(otherId in mergedBotStats[other])) {
						mergedBotStats[other][otherId] = {
							units: 0,
							timestamp: 0,
							source_timestamp: 0,
							checkpoint: ""
						}
					}
					mergeStats(mergedBotStats[other][otherId], stats[key]);
				}
			}
		});
	});
	return mergedStats;
}

function max(a, b) {
	return Math.max(a, safeNumber(b));
}

function min(a, b) {
	return Math.min(a, safeNumber(b));
}

function sum(a, b, defaultValue) {
	return a + safeNumber(b, defaultValue);
}

function safeNumber(number, defaultValue) {
	defaultValue = defaultValue || 0;
	if (isNaN(number) || typeof number !== "number") {
		return defaultValue;
	}
	return number;
}

function mergeExecutionStats(s, r) {
	s.units = sum(s.units, r.units, 1);
	s.completions = sum(s.completions, r.completions);
	s.errors = sum(s.errors, r.errors);
	s.duration = sum(s.duration, r.duration);
	s.min_duration = min(s.min_duration, r.min_duration);
	s.max_duration = max(s.max_duration, r.max_duration);
}

function mergeStats(s, r) {
	s.units = sum(s.units, r.units);
	s.timestamp = max(s.timestamp, r.timestamp);
	s.source_timestamp = max(s.source_timestamp, r.source_timestamp);
	if (!s.checkpoint || s.checkpoint.localeCompare(r.checkpoint) <= 0) {
		s.checkpoint = r.checkpoint;
	}
}

function promiseAllConcurrency(queue, concurrency) {
	let results = [];
	return new Promise((resolve, reject) => {
		const execThread = () => {
			while (concurrency > 0 && queue.length > 0) {
				concurrency--;
				let index = results.length;
				results[index] = undefined;
				let item = queue.shift();
				item().then((result) => {
					concurrency++;
					results[index] = result;
					execThread();
				}).catch((err) => {
					concurrency = -1; // Stop processing others
					reject(err);
				});
			}
			if (queue.length <= 0 && results.filter(r => r !== undefined).length === results.length) {
				resolve(results);
			}
		};
		execThread();
	});
}