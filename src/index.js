const express = require("express");
const { Queue, Worker } = require("bullmq");

const app = express();

const MAX_JOBS = 3;

// Middleware to parse JSON bodies
app.use(express.json());

// Time-consuming function simulating a job
const timeConsumingFunction = async (name, id) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() > 0.5) {
        // Simulate a 50% chance of failure
        console.log("Job executed successfully", name, id);
        resolve();
      } else {
        console.log("Job failed, will retry");
        reject(new Error("Job failed"));
      }
    }, 5000); // Simulate a task taking 5 seconds
  });
};

// Create a queue
const queue = new Queue("todo", {
  connection: {
    port: 6379,
    host: "localhost", // Use localhost or the appropriate host for your Redis server
  },
  defaultJobOptions: {
    attempts: 3, // Number of attempts for failed jobs
    backoff: {
      type: "exponential",
      delay: 1000, // Retry after 1 second
    },
  },
});

// Create a worker to process jobs from the queue
const worker = new Worker(
  "todo", // The name should match the queue name
  async (job) => {
    const { name, id } = job.data;
    await timeConsumingFunction(name, id);
  },
  {
    concurrency: MAX_JOBS,
    connection: {
      port: 6379,
      host: "localhost", // Use localhost or the appropriate host for your Redis server
    },
  }
);

// Endpoint to add jobs to the queue
app.post("/", async (req, res) => {
  try {
    const { name, id } = req.body;
    await queue.add("job", { name, id });
    res.status(200).json({ message: "Job added to the queue" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to add job to the queue" });
  }
});

// Start the server
app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
