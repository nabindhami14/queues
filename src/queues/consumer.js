const { Worker } = require("bullmq");

const redisConfiguration = {
  connection: {
    host: "localhost",
    port: 6379,
  },
};

function sendEmail(job) {
  const { email, message } = job.data;
  console.log(`Message ${message} was sent to ${email}.`);
}

const worker = new Worker("emailSchedule", sendEmail, {
  redisConfiguration,
  batches: { size: 10 },
  concurrency: 5,
});

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

worker.on("progress", (job) => {
  console.info(`${job.id} in progress!`);
});

worker.on("completed", (job) => {
  console.info(`${job.id} has completed!`);
});

worker.on("failed", (job, err) => {
  console.error(`${job.id} has failed with ${err.message}`);
});
