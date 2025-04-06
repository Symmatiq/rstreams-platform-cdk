let legacy = require("leo-cron/lib/legacy.js");

import scheduler from "leo-cron/lib/scheduler.js";

const handler = scheduler(Object.assign({
	region: process.env.AWS_DEFAULT_REGION,
	LeoCron: process.env.LeoCron,
	LeoSettings: process.env.LeoSettings
}, legacy));

export default handler
export { handler }
