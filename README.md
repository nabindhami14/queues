# [Implementing a job queue in Nodejs](https://medium.com/sliceofdev/implementing-a-job-queue-in-nodejs-2bcfebf52d2b)

```js
flowchart TD
  A[Initialize Express Server] --> B[API Endpoint POST /]
  B --> |Receive job data| C[Add job to Redis 'todo' queue]

  subgraph Job Execution
    D[Check running jobs < MAX_JOBS] --> E[Acquire lock on 'todo' queue]
    E --> F[Get first job from 'todo' queue]
    F --> G[Move job to 'processing' queue]
    G --> H[Execute job with timeConsumingFunction]
    H --> I[Job executed successfully?]
    I --> |Yes| J[Remove job from 'processing' queue]
    I --> |No| K[Log job failure, will retry]
    J --> L[Release lock on 'processing' queue]
    K --> L
    L --> M[Decrease running jobs count]
  end

  subgraph Retry Mechanism
    N[Periodically check 'processing' queue] --> O[Get first job from 'processing']
    O --> P[Job timestamp > 10 minutes?]
    P --> |Yes| Q[Job retries < 3?]
    Q --> |Yes| R[Move job back to 'todo' queue]
    Q --> |No| S[Remove job from 'processing' queue]
    R --> T[Release lock on 'processing' queue]
    S --> T
    P --> |No| T
  end

  D <--> N
```

```js
// array for storing and simulating a queue
const queue = [];

// a counter for keeping track of currently running jobs
let running = 0;

// max number of jobs that can be executed concurrently
const MAX_JOBS = 3;

app.post("/", (req, res) => {
  try {
    const { name, id } = req.body;
    queue.push({ name, id });
  } catch (e) {
    console.error(e);
  }
  res.status(200).end();
});

const execute = async () => {
  if (running < MAX_JOBS && queue.length !== 0) {
    running += 1;

    // get the first element/job from the queue
    const { name, id } = queue.shift();
    await timeConsumingFunction(name, id);
    running -= 1;
  }
};

// poll every minute to call execute function
setInterval(() => {
  execute();
}, 60 * 1000);
```

> **_The above code gets the job done in an ideal world. But, this will fail in the real world. What happens when you restart the server? You lose the track of currently running processes and also the current jobs in the queue. What happens when a job fails during processing? You lose that job forever because it's already been popped from the queue. What about multiple workers/instances? You cant actually share the queue with other instances because it lives in your server and is only accessible on your server. So no chance of a distributed system._**

## [REDIS](https://github.com/luin/ioredis)

Redis is a key-value pair based database. We are using Redis, particularly for the reason that it provides features like data structures (list, set, map, etc) and TTL (time to live) out of the box. We will be using the list data structure of Redis to simulate a queue. And for interacting with Redis we will be using the `ioredis` library for Nodejs.

Here, we will still be using the same pattern as before, only the code about creating and handling the queue will change. We will also be now having two queues todo and processing . The todo queue will contain jobs waiting to get executed and processing will contain jobs that are currently getting processed. We are doing this to have a fail-safe mechanism. When a job is ready to get executed we move that job from todo to processing and only remove the job from processing if the execution was successful. If the execution fails, the job will be moved back to the todo list at the back of the queue. This way we never really lose the failed jobs and can execute them again.

What happens when you restart the server? No data is lost as the job data is stored in a persistent database. On a restart, you can still access the job data waiting to get processed. What happens when a job fails during processing? If the system crashes or job execution fails, the failed job is again moved to the todo list from the processing list and it gets processed again after a while. What about multiple workers/instances? Multiple workers and instances can connect to Redis and execute the jobs without relying on your main server.

We will be having two extra parameters for each job to handle failures. We will use tries to keep track of how many times the job has been sent to the processing list. We will just delete the job after 3 tries if it doesn't succeed.
Another parameter will be timestamp to store check if a job has been in the processing queue for a long time (most probably the system crashed during the execution). If the difference between the current time and the timestamp is more than 10 minutes, move this process back to the todo queue.

```js
const { default: Redis } = require("ioredis");

const redis = new Redis({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD,
});

module.exports = redis;
```

```js
let running = 0
const MAX_JOBS = 3

app.post("/", (req, res) => {
  try {
    const { name, id } = req.body

    // push the data to the back of the list/queue
    await redis.rpush(
      'todo', // list name in redis, this will store jobs to be processed
      JSON.stringify({ name, id })
    )
  } catch (e) {
    console.error(e)
  }
  res.status(200).end()
})
```

```js
const acquireLock = async (key) => {
  return new Promise((resolve, reject) => {
    // check every 5 seconds if lock can be acquired
    const interval = setInterval(() => {
      // set the `todo-lock` or `processing-lock` to "locked", if it doesnt already exist
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

// for deleting the lock programatically
// although it will expire after 10 seconds
const releaseLock = async (key) => {
  // delete the lock for `todo` or `processing` queue
  await redis.del(`${key}-lock`);
};
```

```js
const execute = async () => {
  // execute only if currenly running processes are less than max_jobs
  if (running < MAX_JOBS) {
    try {
      // try to acquire the lock for `todo` queue if another process havent acquired that already
      await acquireLock("todo");
      // get the first job
      const newProcess = await redis.lindex("todo", 0);
      if (newProcess) {
        const copy = JSON.parse(newProcess);
        copy.timestamp = Date.now(); // add a unix timestamp to the job, we will use this later
        copy.tries = copy.tries ? copy.tries + 1 : 1; // update the number of tries for this job
        await redis
          .multi() // multi is for chaining redis commands in one transaction
          .lset("todo", 0, JSON.stringify(copy)) // set the first job with `timestamp` and `tries`
          .lmove("todo", "processing", "LEFT", "RIGHT") // move the first job to the back of `processing`
          .exec(); // if any command fails, revert everything back
        // release lock on `todo` queue as we have accessed the job and moved to `processing` queue
        await releaseLock("todo");

        // replace this function with your actual code
        await timeConsumingFunction();
        // job has been executed at this point

        await acquireLock("processing"); // acquire lock for `processing` queue
        await redis.lrem("processing", 1, JSON.stringify(copy)); // delete the current job from processing as its been executed
        await releaseLock("processing"); // release lock for `processing` queue
      } else {
        await releaseLock("todo"); // release lock for `todo` queue if there was no job in the queue
      }
    } catch (err) {
      console.error(err);
    }
    running -= 1;
  }
};

// check for new jobs every five minutes
setInterval(() => {
  execute();
}, 5 * 60 * 1000); // tweak this as you need
```

> **_This will first try to acquire the lock for the todo queue, then access the element and transfer it to processing queue, then release the lock for todo queue and execute the job. This will also delete the job from the processing queue after acquiring the lock._**

At this point, we have a system that will check for new jobs and execute them. But what about the failed jobs that crashed due to system crashes? We got that covered!
Every 10 minutes, we check if there is a job that's been in the the processing queue for more than 10 minutes (again, change this wrt your need) using the timestamp we provided.
Also, delete the job altogether if the tries have exceeded 3 times (this is optional for your use case).

```js
const retry = async () => {
  try {
    await acquireLock("processing"); // acquire lock for `processing` to avoid conflicts
    const res = await redis.lindex("processing", 0); // get the first processing job
    if (res) {
      const processing = await JSON.parse(res);
      if (Date.now() - Number(processing.timestamp) >= 10 * 60 * 1000) {
        // check if its been more than 10 minutes
        if (Number(processing.tries) < 3) {
          // if `tries` are less than 3, move back to `todo` queue
          await redis
            .multi()
            .lset("processing", 0, JSON.stringify(processing))
            .lmove("processing", "todo", "LEFT", "RIGHT")
            .exec();
        } else {
          await redis.lpop("processing"); // otherwise if tries execeeded, delete the job
        }
      }
      await releaseLock("processing"); // release the lock
    } else {
      await releaseLock("processing"); // relase the lock if no job
    }
  } catch (err) {
    console.error(err);
  }
};

// check every 10 minutes for retrying
setInterval(() => {
  retry();
}, 10 * 60 * 1000);
```

> **_This code sets up a job queue system using Redis and Express. It defines an Express app that handles POST requests to add jobs to a "todo" queue in Redis. It includes a concurrency control mechanism with a maximum limit of three concurrent jobs. The code uses Redis to manage locks, ensuring that only one process can modify the "todo" or "processing" queues at a time. The `execute` function processes jobs from the "todo" queue, moves them to the "processing" queue, executes them with a placeholder function, and then removes them from the "processing" queue. Jobs are periodically retried if they have been in the "processing" queue for more than ten minutes, up to three times, before being discarded. The system checks for new jobs every five minutes and retries jobs every ten minutes._**

### REDIS FUNCTIONS

#### [List Operations](https://redis.io/docs/latest/develop/data-types/lists/)

```js
await redis.rpush("todo", JSON.stringify({ name, id }));
```

> **_This function appends one or more values to the end of a list. In this case, it adds a job (serialized to JSON) to the "todo" list._**

```js
const newProcess = await redis.lindex("todo", 0);
```

> **_This function returns the element at the specified index in a list. The index 0 retrieves the first job in the "todo" list._**

```js
await redis
  .multi()
  .lset("todo", 0, JSON.stringify(copy))
  .lmove("todo", "processing", "LEFT", "RIGHT")
  .exec();
```

> **_This function starts a transaction in Redis. The `multi` command allows you to group multiple commands so they will be executed together atomically. The `exec` function is called to execute the transaction._**

```js
lset("todo", 0, JSON.stringify(copy));
```

> **_This function sets the list element at the specified index to a new value. Here, it updates the first job in the "todo" list with additional data like timestamp and number of tries._**

```js
lmove("todo", "processing", "LEFT", "RIGHT");
```

> **_This function atomically returns and removes the first/last element of one list and pushes it to the first/last element of another list. Here, it moves the job from the "todo" list to the "processing" list._**

```js
await redis.lrem("processing", 1, JSON.stringify(copy));
```

> **_This function removes elements from a list that match the specified value. The count argument specifies the number of occurrences to remove. Here, it removes the processed job from the "processing" list._**

```js
await redis.lpop("processing");
```

> **_This function removes and returns the first element of the list. It is used here to remove a job from the "processing" list after it has exceeded the retry limit._**

#### Lock Operations

```js
redis.set(`${key}-lock`, "locked", "NX", "EX", 10);
```

> **_This function sets the value of a key. The options "NX" and "EX" are used to set the key only if it does not exist and to set an expiration time (in seconds) for the key, respectively. Here, it's used to acquire a lock by setting a key like "todo-lock" or "processing-lock" with a value of "locked" that expires after 10 seconds._**

```js
await redis.del(`${key}-lock`);
```

> **_This function deletes the specified key. It is used here to release the lock by deleting the lock key._**

> **_`Todo List` holds jobs that need to be processed. Jobs are added to this list using `rpush` and retrieved for processing using `lindex`. Once a job is retrieved, it is moved to the "processing" list using `lmove`._** > **_`Processing List` holds jobs that are currently being processed. If a job is successfully completed, it is removed from this list using `lrem`. If a job fails and needs to be retried, it can be moved back to the "todo" list using `lmove`. Jobs that exceed the retry limit are removed using `lpop`._** > **_A locking mechanism is implemented using the `set` and `del` functions to ensure that only one process can modify the "todo" or "processing" list at a time, preventing race conditions._**

```sh
LRANGE todo 0 -1
```
