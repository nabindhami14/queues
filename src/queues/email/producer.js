import express from "express";
import { Queue } from "bullmq";

import emailWorker from "./consumer.js";

const app = express();

app.use(express.json());

// Simulates a sign up process by blocking the code for 500 milliseconds.
export function mockSignUp() {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

// Simulates sending an email by blocking the code for 1.5 seconds.
export function mockSendEmail() {
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

const emailQueue = new Queue("email-queue", {
  connection: {
    host: "localhost",
    port: 6379,
  },
});

app.get("/", (req, res) => {
  return res.json({ message: "is live!" });
});

app.post("/user-signup", async (_, response) => {
  await mockSignUp();

  await emailQueue.add(`${Date.now()}`, {
    from: "nabindhami14@gmail.com",
    to: "santosh.201341@ncit.edu.np",
    subject: "signup success",
    body: "this is your email confirmation notice.",
  });

  return response.json({
    status: "success",
    data: { message: "signed up completed!" },
  });
});

emailWorker.on("completed", (job) => {
  console.log(`${job.id} has completed!`);
});

app.listen(8000, () => console.log(`server running on port:${8000}`));
