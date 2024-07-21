# [Message Queue in Node.js with BullMQ and Redis](https://medium.com/@techsuneel99/message-queue-in-node-js-with-bullmq-and-redis-7fe5b8a21475)

![Queue Servers, BullMQ, Redis](https://miro.medium.com/v2/resize:fit:1100/format:webp/1*Ok6IdEdEKg58R7vXsX6LLg.png)

```js
import { Queue, Worker } from "bullmq";

// Create a new connection in every instance
const myQueue = new Queue("myqueue", {
  connection: {
    host: "myredis.taskforce.run",
    port: 32856,
  },
});

const myWorker = new Worker("myqueue", async (job) => {}, {
  connection: {
    host: "myredis.taskforce.run",
    port: 32856,
  },
});
```

```js
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis();

// Reuse the ioredis instance
const myQueue = new Queue("myqueue", { connection });
const myWorker = new Worker("myqueue", async (job) => {}, { connection });
```

```js
const queue = new Queue("Cars");

await queue.add("paint", { color: "red" });
await queue.add("paint", { color: "blue" }, { delay: 5000 });
await myQueue.add(
  "test",
  { foo: "bar" },
  { removeOnComplete: true, removeOnFail: true }
);
await myQueue.add(
  "test",
  { foo: "bar" },
  { removeOnComplete: 1000, removeOnFail: 5000 }
);
await myQueue.add(
  "test",
  { foo: "bar" },
  {
    removeOnComplete: {
      age: 3600, // keep up to 1 hour
      count: 1000, // keep up to 1000 jobs
    },
    removeOnFail: {
      age: 24 * 3600, // keep up to 24 hours
    },
  }
);
const jobs = await queue.addBulk([
  { name, data: { paint: "car" } },
  { name, data: { paint: "house" } },
  { name, data: { paint: "boat" } },
]);
```

```js
await queue.drain();
const deletedJobIds = await queue.clean(
  60000, // 1 minute
  1000, // max number of jobs to clean
  "paused"
);
await queue.obliterate();
```

## Workers

**_Workers are the actual instances that perform some job based on the jobs that are added in the queue. A worker is equivalent to a "message" receiver in a traditional message queue. The worker's duty is to complete the job. If it succeeds, the job will be moved to the "completed" status. If the worker throws an exception during its processing, the job will automatically be moved to the "failed" status. A worker is instantiated with the Worker class, and the work itself will be performed in the process function. Process functions are meant to be asynchronous, using either the async keyword or returning a promise._**

```js
import { Worker, Job } from "bullmq";

const worker = new Worker(queueName, async (job: Job) => {
  // Optionally report some progress
  await job.updateProgress(42);

  // Optionally sending an object as progress
  await job.updateProgress({ foo: "bar" });

  // Do something with job
  return "some value";
});

worker.on("completed", (job: Job, returnvalue: any) => {
  // Do something with the return value.
});
worker.on("progress", (job: Job, progress: number | object) => {
  // Do something with the return value.
});
worker.on("failed", (job: Job, error: Error) => {
  // Do something with the return value.
});
worker.on("error", (err) => {
  // log the error
  console.error(err);
});
```

```js
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint');

queueEvents.on('completed', ({ jobId: string, returnvalue: any }) => {
  // Called every time a job is completed by any worker.
});

queueEvents.on('failed', ({ jobId: string, failedReason: string }) => {
  // Called whenever a job is moved to failed by any worker.
});

queueEvents.on('progress', ({jobId: string, data: number | object}) => {
  // jobId received a progress event
});
```

> **_It is also possible to listen to global events in order to get notifications of job completions, progress and failures._**

> [Job Scheduling in Node.js with BullMQ](https://betterstack.com/community/guides/scaling-nodejs/bullmq-scheduled-tasks/#prerequisites)  
> [Design a Hotel Booking System](https://javascript.plainenglish.io/how-to-design-a-hotel-booking-system-56ef18b6adfc)
