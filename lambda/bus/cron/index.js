import legacy from "leo-cron/lib/legacy.js";

import processor from "leo-cron/lib/processor.js";

const handler = processor(Object.assign({
	region: process.env.AWS_DEFAULT_REGION,
	tableName: process.env.LeoCron
}, legacy));

export default handler

export { handler }
