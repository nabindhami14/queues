const Redis = require("ioredis");
const express = require("express");

const app = express();

const redis = new Redis();

// a counter for keeping track of currently running jobs
let running = 0;

// max number of jobs that can be executed concurrently
const MAX_JOBS = 3;

// Mocked time-consuming function
const timeConsumingFunction = async () => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() > 0.5) { // Simulates a 50% chance of failure
        console.log("Job executed successfully");
        resolve();
      } else {
        console.log("Job failed, will retry");
        reject(new Error("Job failed"));
      }
    }, 5000); // Simulates a task taking 5 seconds
  });
};

app.use(express.json());

app.post("/", async (req, res) => {
  try {
    const { name, id } = req.body;

    // push the data to the back of the list/queue
    await redis.rpush("todo", JSON.stringify({ name, id }));
  } catch (e) {
    console.error(e);
  }
  res.status(200).end();
});

const acquireLock = async (key) => {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      // set the `todo-lock` or `processing-lock` to "locked", if it doesn't already exist
      // "NX" option stands for Only set this value if it not exists and return OK, otherwise return null
      // "EX", 10 is the expire time of the lock, this key is deleted after 10 seconds
      redis
        .set(`${key}-lock`, "locked", "NX", "EX", 10)
        .then((res) => {
          if (res) {
            // if res is not null, then we set the lock successfully and can clear the interval
            resolve(res);
            clearInterval(interval);
          }
        })
        .catch((err) => {
          reject(err);
          clearInterval(interval);
        });
    }, 5000);
  });
};

// for deleting the lock programmatically
// although it will expire after 10 seconds
const releaseLock = async (key) => {
  // delete the lock for `todo` or `processing` queue
  await redis.del(`${key}-lock`);
};

const execute = async () => {
  if (running < MAX_JOBS) {
    running += 1; // Increase the running count
    try {
      // try to acquire the lock for `todo` queue if another process hasn't acquired that already
      await acquireLock("todo");

      // get the first job
      const newProcess = await redis.lindex("todo", 0);
      if (newProcess) {
        const copy = JSON.parse(newProcess);
        copy.timestamp = Date.now(); // add a Unix timestamp to the job, we will use this later
        copy.tries = copy.tries ? copy.tries + 1 : 1; // update the number of tries for this job
        await redis
          .multi() // multi is for chaining Redis commands in one transaction
          .lset("todo", 0, JSON.stringify(copy)) // set the first job with `timestamp` and `tries`
          .lmove("todo", "processing", "LEFT", "RIGHT") // move the first job to the back of `processing`
          .exec(); // if any command fails, revert everything back
        // release lock on `todo` queue as we have accessed the job and moved to `processing` queue
        await releaseLock("todo");

        // replace this function with your actual code
        await timeConsumingFunction();
        // job has been executed at this point

        await acquireLock("processing"); // acquire lock for `processing` queue
        await redis.lrem("processing", 1, JSON.stringify(copy)); // delete the current job from processing as it's been executed
        await releaseLock("processing"); // release lock for `processing` queue
      } else {
        await releaseLock("todo"); // release lock for `todo` queue if there was no job in the queue
      }
    } catch (err) {
      console.error(err);
    }
    running -= 1; // Decrease the running count
  }
};

// check for new jobs every five minutes
setInterval(() => {
  execute();
}, 5 * 60 * 1000); 

const retry = async () => {
  try {
    await acquireLock("processing"); // acquire lock for `processing` to avoid conflicts
    const res = await redis.lindex("processing", 0); // get the first processing job
    if (res) {
      const processing = JSON.parse(res);
      if (Date.now() - Number(processing.timestamp) >= 10 * 60 * 1000) {
        // check if it's been more than 10 minutes
        if (Number(processing.tries) < 3) {
          // if `tries` are less than 3, move back to `todo` queue
          await redis
            .multi()
            .lset("processing", 0, JSON.stringify(processing))
            .lmove("processing", "todo", "LEFT", "RIGHT")
            .exec();
        } else {
          await redis.lpop("processing"); // otherwise if tries exceeded, delete the job
        }
      }
      await releaseLock("processing"); // release the lock
    } else {
      await releaseLock("processing"); // release the lock if no job
    }
  } catch (err) {
    console.error(err);
  }
};

// check every 10 minutes for retrying
setInterval(() => {
  retry();
}, 10 * 60 * 1000);

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
