import { Queue } from "bullmq";

export const redisOptions = { host: "localhost", port: 6379 };

const myQueue = new Queue("myQueue", { connection: redisOptions });

async function addJob(job, priority) {
  const options = { repeat: { every: 5000 } };

  if (priority !== undefined) {
    options.priority = priority;
  }
  await myQueue.add(job.name, job, options);
}

export const welcomeMessage = () => {
  console.log("Sending a welcome message every few seconds");
};
export const exportData = (job) => {
  const { name, path } = job.data.jobData;
  console.log(`Exporting ${name} data to ${path}`);
};

await addJob({ name: "welcomeMessage" });
await addJob({
  name: "dataExport",
  jobData: {
    name: "Sales report",
    path: "/some/path",
  },
});
